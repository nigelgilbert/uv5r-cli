import { ADDR, SETTINGS_BASE, SETTINGS_COMMIT } from './codec.ts';
import { DeviceStateError, TimeoutError, UsageError } from './errors.ts';
import type { Transport } from './transport.ts';

/** Clone-mode magic for the UV-5R family (CHIRP UV5R_MODEL_291). */
export const MAGIC = Uint8Array.from([0x50, 0xbb, 0xff, 0x20, 0x12, 0x07, 0x25]);
const ACK = 0x06;
const CMD_READ = 0x53; // 'S'
const CMD_WRITE = 0x58; // 'X'
const REPLY = 0x58; // 'X'

/** The radio leaves clone mode after this much silence; a session past it needs a new handshake. */
export const IDLE_LIMIT_MS = 2500;
/** Silence to wait before a new handshake so the radio has left clone mode and reloaded its settings. */
export const SETTLE_MS = 3000;
/** Try the handshake once more after a pause when the radio does not ack. */
const HANDSHAKE_ATTEMPTS = 2;
/** A previous verb may have left the radio in clone mode; this much silence drops it. */
const HANDSHAKE_RETRY_MS = SETTLE_MS;
/** The radio takes writes as 16-byte aligned blocks below this address. */
const MEMORY_END = 0x2000;
const BLOCK = 0x10;
/** The two 16-byte halves the radio stages until a write at SETTINGS_COMMIT. */
const SETTINGS_HALVES = [SETTINGS_BASE, SETTINGS_BASE + BLOCK] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Wait for the radio to drop the clone session and reload its settings from EEPROM. */
export const settle = (): Promise<void> => sleep(SETTLE_MS);
export const hex = (a: Uint8Array | number[]): string => [...a].map((b) => b.toString(16).padStart(2, '0')).join(' ');

export interface Ident {
  bytes: Uint8Array;
  firmware: string;
  droppedByte: boolean;
}

/**
 * One clone-mode session. Commands go back to back; the radio drops the session after
 * IDLE_LIMIT_MS of silence and reloads its settings from EEPROM when it does.
 */
export class Session {
  private lastCommandAt = 0;
  private commands = 0;
  /** Settings halves the radio acked this session and holds in its staging buffer. */
  private readonly staged = new Set<number>();
  ident: Ident | undefined;

  /** The ident from start; throws DeviceStateError before the handshake. */
  get startedIdent(): Ident {
    if (!this.ident) throw new DeviceStateError('session-unavailable', 'clone session not started', {}, { remedy: 'rerun the command' });
    return this.ident;
  }

  private readonly transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  /** Send the magic, read the ident, then read the firmware block the way CHIRP does. */
  async start(): Promise<Ident> {
    let bytes: Uint8Array | undefined;
    let lastGot = '';
    for (let attempt = 0; attempt < HANDSHAKE_ATTEMPTS && !bytes; attempt++) {
      if (attempt > 0) await sleep(HANDSHAKE_RETRY_MS);
      this.transport.discard();
      for (const b of MAGIC) {
        this.transport.write(Uint8Array.of(b));
        await sleep(10);
      }
      const ack = await this.transport.read(1, 1200);
      if (ack[0] !== ACK) {
        lastGot = hex(ack);
        continue;
      }
      this.transport.write(Uint8Array.of(0x02));
      await sleep(300);
      let id = await this.transport.read(12, 50);
      if (id.length === 12) id = Uint8Array.from([id[0]!, id[3]!, id[5]!, ...id.subarray(7)]);
      if (id.length !== 8) throw new DeviceStateError('protocol-reply-invalid', 'unexpected ident from radio', { got: hex(id) });
      this.transport.write(Uint8Array.of(ACK));
      const ack2 = await this.transport.read(1, 1000);
      if (ack2[0] !== ACK) throw new DeviceStateError('session-unavailable', 'radio refused the clone session', { got: hex(ack2) }, { remedy: 'wait 3 s and rerun the command' });
      bytes = id;
    }
    if (!bytes) {
      throw new DeviceStateError(
        'session-unavailable',
        'radio did not answer the clone handshake; check the radio is on and the cable is seated',
        { got: lastGot },
        { retry: 'after-remedy' },
      );
    }
    this.lastCommandAt = Date.now();
    this.commands = 0;
    this.staged.clear();
    // A first read outside the aux area, then the firmware block; newer radios need this order.
    await this.readBlock(0x1e80, 0x40);
    const fw = await this.readBlock(ADDR.firmwareBlock, 0x40);
    const tail = await this.readBlock(0x1fc0, 0x40);
    const firmware = Buffer.from(fw.subarray(48, 62))
      .toString('latin1')
      .replace(/[^\x20-\x7e]/g, '')
      .trim();
    this.ident = { bytes, firmware, droppedByte: tail[15] === 0xff };
    return this.ident;
  }

