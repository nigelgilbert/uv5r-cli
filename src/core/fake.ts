import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ADDR, CHANNEL_BASE, CHANNEL_COUNT, NAME_BASE, decodeChannel, encodeLbcd } from './codec.ts';
import { TransportError, UsageError } from './errors.ts';
import { magicByName, type MagicName } from './ident.ts';
import { SETTLE_MS, VERSION_LENGTH, VERSION_OFFSET, hex, sleep } from './protocol.ts';
import { AUX_SIZE, IMAGE_AUX, IMAGE_HEADER } from './radio.ts';
import type { Transport } from './transport.ts';

/** Start of the page the radio serves from its reload snapshot and aliases for 16-byte reads. */
const PAGE = 0x0e00;
const PAGE_END = 0x0e80;
const SETTINGS = 0x0e20;
const COMMIT = 0x0e40;
/** Silence after which the bench radio leaves clone mode, measured at about 2.5 s. */
const IDLE_DROP_MS = 2500;
/** Bytes of a classic magic. */
const MAGIC_LENGTH = 7;
/** Bytes of a UV17Pro program magic. */
const PROGRAM_LENGTH = 16;
/** Baud of the classic and foreign magics. */
const CLASSIC_RATE = 9600;
/** Baud of the program magics. */
const PROGRAM_RATE = 115200;
/** Radio address where main memory ends. */
const MAIN_END = IMAGE_AUX - IMAGE_HEADER;
/** Bytes of radio memory the fake holds. */
const MEMORY_SIZE = 0x2000;
/** Address of the 14-byte version string. */
const VERSION_AT = ADDR.firmwareBlock + VERSION_OFFSET;

/**
 * In-memory UV-5R with the bench radio's behaviour: answers the clone handshake, serves
 * 16-byte aligned reads, acks every write, applies writes to channel memory and ignores
 * writes to the VFO region. The 0x0E00 page reads as it was at the last reload; 16-byte
 * reads in 0x0E10..0x0E4F return the 0x0E40 record; writes at 0x0E20 and 0x0E30 are staged
 * in a zero-filled buffer that a write at 0x0E40 commits.
 *
 * Assumptions beyond the bench measurements:
 * - The bench showed writes to 0x0E4C and 0x0E76..0x0E77 have no effect. The fake drops
 *   every other write in 0x0E00..0x0E7F too, including the bytes of the 0x0E40 write itself.
 * - The session drops after IDLE_DROP_MS without a byte from the host, timed with
 *   Date.now(), so fake timers drive it. A handshake then starts a new session and reloads
 *   the page.
 * - Outside a session it matches the last 7 bytes received against `magics` and
 *   `foreignMagic`, answers a match with `ackByte`, and stays idle when `ackByte` is not 06.
 *   A `foreignMagic` match answers `02` with `foreignIdent`.
 * - At a rate other than 9600 it ignores every byte. At 115200 it answers the 16 bytes of
 *   `programMagic` with one 06.
 */
