import { ADDR, SETTINGS_BASE, SETTINGS_COMMIT } from './codec.ts';
import { DeviceStateError, TimeoutError, UsageError } from './errors.ts';
import { DEFAULT_MAGIC, classify, magicByName, parseIdent, type Family, type IdentFlags, type Magic, type MagicName } from './ident.ts';
import type { Transport } from './transport.ts';

/** The magic sessions open with when the caller names none. */
const DEFAULT = magicByName(DEFAULT_MAGIC);
/** Bytes of the default 291 magic, for tests that watch the wire. */
export const MAGIC = DEFAULT.bytes;
export const ACK = 0x06;
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
/** Pause after each magic byte. */
const MAGIC_BYTE_GAP_MS = 10;
/** Wait for the ack after the last magic byte. */
const ACK_WAIT_MS = 1200;
/** Longest ident reply: the 14-byte form of a UV-5X3-type radio. */
const IDENT_MAX = 14;
/** Budget for the one bounded ident read; the whole ident lands within about 10 ms. */
const IDENT_WAIT_MS = 300;
/** Remedy for a verb handshake that got no 06. */
const NO_HANDSHAKE_REMEDY = 'ask the human to check the radio is on and the cable is seated; if both hold, run uv5r identify and export the UV5R_MAGIC line it prints';
/** Wait for the radio's 06 after the host's closing 06. */
const CONFIRM_WAIT_MS = 1000;
/** The radio takes writes as 16-byte aligned blocks below this address. */
const MEMORY_END = 0x2000;
const BLOCK = 0x10;
/** The two 16-byte halves the radio stages until a write at SETTINGS_COMMIT. */
const SETTINGS_HALVES = [SETTINGS_BASE, SETTINGS_BASE + BLOCK] as const;

/**
 * Wait `ms` on a ref'd timer, so a port that closes mid-wait still leaves the loop alive for the
 * next read to report it. When `stop` resolves first, clear the timer and resolve at once.
 */
export const sleep = (ms: number, stop?: Promise<unknown>) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void stop?.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
/** Wait for the radio to drop the clone session and reload its settings from EEPROM; end early when `stop` resolves. */
export const settle = (stop?: Promise<unknown>): Promise<void> => sleep(SETTLE_MS, stop);
export const hex = (a: Uint8Array | number[]): string => [...a].map((b) => b.toString(16).padStart(2, '0')).join(' ');

export interface Ident {
  bytes: Uint8Array;
  /** The printable version string, trimmed. */
  firmware: string;
  /** All 14 version bytes at 0x1EF0 as hex. */
  firmwareHex: string;
  droppedByte: boolean;
  /** Name of the magic that opened the session. */
  magic: MagicName;
  family: Family;
  flags: IdentFlags;
}

/** What one handshake attempt saw on the wire; `got` holds the reply bytes as hex. */
export type AttemptOutcome =
  | { kind: 'silent' }
  | { kind: 'wrong-ack'; got: string }
  | { kind: 'invalid'; got: string }
  | { kind: 'foreign'; name: string; got: string }
  | { kind: 'refused'; got: string }
  | { kind: 'ident'; bytes: Uint8Array };

/**
 * Run one handshake attempt with `magic`: discard input, send the magic byte by byte, wait
 * for 06, send 02 and read up to 14 ident bytes in one bounded read. With `confirm`, send the
 * closing 06 and wait for the radio's 06; without it, stop after the ident.
 */
export async function attempt(transport: Transport, magic: Pick<Magic, 'bytes'>, { confirm }: { confirm: boolean }): Promise<AttemptOutcome> {
  transport.discard();
  for (const b of magic.bytes) {
    transport.write(Uint8Array.of(b));
    await sleep(MAGIC_BYTE_GAP_MS);
  }
  const ack = await transport.read(1, ACK_WAIT_MS);
  if (ack.length === 0) return { kind: 'silent' };
  if (ack[0] !== ACK) return { kind: 'wrong-ack', got: hex(ack) };
  transport.write(Uint8Array.of(0x02));
  const reply = await transport.read(IDENT_MAX, IDENT_WAIT_MS);
  const parsed = parseIdent(reply);
  if (parsed.kind === 'invalid') return { kind: 'invalid', got: hex(reply) };
  if (parsed.kind === 'foreign') return { kind: 'foreign', name: parsed.name, got: hex(reply) };
  if (!confirm) return { kind: 'ident', bytes: parsed.bytes };
  transport.write(Uint8Array.of(ACK));
  const ack2 = await transport.read(1, CONFIRM_WAIT_MS);
  if (ack2[0] !== ACK) return { kind: 'refused', got: hex(ack2) };
  return { kind: 'ident', bytes: parsed.bytes };
}

/** Return the radio-unsupported error for a radio that answered `magic` with reply `got` as `radio`. */
export function radioUnsupported(radio: string, magic: string, got: string): DeviceStateError {
  return new DeviceStateError('radio-unsupported', `the radio answered as a ${radio}; this CLI speaks the classic UV-5R protocol`, { radio, magic, got });
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

  /**
   * Open the session with `magic`: up to two attempts SETTLE_MS apart, the second only when
   * the first got silence or a byte other than 06. Then read the firmware block the way CHIRP
   * does. A 14-byte ident throws radio-unsupported, any other bad ident throws
   * protocol-reply-invalid, and a refused closing 06 throws session-unavailable at once.
   */
  async start(magic: Magic = DEFAULT): Promise<Ident> {
    let last: AttemptOutcome = { kind: 'silent' };
    for (let n = 0; n < HANDSHAKE_ATTEMPTS; n++) {
      if (n > 0) await sleep(HANDSHAKE_RETRY_MS);
      last = await attempt(this.transport, magic, { confirm: true });
      switch (last.kind) {
        case 'ident':
          return this.finish(magic, last.bytes);
        case 'foreign':
          throw radioUnsupported(last.name, magic.name, last.got);
        case 'invalid':
          throw new DeviceStateError('protocol-reply-invalid', 'unexpected ident from radio', { magic: magic.name, got: last.got });
        case 'refused':
          throw new DeviceStateError('session-unavailable', 'radio refused the clone session', { magic: magic.name, got: last.got }, { remedy: 'wait 3 s and rerun the command' });
      }
    }
    const got = last.kind === 'wrong-ack' ? last.got : '';
    const heard = got ? `answered the clone handshake with ${got} in place of 06` : 'did not answer the clone handshake';
    throw new DeviceStateError('session-unavailable', `radio ${heard}; check the radio is on and the cable is seated`, { magic: magic.name, got }, { remedy: NO_HANDSHAKE_REMEDY, retry: 'after-remedy' });
  }

  /**
   * Run the reads that follow a confirmed handshake with `magic` and ident `bytes`, and
   * build the ident with the firmware, the dropped-byte flag and the classification.
   */
  async finish(magic: Magic, bytes: Uint8Array): Promise<Ident> {
    this.lastCommandAt = Date.now();
    this.commands = 0;
    this.staged.clear();
    // A first read outside the aux area, then the firmware block; newer radios need this order.
    await this.readBlock(0x1e80, 0x40);
    const fw = await this.readBlock(ADDR.firmwareBlock, 0x40);
    const tail = await this.readBlock(0x1fc0, 0x40);
    const version = fw.subarray(48, 62);
    const firmware = Buffer.from(version)
      .toString('latin1')
      .replace(/[^\x20-\x7e]/g, '')
      .trim();
    const { family, flags } = classify(magic.name, version, bytes);
    this.ident = { bytes, firmware, firmwareHex: hex(version), droppedByte: tail[15] === 0xff, magic: magic.name, family, flags };
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