  private touch(): void {
    const gap = Date.now() - this.lastCommandAt;
    if (this.commands > 0 && gap > IDLE_LIMIT_MS - 300) {
      this.staged.clear();
      throw new DeviceStateError('session-unavailable', `clone session idle for ${gap} ms; the radio has left clone mode`, { idleMs: gap }, { remedy: 'rerun the command' });
    }
    this.lastCommandAt = Date.now();
    this.commands++;
  }

  /**
   * Read `size` bytes at `addr`; the radio serves 16-byte aligned blocks, so pass aligned addresses.
   * Reads of 0x0E00..0x0E7F return the values loaded at the last reload, so a write there
   * reads back unchanged until the next session.
   */
  async readBlock(addr: number, size: number): Promise<Uint8Array> {
    const first = this.commands === 0;
    this.touch();
    this.transport.write(Uint8Array.of(CMD_READ, addr >> 8, addr & 0xff, size));
    if (!first) {
      const ack = await this.transport.read(1, 1500);
      if (ack[0] !== ACK) throw new TimeoutError(`no ack before read of 0x${addr.toString(16)}`, { addr, got: hex(ack) });
    }
    const hdr = await this.transport.read(4, 1500);
    if (hdr.length < 4 || hdr[0] !== REPLY || ((hdr[1]! << 8) | hdr[2]!) !== addr || hdr[3] !== size) {
      throw new DeviceStateError('protocol-reply-invalid', `bad read header at 0x${addr.toString(16)}`, { addr, got: hex(hdr) });
    }
    const data = await this.transport.read(size, 3000);
    if (data.length !== size) throw new TimeoutError(`short read at 0x${addr.toString(16)}: ${data.length}/${size}`, { addr });
    this.transport.write(Uint8Array.of(ACK));
    await sleep(50);
    return data;
  }

  /**
   * Write one 16-byte aligned block. The radio acks every write; only some regions take effect.
   * Writes to 0x0E20 and 0x0E30 are staged in a zero-filled 32-byte buffer and reach EEPROM
   * on the next write at 0x0E40; use writeSettings in radio.ts for that region.
   * A write at 0x0E40 commits zeros over any half left unstaged, so it throws UsageError
   * unless both halves were acked since the last commit, handshake or failed write.
   * Each write throws UsageError unless it is 16 bytes at a 16-byte aligned address.
   */
  async writeBlock(addr: number, data: Uint8Array): Promise<void> {
    if (!Number.isInteger(addr) || addr < 0 || addr % BLOCK !== 0 || addr + BLOCK > MEMORY_END) {
      throw new UsageError(`write address 0x${addr.toString(16)} is outside the 16-byte aligned blocks below 0x${MEMORY_END.toString(16)}`, { addr });
    }
    if (data.length !== BLOCK) {
      throw new UsageError(`write at 0x${addr.toString(16)} takes ${BLOCK} bytes; got ${data.length}`, { addr, size: data.length });
    }
    const commit = addr === SETTINGS_COMMIT;
    if (commit && !SETTINGS_HALVES.every((h) => this.staged.has(h))) {
      const staged = SETTINGS_HALVES.filter((h) => this.staged.has(h)).map((h) => `0x${h.toString(16)}`);
      this.staged.clear();
      throw new UsageError('write at 0x0e40 commits the settings block; stage both 0x0e20 and 0x0e30 first', { addr, staged });
    }
    try {
      this.touch();
      this.transport.discard();
      this.transport.write(Uint8Array.from([CMD_WRITE, addr >> 8, addr & 0xff, data.length, ...data]));
      await sleep(50);
      const ack = await this.transport.read(1, 1500);
      if (ack[0] !== ACK) throw new DeviceStateError('write-unacknowledged', `radio refused write at 0x${addr.toString(16)}`, { addr, got: hex(ack) });
    } catch (err) {
      this.staged.clear();
      throw err;
    }
    if (commit) this.staged.clear();
    else if ((SETTINGS_HALVES as readonly number[]).includes(addr)) this.staged.add(addr);
  }
}