export class FakeRadio implements Transport {
  readonly target = 'fake';
  readonly eeprom = new Uint8Array(MEMORY_SIZE).fill(0xff);
  readonly ident = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0xdd]);
  /** Magics the radio acks; the bench unit acks 291. */
  magics: Uint8Array[] = [magicByName('291').bytes];
  /** Byte the radio sends in reply to a magic it acks. */
  ackByte = 0x06;
  /** Reply to `02`, of any length. */
  identReply: Uint8Array = this.ident;
  /** A 7-byte foreign magic the radio acks at 9600 as another driver's radio. */
  foreignMagic: Uint8Array | undefined;
  /** Reply to `02` after `foreignMagic`, 8 or 14 bytes. */
  foreignIdent: Uint8Array = Uint8Array.from([0xaa, ...new Array<number>(12).fill(0x30), 0xdd]);
  /** A 16-byte program magic the radio acks at 115200 with one 06. */
  programMagic: Uint8Array | undefined;
  /** Hex of every magic the radio matched, acked or ignored, in order. */
  readonly handshakes: string[] = [];
  private inbox: number[] = [];
  private outbox: number[] = [];
  private lastBytes: number[] = [];
  private lastProgramBytes: number[] = [];
  /** Reply to the next `02`, set by the magic that matched. */
  private pendingIdent: Uint8Array = this.ident;
  protected state: 'idle' | 'acked' | 'ident-sent' | 'session' = 'idle';
  private pendingAckForRead = false;
  private loadedPage = new Uint8Array(PAGE_END - PAGE);
  private staged = new Uint8Array(0x20);
  protected lastByteAt = 0;
  ptt = false;
  /** Value of each setPtt call, in order. */
  readonly pttLog: boolean[] = [];
  /** Baud rate the host set last. */
  rate = CLASSIC_RATE;
  /** Addresses of every write command the radio received, in order. */
  readonly writes: number[] = [];
  /** Number of magic sequences to leave unanswered, as a radio still in a dying clone session. */
  handshakesIgnored = 0;
  /** Writes in writesIgnoredBelow..writesIgnoredAbove are acked and dropped. */
  writesIgnoredBelow = 0x0f00;
  writesIgnoredAbove = 0x0f40;
  /** Address of a write whose first byte the radio stores inverted, to fail a read-back. */
  corruptWriteAt: number | undefined;
  /** Address of a write the radio drops without an ack. */
  refuseWriteAt: number | undefined;
  /** Address of a write the radio stores without an ack, as when the ack is lost on the wire. */
  unackedWriteAt: number | undefined;
  /** Address of a read the radio leaves unanswered, to time out the read. */
  silentReadAt: number | undefined;

  constructor() {
    this.firmware = 'HN5RV011';
    this.eeprom[0x1fcf] = 0xff;
    this.eeprom.set(
      [0x03, 0, 0, 0x03, 0, 0, 0x05, 0, 0x01, 0x03, 0, 0, 0, 0, 0x01, 0, 0x03, 0, 0, 0, 0x05, 0x02, 0x02, 0, 0, 0, 0, 0, 0, 0x03, 0x01, 0x02],
      SETTINGS,
    );
    this.eeprom[0x0e4c] = 0;
    this.eeprom.set([4, 4, 6, 0, 0, 0, 0, 0], 0x0f08);
    this.reload();
  }

  /** Return a fake with the ident, main memory and aux block of a CHIRP `image` that acks `magic`. */
  static fromImage(image: Uint8Array, { magic = '291' }: { magic?: MagicName } = {}): FakeRadio {
    if (image.length !== IMAGE_AUX + AUX_SIZE) throw new Error(`image is ${image.length} bytes; expected ${IMAGE_AUX + AUX_SIZE}`);
    const radio = new FakeRadio();
    radio.ident.set(image.subarray(0, IMAGE_HEADER));
    radio.eeprom.set(image.subarray(IMAGE_HEADER, IMAGE_HEADER + MAIN_END), 0);
    radio.eeprom.set(image.subarray(IMAGE_AUX), ADDR.firmwareBlock);
    radio.magics = [magicByName(magic).bytes];
    return radio;
  }

  /** The version string at 0x1EF0, padded with 0xFF to 14 bytes. */
  set firmware(text: string) {
    this.eeprom.fill(0xff, VERSION_AT, VERSION_AT + VERSION_LENGTH);
    this.eeprom.set(Buffer.from(text, 'latin1').subarray(0, VERSION_LENGTH), VERSION_AT);
  }

  get firmware(): string {
    return Buffer.from(this.eeprom.subarray(VERSION_AT, VERSION_AT + VERSION_LENGTH)).toString('latin1');
  }

  /** Load the 0x0E00 page from EEPROM and clear the staging buffer, as the radio does when it enters clone mode. */
  protected reload(): void {
    this.loadedPage = Uint8Array.from(this.eeprom.subarray(PAGE, PAGE_END));
    this.staged.fill(0);
  }

  write(bytes: Uint8Array): void {
    if (this.rate !== CLASSIC_RATE) {
      for (const b of bytes) this.feedProgram(b);
      return;
    }
    if (this.state !== 'idle' && Date.now() - this.lastByteAt >= IDLE_DROP_MS) this.dropSession();
    this.lastByteAt = Date.now();
    for (const b of bytes) this.feed(b);
  }

  /** Match the last 16 bytes against `programMagic` and ack a match with one 06. */
  private feedProgram(b: number): void {
    this.lastProgramBytes = [...this.lastProgramBytes, b].slice(-PROGRAM_LENGTH);
    const seen = hex(this.lastProgramBytes);
    if (this.rate !== PROGRAM_RATE || !this.programMagic || hex(this.programMagic) !== seen) return;
    this.lastProgramBytes = [];
    this.handshakes.push(seen);
    this.outbox.push(0x06);
  }

  private feed(b: number): void {
    if (this.state === 'idle') {
      this.lastBytes = [...this.lastBytes, b].slice(-MAGIC_LENGTH);
      const seen = hex(this.lastBytes);
      const foreign = this.foreignMagic !== undefined && hex(this.foreignMagic) === seen;
      if (!foreign && !this.magics.some((m) => hex(m) === seen)) return;
      this.pendingIdent = foreign ? this.foreignIdent : this.identReply;
      this.lastBytes = [];
      this.handshakes.push(seen);
      if (this.handshakesIgnored > 0) {
        this.handshakesIgnored--;
        return;
      }
      this.outbox.push(this.ackByte);
      if (this.ackByte !== 0x06) return;
      this.state = 'acked';
      this.reload();
      this.acked();
      return;
    }
    if (this.state === 'acked') {
      if (b === 0x02) {
        this.outbox.push(...this.pendingIdent);
        this.state = 'ident-sent';
      }
      return;
    }
    if (this.state === 'ident-sent') {
      if (b === 0x06) {
        this.outbox.push(0x06);
        this.state = 'session';
      }
      return;
    }
    this.inbox.push(b);
    this.drain();
  }

  private serve(addr: number, size: number): Uint8Array {
    if (addr >= PAGE && addr < PAGE_END) {
      const at = size === 0x10 && addr >= 0x0e10 && addr < 0x0e50 ? COMMIT : addr;
      return this.loadedPage.subarray(at - PAGE, at - PAGE + size);
    }
    return this.eeprom.subarray(addr, addr + size);
  }

  private store(addr: number, data: number[]): void {
    if (addr === SETTINGS || addr === SETTINGS + 0x10) {
      this.staged.set(data, addr - SETTINGS);
      return;
    }
    if (addr === COMMIT) {
      this.eeprom.set(this.staged, SETTINGS);
      this.staged.fill(0);
      return;
    }
    if (addr >= PAGE && addr < PAGE_END) return;
    if (addr === this.corruptWriteAt) data = [data[0]! ^ 0xff, ...data.slice(1)];
    if (!this.ignores(addr)) this.eeprom.set(data, addr);
  }

  /** Return true for a write the radio acks and drops. */
  protected ignores(addr: number): boolean {
    return addr >= this.writesIgnoredBelow && addr < this.writesIgnoredAbove;
  }

  /** Run after the radio acks a handshake magic. */
  protected acked(): void {}

  /** Run after the radio stores or drops an acked write at `addr`. */
  protected stored(_addr: number): void {}

  private drain(): void {
    while (this.inbox.length > 0) {
      const cmd = this.inbox[0]!;
      if (cmd === 0x06) {
        this.inbox.shift();
        continue;
      }
      if (cmd === 0x53) {
        if (this.inbox.length < 4) return;
        const [, hi, lo, size] = this.inbox.splice(0, 4) as number[];
        const addr = ((hi! << 8) | lo!) & ~0x0f;
        if (addr === this.silentReadAt) continue;
        if (this.pendingAckForRead) this.outbox.push(0x06);
        this.pendingAckForRead = true;
        this.outbox.push(0x58, hi!, lo!, size!, ...this.serve(addr, size!));
        continue;
      }
      if (cmd === 0x58) {
        if (this.inbox.length < 4) return;
        const len = this.inbox[3]!;
        if (this.inbox.length < 4 + len) return;
        const [, hi, lo] = this.inbox.splice(0, 4) as number[];
        const data = this.inbox.splice(0, len);
        const addr = (hi! << 8) | lo!;
        this.writes.push(addr);
        if (addr === this.refuseWriteAt) continue;
        this.store(addr, data);
        if (addr === this.unackedWriteAt) continue;
        this.stored(addr);
        this.outbox.push(0x06);
        continue;
      }
      this.inbox.shift();
    }
  }

  async read(n: number, _ms: number): Promise<Uint8Array> {
    return Uint8Array.from(this.outbox.splice(0, n));
  }

  discard(): void {
    this.outbox = [];
  }

  /** Queue `bytes` as stale input that the host reads before any reply. */
  queueStale(bytes: Iterable<number>): void {
    this.outbox.push(...bytes);
  }

  /** Enter clone mode as a session whose last byte arrived at `lastByteAt`, as the radio is right after another verb. */
  resumeSession(lastByteAt: number): void {
    this.state = 'session';
    this.lastByteAt = lastByteAt;
  }

  /** Leave clone mode at once, as the radio does after IDLE_DROP_MS of silence. */
  dropSession(): void {
    this.state = 'idle';
    this.inbox = [];
    this.outbox = [];
    this.pendingAckForRead = false;
  }

  async setPtt(on: boolean): Promise<void> {
    this.pttLog.push(on);
    this.ptt = on;
  }

  async setBaud(rate: number): Promise<void> {
    this.rate = rate;
  }

  async close(): Promise<void> {}
}

/** The `--target` value that selects FakeTransport. */
export const FAKE_TARGET = 'fake';
/** Milliseconds after a tune ends at which the fake radio transmits on the new record. */
export const FAKE_APPLY_MS = SETTLE_MS;
/** Milliseconds between rewrites of the PTT file while PTT is held. */
export const PTT_HEARTBEAT_MS = 500;
/** Hz the tune-wrong-freq fault adds to the TX frequency of the tuned slot. */
const WRONG_FREQ_SHIFT_HZ = 1_000_000;
/** End of the channel records and of the names. */
const CHANNELS_END = CHANNEL_BASE + CHANNEL_COUNT * 16;
const NAMES_END = NAME_BASE + CHANNEL_COUNT * 16;

/** One fault `UV5R_FAKE_FAULT` selects. */
export type FakeFault = { kind: 'tune-delay'; ms: number } | { kind: 'name-not-taken' } | { kind: 'tune-wrong-freq' } | { kind: 'ptt-control-failed' } | { kind: 'hang' };

/** TX frequency in Hz and power of a slot; both null for an empty, malformed or receive-only slot. */
export interface Transmission {
  freq_hz: number | null;
  power: 'low' | 'high' | null;
}

/** What the `UV5R_FAKE_STATE` file holds between processes. */
export interface FakeState extends Transmission {
  /** Base64 of the 0x2000 bytes of radio memory. */
  eeprom: string;
  /** Slot the last tune wrote, which stands in for the display. */
  tunedSlot: number | null;
  /** Epoch ms when the last tune ended. */
  tuneEndedMs: number | null;
  /** Epoch ms of the last byte the host sent in a clone session. */
  lastCommandMs: number | null;
}

/** What the `TINYSA_SIM_PTT` file holds. */
export interface PttFile extends Transmission {
  run_id: string | null;
  written_ms: number;
  ptt: boolean;
  ptt_on_ms: number | null;
  ptt_off_ms: number | null;
}

/** Options for FakeTransport.open. */
export interface FakeOptions {
  env?: NodeJS.ProcessEnv;
  /** The verb that opened the transport, for the tune-only faults. */
  verb?: string;
}

/** The faults `UV5R_FAKE_FAULT` takes, as the usage error lists them. */
const FAULT_NAMES = 'tune-delay:MS, name-not-taken, tune-wrong-freq, ptt-control-failed or hang';

/** Parse `UV5R_FAKE_FAULT`; an unset or empty value gives undefined and an unknown one throws UsageError. */
export function parseFakeFault(text: string | undefined): FakeFault | undefined {
  if (text === undefined || text === '') return undefined;
  if (text === 'name-not-taken' || text === 'tune-wrong-freq' || text === 'ptt-control-failed' || text === 'hang') return { kind: text };
  const delay = /^tune-delay:(\d+)$/.exec(text);
  if (delay) return { kind: 'tune-delay', ms: Number(delay[1]) };
  throw new UsageError(
    `UV5R_FAKE_FAULT=${text} names no fault; use ${FAULT_NAMES}`,
    { variable: 'UV5R_FAKE_FAULT', value: text },
    { remedy: `set UV5R_FAKE_FAULT to ${FAULT_NAMES}, or unset it`, retry: 'after-remedy' },
  );
}

/** Return the TX frequency and power of `slot` in `eeprom`. */
function slotTransmission(eeprom: Uint8Array, slot: number): Transmission {
  const at = CHANNEL_BASE + slot * 16;
  const ch = decodeChannel(eeprom.subarray(at, at + 16), new Uint8Array(16).fill(0xff));
  if (!ch || ch.txHz === null) return { freq_hz: null, power: null };
  return { freq_hz: ch.txHz, power: ch.lowPower ? 'low' : 'high' };
}

/** Write `value` as JSON to a temp name beside `path` and rename it over `path`. */
function writeJsonAtomic(path: string, value: object): void {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
}

/** Read the state file at `path`, or return undefined when it does not exist. */
function readState(path: string): FakeState | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new UsageError(`cannot read UV5R_FAKE_STATE file ${path}: ${(err as Error).message}`, { variable: 'UV5R_FAKE_STATE', file: path });
  }
  const bad = (why: string) =>
    new UsageError(`UV5R_FAKE_STATE file ${path} ${why}`, { variable: 'UV5R_FAKE_STATE', file: path }, { remedy: 'delete the file to start from a new fake radio, or point UV5R_FAKE_STATE at another path', retry: 'after-remedy' });
  let state: FakeState;
  try {
    state = JSON.parse(text) as FakeState;
  } catch {
    throw bad('is not JSON');
  }
  if (typeof state !== 'object' || state === null || typeof state.eeprom !== 'string' || Buffer.from(state.eeprom, 'base64').length !== MEMORY_SIZE) throw bad(`has no ${MEMORY_SIZE}-byte eeprom`);
  return state;
}

/**
 * The fake radio for `--target fake`, kept in the file `UV5R_FAKE_STATE` names so that
 * separate `uv5r` processes see one radio. A missing file starts from the FakeRadio image in
 * MR mode. Every acked write and every close saves the file.
 *
 * Lead time, as on the bench: a handshake within IDLE_DROP_MS of the previous verb's last
 * byte lands in that verb's session and gets no ack, so Session.start waits and retries. A
 * tune applies FAKE_APPLY_MS after the command ends; until then PTT reports the frequency and
 * power that applied before, or the slot's values from before the first tune.
 *
 * PTT: each rise decodes the slot the last tune wrote and writes the
 * `TINYSA_SIM_PTT` file, then rewrites it every PTT_HEARTBEAT_MS. The setPtt(false) that
 * follows stops the rewrites and writes `ptt: false`. Other releases leave the file alone.
 * Each write goes to a temp name in the same directory and is renamed over the file.
 *
 * Faults from `UV5R_FAKE_FAULT`: `tune-delay:MS` holds the handshake ack of `tune` for MS,
 * past the read timeout the host asked for. `name-not-taken` acks name writes and drops them.
 * `tune-wrong-freq` adds WRONG_FREQ_SHIFT_HZ to the TX frequency of each channel record
 * write, so the read-back fails on txHz. `ptt-control-failed` rejects each
 * setPtt(true) from released, as a DTR set that fails, so `key` exits 3. `hang` gives holdPtt
 * a hold body that waits for the stop alone, so PTT stays up past the hold until a signal
 * arrives or the keyWhile watchdog fires; the release then writes `ptt: false` as usual.
 */
export class FakeTransport extends FakeRadio {
  private readonly statePath: string;
  private readonly pttPath: string | undefined;
  private readonly runId: string | null;
  private readonly fault: FakeFault | undefined;
  private readonly verb: string | undefined;
  private readonly saved: FakeState;
  /** Radio memory as the file held it at open. */
  private readonly loaded: Uint8Array;
  /** Slot of the last channel record write in this process. */
  private tunedNow: number | undefined;
  private holdMs = 0;
  private delayed = false;
  private keyed: Omit<PttFile, 'run_id' | 'written_ms' | 'ptt'> | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private closed = false;
  /** Hold body under `hang`, which waits for the stop alone. */
  readonly holdBody?: (ms: number, stop: Promise<void>) => Promise<void>;

  private constructor(statePath: string, env: NodeJS.ProcessEnv, verb: string | undefined) {
    super();
    this.statePath = statePath;
    this.pttPath = env.TINYSA_SIM_PTT || undefined;
    this.runId = env.BENCH_RUN_ID || null;
    this.fault = parseFakeFault(env.UV5R_FAKE_FAULT);
    if (this.fault?.kind === 'hang') this.holdBody = (_ms, stop) => stop;
    this.verb = verb;
    const state = readState(statePath);
    if (state) this.eeprom.set(Buffer.from(state.eeprom, 'base64'));
    else this.eeprom[ADDR.workmode] = 1;
    this.reload();
    this.loaded = Uint8Array.from(this.eeprom);
    this.saved = {
      eeprom: '',
      tunedSlot: state?.tunedSlot ?? null,
      tuneEndedMs: state?.tuneEndedMs ?? null,
      freq_hz: state?.freq_hz ?? null,
      power: state?.power ?? null,
      lastCommandMs: state?.lastCommandMs ?? null,
    };
    const last = this.saved.lastCommandMs;
    if (last !== null && Date.now() - last < IDLE_DROP_MS) this.resumeSession(last);
  }

  /** Open the fake radio the env names, with PTT released; an unset UV5R_FAKE_STATE throws UsageError. */
  static async open({ env = process.env, verb }: FakeOptions = {}): Promise<FakeTransport> {
    const path = env.UV5R_FAKE_STATE;
    if (!path) {
      throw new UsageError('UV5R_FAKE_STATE is unset; --target fake keeps the fake radio in the file it names', { variable: 'UV5R_FAKE_STATE' }, {
        remedy: 'set UV5R_FAKE_STATE to an absolute path for the fake radio state file',
        retry: 'after-remedy',
      });
    }
    const t = new FakeTransport(path, env, verb);
    await t.setPtt(false);
    return t;
  }

  /** The state as the file holds it now. */
  snapshot(): FakeState {
    return { ...this.saved, eeprom: Buffer.from(this.eeprom).toString('base64') };
  }

  /**
   * Return what PTT transmits at `now`: the tuned slot decoded from `eeprom` once the tune
   * applied, else the values that applied before.
   */
  transmission(now: number, eeprom: Uint8Array = this.eeprom): Transmission {
    const { tunedSlot, tuneEndedMs, freq_hz, power } = this.saved;
    if (tunedSlot !== null && tuneEndedMs !== null && now >= tuneEndedMs + FAKE_APPLY_MS) return slotTransmission(eeprom, tunedSlot);
    return { freq_hz, power };
  }

  protected override ignores(addr: number): boolean {
    return super.ignores(addr) || (this.fault?.kind === 'name-not-taken' && addr >= NAME_BASE && addr < NAMES_END);
  }

  protected override acked(): void {
    if (this.fault?.kind !== 'tune-delay' || this.verb !== 'tune' || this.delayed) return;
    this.delayed = true;
    this.holdMs = this.fault.ms;
  }

  protected override stored(addr: number): void {
    if (addr < CHANNELS_END) {
      const slot = (addr - CHANNEL_BASE) >> 4;
      // Record what transmits until this tune applies, from memory as it was before the write.
      if (this.tunedNow === undefined) {
        const s = this.saved;
        const before = s.tunedSlot === null ? slotTransmission(this.loaded, slot) : this.transmission(Date.now(), this.loaded);
        s.freq_hz = before.freq_hz;
        s.power = before.power;
      }
      this.tunedNow = slot;
      this.saved.tunedSlot = slot;
      this.saved.tuneEndedMs = Date.now();
      if (this.fault?.kind === 'tune-wrong-freq') this.shiftTx(slot);
    }
    this.save();
  }

  override async read(n: number, ms: number): Promise<Uint8Array> {
    if (this.holdMs > 0) {
      const hold = this.holdMs;
      this.holdMs = 0;
      await sleep(hold);
      // Count the held reply as radio activity so the session stays open.
      this.lastByteAt = Date.now();
    }
    return super.read(n, ms);
  }

  override async setPtt(on: boolean): Promise<void> {
    const now = Date.now();
    const was = this.ptt;
    if (on && !was && this.fault?.kind === 'ptt-control-failed') {
      this.pttLog.push(on);
      throw new TransportError('ptt-control-failed', 'the fake radio failed the DTR set that raises PTT', { target: this.target });
    }
    await super.setPtt(on);
    if (on && !was) {
      this.keyed = { ptt_on_ms: now, ptt_off_ms: null, ...this.transmission(now) };
      this.writePtt(true, now);
      if (this.pttPath !== undefined) {
        this.heartbeat = setInterval(() => {
          try {
            this.writePtt(true, Date.now());
          } catch {
            // Leave the file to go stale; the sim reads a stale file as no carrier.
          }
        }, PTT_HEARTBEAT_MS);
        this.heartbeat.unref();
      }
    } else if (!on && was) {
      this.stopHeartbeat();
      this.keyed!.ptt_off_ms = now;
      this.writePtt(false, now);
    }
  }

  override async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    await this.setPtt(false);
    if (this.tunedNow !== undefined) this.saved.tuneEndedMs = Date.now();
    this.save();
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  /** Add WRONG_FREQ_SHIFT_HZ to the TX frequency of `slot`. */
  private shiftTx(slot: number): void {
    const { freq_hz } = slotTransmission(this.eeprom, slot);
    if (freq_hz !== null) this.eeprom.set(encodeLbcd(freq_hz + WRONG_FREQ_SHIFT_HZ), CHANNEL_BASE + slot * 16 + 4);
  }

  /** Write the PTT file for the current key; skip when TINYSA_SIM_PTT is unset. */
  private writePtt(ptt: boolean, now: number): void {
    if (this.pttPath === undefined || !this.keyed) return;
    const file: PttFile = { run_id: this.runId, written_ms: now, ptt, ...this.keyed };
    try {
      writeJsonAtomic(this.pttPath, file);
    } catch (err) {
      throw new TransportError('file-write-failed', `cannot write TINYSA_SIM_PTT file ${this.pttPath}: ${(err as Error).message}`, { file: this.pttPath });
    }
  }

  /** Save the state file with the last session byte as lastCommandMs. */
  private save(): void {
    if (this.state !== 'idle') this.saved.lastCommandMs = this.lastByteAt;
    try {
      writeJsonAtomic(this.statePath, this.snapshot());
    } catch (err) {
      throw new TransportError('file-write-failed', `cannot write UV5R_FAKE_STATE file ${this.statePath}: ${(err as Error).message}`, { file: this.statePath });
    }
  }
}
