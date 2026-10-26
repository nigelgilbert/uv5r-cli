import type { EventEmitter } from 'node:events';
import {
  ADDR,
  CHANNEL_BASE,
  NAME_BASE,
  SETTINGS_BASE,
  SETTINGS_COMMIT,
  SETTINGS_SIZE,
  applySettings,
  channelToJson,
  checkChannelNumber,
  decodeChannel,
  decodeSettings,
  encodeChannel,
  encodeName,
  formatMhz,
  type Channel,
  type ChannelJson,
  type ChannelSpec,
  type SettingName,
  type Settings,
} from './codec.ts';
import { BaofengError, DeviceStateError, TransportError, withDetail, type Guidance } from './errors.ts';
import { DEFAULT_MAGIC_ENTRY, FOREIGN_MAGICS, PROGRAM_MAGICS, SCAN_ORDER, findMagic, type Family, type IdentFlags, type Magic, type MagicName } from './ident.ts';
import { ACK, SETTLE_MS, Session, attempt, hex, radioUnsupported, settle, sleep, type AttemptOutcome } from './protocol.ts';
import type { Transport } from './transport.ts';

/** Channel fields every channel payload carries. */
export type ChannelPayload = { channel: number } & Omit<ChannelJson, 'scan'>;

/** A record whose first byte is not 0xFF and whose RX or TX frequency bytes are not valid BCD; raw holds its 16 bytes as hex. */
export interface MalformedRecord {
  malformed: true;
  raw: string;
}

export type ChannelResult = ChannelPayload | { channel: number; empty: true } | ({ channel: number } & MalformedRecord);

export type RadioStatus = {
  firmware: string;
  firmwareHex: string;
  family: Family;
  magic: MagicName;
  /** The 8-byte ident as hex. */
  ident: string;
  workmode: 'vfo' | 'channel';
  squelch: number | string;
  voice: number | string;
  beep: number | string;
  abr: number | string;
};

/** Build the flat payload for channel `n`; an undefined record gives `empty: true`. */
export function channelPayload(n: number, ch: Channel | MalformedRecord | undefined): ChannelResult {
  if (!ch) return { channel: n, empty: true };
  if ('malformed' in ch) return { channel: n, ...ch };
  // Destructure the first three keys to keep the documented order, which puts txTone before rxTone.
  const { scan: _scan, rxMhz, txMhz, txTone, ...rest } = channelToJson(ch);
  return { channel: n, rxMhz, txMhz, txTone, ...rest };
}

/** Bytes of ident before main memory in a CHIRP image. */
export const IMAGE_HEADER = 8;

/** Image offset of the aux block, radio memory 0x1EC0..0x1FFF, in a CHIRP image. */
export const IMAGE_AUX = 0x1808;

/** Read the settings block through its 64-byte page because the radio answers 16-byte reads in 0x0E10..0x0E4F with the 0x0E40 record. */
const SETTINGS_PAGE = 0x0e00;
const SETTINGS_PAGE_OFFSET = SETTINGS_BASE - SETTINGS_PAGE;

/** Read the 32-byte settings block as the radio loaded it at its last reload. */
async function readSettingsBlock(s: Session): Promise<Uint8Array> {
  const page = await s.readBlock(SETTINGS_PAGE, 0x40);
  return page.subarray(SETTINGS_PAGE_OFFSET, SETTINGS_PAGE_OFFSET + SETTINGS_SIZE);
}

export async function readSettings(s: Session): Promise<Settings> {
  return decodeSettings(await readSettingsBlock(s));
}

/**
 * Set the fields in `patch` and commit the block. The radio stages 0x0E20 and 0x0E30 in a
 * zero-filled buffer and writes it to EEPROM when a write lands at 0x0E40, so both halves
 * go every time, followed by the 0x0E40 record unchanged. Returns the block written; it
 * reads back only in a later session, see verifySettingsInFreshSession.
 */
export async function writeSettings(s: Session, patch: Partial<Record<SettingName, number>>): Promise<Uint8Array> {
  const block = applySettings(await readSettingsBlock(s), patch);
  const commit = (await s.readBlock(SETTINGS_COMMIT, 0x40)).subarray(0, 0x10);
  try {
    await s.writeBlock(SETTINGS_BASE, block.subarray(0, 0x10));
    await s.writeBlock(SETTINGS_BASE + 0x10, block.subarray(0x10, 0x20));
    await s.writeBlock(SETTINGS_COMMIT, commit);
  } catch (err) {
    throw unacknowledged(err, { remedy: 'run uv5r settings to read the block, then rerun', retry: 'after-remedy' });
  }
  return block;
}

/** Return `err`, with `guidance` replacing the slot remedy when the radio did not ack a write. */
function unacknowledged(err: unknown, guidance: Partial<Guidance>): unknown {
  if (err instanceof BaofengError && err.reason === 'write-unacknowledged') err.attach({}, guidance);
  return err;
}

/** Read the settings block in a fresh session and fail when it differs from `expected`. */
export async function verifySettingsBlock(s: Session, expected: Uint8Array): Promise<Settings> {
  const back = await readSettingsBlock(s);
  if (hex(back) !== hex(expected)) {
    throw new DeviceStateError(
      'verification-failed',
      'settings block did not take the write',
      { wrote: hex(expected), read: hex(back) },
      { remedy: 'run uv5r settings to read the block, then rerun the write' },
    );
  }
  return decodeSettings(back);
}

/** How a clone session opens; `magic` defaults to 291. */
export interface SessionOptions {
  magic?: Magic;
}

/** Start a session on `t` with `options.magic`, run `fn` on it and return its result. */
export async function withSession<T>(t: Transport, fn: (s: Session) => Promise<T>, options: SessionOptions = {}): Promise<T> {
  const s = new Session(t);
  await s.start(options.magic);
  return fn(s);
}

/** Wait for the radio to drop the current session and reload, then start a new session on `t` with `options.magic`. */
export async function startFreshSession(t: Transport, options: SessionOptions = {}): Promise<Session> {
  await settle();
  const fresh = new Session(t);
  await fresh.start(options.magic);
  return fresh;
}

/**
 * Wait for the radio to drop the current session and reload, start a new session on `t`
 * with `options.magic`, and verify the settings block against `expected`. Call it after
 * writeSettings.
 */
export async function verifySettingsInFreshSession(t: Transport, expected: Uint8Array, options: SessionOptions = {}): Promise<Settings> {
  return verifySettingsBlock(await startFreshSession(t, options), expected);
}

/** Pause after a wrong ack before the next attempt in identify. */
export const SCAN_WRONG_ACK_PAUSE_MS = 2000;
/** Pause after a 115200 probe that got no 06 before the next program magic. */
export const PROGRAM_PAUSE_MS = 1000;
/** Baud rate of the classic clone protocol. */
const CLASSIC_BAUD = 9600;
/** Baud rate of the UV17Pro program magics. */
const PROGRAM_BAUD = 115200;
/** Wait for the one-byte reply to a program magic. */
const PROGRAM_ACK_WAIT_MS = 1200;
/** Remedy for a 115200 ack, which leaves the radio in program mode with no exit command. */
const POWER_CYCLE_REMEDY = 'ask the human to power-cycle the radio and report the radio name; this CLI speaks the classic UV-5R protocol';
/** Radio names for the magics this CLI recognizes and refuses, by family. */
const UNSUPPORTED_RADIOS: Partial<Record<Family, string>> = { 'f-11': 'Baofeng F-11', 'uv-6': 'Baofeng UV-6' };

/** One attempt as identify reports it after the attempt ends; a 115200 probe ends `silent`, `wrong-ack` or `ack`. */
export interface IdentifyAttempt {
  name: string;
  baud: number;
  outcome: AttemptOutcome['kind'] | 'ack';
}

/** A wrong ack, a refused closing 06, or a bad ident on a foreign or unsupported magic, by magic name, with the reply bytes as hex. */
export interface IdentifyAnswer {
  magic: string;
  outcome: 'wrong-ack' | 'refused' | 'invalid';
  got: string;
}

/** The magic that opened a clone session in identify, with what the handshake read. */
export interface IdentifyResult {
  magic: MagicName;
  /** The 8-byte ident as hex. */
  ident: string;
  firmware: string;
  firmwareHex: string;
  family: Family;
  flags: IdentFlags;
  droppedByte: boolean;
  /** The UV5R_MAGIC line to put before every later uv5r command when the answering magic differs from the selected one, else null. */
  pin: string | null;
}

/**
 * Scan state shared across phases: the pause owed before the next attempt, the wrong acks,
 * refusals and foreign or unsupported bad idents seen, and the first invalid supported ident.
 */
interface Scan {
  transport: Transport;
  onAttempt: (a: IdentifyAttempt) => void;
  pauseMs: number;
  answers: IdentifyAnswer[];
  invalid: { magic: string; got: string } | undefined;
}

/**
 * Wait the pause the last attempt owes, run one attempt with `magic`, report it and record its
 * answer. A bad ident on a supported magic counts as the scan's invalid ident. A bad ident on
 * an unsupported or foreign magic, which has no `supported` field, joins the answers.
 */
async function probe(scan: Scan, name: string, magic: Pick<Magic, 'bytes'> & Partial<Pick<Magic, 'supported'>>, confirm: boolean): Promise<AttemptOutcome> {
  if (scan.pauseMs > 0) await sleep(scan.pauseMs);
  const outcome = await attempt(scan.transport, magic, { confirm });
  scan.onAttempt({ name, baud: CLASSIC_BAUD, outcome: outcome.kind });
  if (outcome.kind === 'wrong-ack' || outcome.kind === 'refused') scan.answers.push({ magic: name, outcome: outcome.kind, got: outcome.got });
  if (outcome.kind === 'invalid' && magic.supported) scan.invalid ??= { magic: name, got: outcome.got };
  else if (outcome.kind === 'invalid') scan.answers.push({ magic: name, outcome: 'invalid', got: outcome.got });
  scan.pauseMs = outcome.kind === 'silent' ? 0 : outcome.kind === 'wrong-ack' ? SCAN_WRONG_ACK_PAUSE_MS : SETTLE_MS;
  return outcome;
}

/** Return the scan order with `first` moved to the front. */
function scanOrder(first: Magic): Magic[] {
  const rest = SCAN_ORDER.filter((name) => name !== first.name).map((name) => findMagic(name)!);
  return [first, ...rest];
}

/**
 * Try each classic magic in SCAN_ORDER, with `options.magic` moved to the front, and return
 * the first that opens a clone session. Each supported magic gets a second attempt on silence
 * or a wrong ack; the first magic's second attempt waits SETTLE_MS. Other attempts follow silence at
 * once, a wrong ack after SCAN_WRONG_ACK_PAUSE_MS, and an invalid ident or a refused closing
 * 06 after SETTLE_MS. Unsupported magics get one attempt and run without the closing 06; an
 * ident on one, a 14-byte ident on any, or a BF-A58 version under A58 throws radio-unsupported.
 * A bad ident on an unsupported magic joins the answers.
 *
 * When no classic magic opens a session, probe each FOREIGN_MAGICS entry at 9600 without the
 * closing 06 and with the same pauses; an ident names that entry's radio. Then send each
 * PROGRAM_MAGICS entry at 115200, PROGRAM_PAUSE_MS apart; an 06 names the model group with
 * `powerCycle: true`. Calls `onAttempt` after each attempt.
 *
 * A scan that opens no session throws protocol-reply-invalid for the first bad ident on a
 * supported magic. Otherwise it throws session-unavailable with the answers, and a refused
 * closing 06 among them sets retry `once` as Session.start does.
 */
export async function identify(transport: Transport, onAttempt: (a: IdentifyAttempt) => void = () => {}, options: SessionOptions = {}): Promise<IdentifyResult> {
  const selected = options.magic ?? DEFAULT_MAGIC_ENTRY;
  const scan: Scan = { transport, onAttempt, pauseMs: 0, answers: [], invalid: undefined };
  for (const [i, magic] of scanOrder(selected).entries()) {
    let outcome = await probe(scan, magic.name, magic, magic.supported);
    if (magic.supported && (outcome.kind === 'silent' || outcome.kind === 'wrong-ack')) {
      if (i === 0) scan.pauseMs = SETTLE_MS;
      outcome = await probe(scan, magic.name, magic, magic.supported);
    }
    if (outcome.kind === 'foreign') throw radioUnsupported(outcome.name, magic.name, outcome.got);
    if (outcome.kind !== 'ident') continue;
    if (!magic.supported) throw radioUnsupported(UNSUPPORTED_RADIOS[magic.families[0]!] ?? magic.name, magic.name, outcome.got);
    const id = await new Session(transport).finish(magic, outcome.bytes, outcome.got);
    return {
      magic: id.magic,
      ident: hex(id.bytes),
      firmware: id.firmware,
      firmwareHex: id.firmwareHex,
      family: id.family,
      flags: id.flags,
      droppedByte: id.droppedByte,
      pin: id.magic === selected.name ? null : `UV5R_MAGIC=${id.magic}`,
    };
  }
  for (const entry of FOREIGN_MAGICS) {
    const outcome = await probe(scan, entry.radio, entry, false);
    if (outcome.kind === 'ident' || outcome.kind === 'foreign') throw radioUnsupported(entry.radio, hex(entry.bytes), outcome.got);
  }
  await programScan(scan);
  throw scanFailed(scan);
}

/**
 * Switch the port to 115200 and send each program magic in one write, PROGRAM_PAUSE_MS apart.
 * An 06 throws radio-unsupported with the power-cycle remedy. The port returns to 9600 in a
 * finally; a failed reset throws only when the scan itself raised no error.
 */
async function programScan(scan: Scan): Promise<void> {
  const { transport } = scan;
  let finished = false;
  try {
    await transport.setBaud(PROGRAM_BAUD);
    for (const entry of PROGRAM_MAGICS) {
      const { name } = entry;
      if (scan.pauseMs > 0) await sleep(scan.pauseMs);
      transport.discard();
      transport.write(entry.bytes);
      const reply = await transport.read(1, PROGRAM_ACK_WAIT_MS);
      const outcome = reply.length === 0 ? 'silent' : reply[0] === ACK ? 'ack' : 'wrong-ack';
      scan.onAttempt({ name, baud: PROGRAM_BAUD, outcome });
      if (outcome === 'ack') {
        throw new DeviceStateError(
          'radio-unsupported',
          `the radio acked ${name} at ${PROGRAM_BAUD} baud, which names the ${entry.radio}; it stays in program mode until power-cycled`,
          { radio: entry.radio, magic: name, got: hex(reply), powerCycle: true },
          { remedy: POWER_CYCLE_REMEDY },
        );
      }
      if (outcome === 'wrong-ack') scan.answers.push({ magic: name, outcome, got: hex(reply) });
      scan.pauseMs = PROGRAM_PAUSE_MS;
    }
    finished = true;
  } finally {
    await transport.setBaud(CLASSIC_BAUD).catch((err: unknown) => {
      if (finished) throw err;
    });
  }
}

/**
 * Return the error for a scan that opened no session: the first invalid supported ident, else
 * the answers. A refused closing 06 in the answers gives the Session.start remedy and retry.
 */
function scanFailed(scan: Scan): DeviceStateError {
  if (scan.invalid) {
    const { magic, got } = scan.invalid;
    return new DeviceStateError('protocol-reply-invalid', `radio answered magic ${magic} with ${got ? `ident ${got} of no known shape` : 'no ident bytes'}, as an unknown UV-5R variant`, {
      magic,
      got,
      answers: scan.answers,
    });
  }
  const answers = scan.answers.map((a) => `${a.magic} ${a.outcome}${a.got ? ` ${a.got}` : ''}`).join(', ');
  if (scan.answers.length === 0) {
    return new DeviceStateError(
      'session-unavailable',
      'radio did not answer any classic magic, foreign magic or 115200 program magic',
      { answers: scan.answers },
      { remedy: 'ask the human to check the radio is on and the cable is seated', retry: 'after-remedy' },
    );
  }
  if (scan.answers.some((a) => a.outcome === 'refused')) {
    return new DeviceStateError(
      'session-unavailable',
      `radio opened no clone session; answers: ${answers}`,
      { answers: scan.answers },
      { remedy: 'wait 3 s and rerun the command', retry: 'once' },
    );
  }
  return new DeviceStateError(
    'session-unavailable',
    `radio opened no clone session; answers: ${answers}`,
    { answers: scan.answers },
    { remedy: 'report the answers to the human; the radio answers but opens no session with a known magic', retry: 'no' },
  );
}

/** Read the firmware, the work mode and the audio settings, with the magic, ident and family from the handshake. */
export async function readStatus(s: Session): Promise<RadioStatus> {
  const ident = s.startedIdent;
  const settings = await readSettings(s);
  const page = await s.readBlock(ADDR.statePage, 0x40);
  const workmode = page[ADDR.workmode - ADDR.statePage] === 1 ? 'channel' : 'vfo';
  return {
    firmware: ident.firmware,
    firmwareHex: ident.firmwareHex,
    family: ident.family,
    magic: ident.magic,
    ident: hex(ident.bytes),
    workmode,
    squelch: settings.squelch,
    voice: settings.voice,
    beep: settings.beep,
    abr: settings.abr,
  };
}

/** Read channel `n`; an erased slot gives undefined and a record with bad BCD gives a MalformedRecord. */
export async function readChannel(s: Session, n: number): Promise<Channel | MalformedRecord | undefined> {
  checkChannelNumber(n);
  const mem = await s.readBlock(CHANNEL_BASE + n * 16, 0x10);
  const name = await s.readBlock(NAME_BASE + n * 16, 0x10);
  return decodeSlot(mem, name);
}

/** Decode a channel record and its name record. Return undefined for a 0xFF first byte and a MalformedRecord for bad BCD. */
export function decodeSlot(mem: Uint8Array, name: Uint8Array): Channel | MalformedRecord | undefined {
  const ch = decodeChannel(mem, name);
  if (ch === undefined && mem[0] !== 0xff) return { malformed: true, raw: hex(mem) };
  return ch;
}

/**
 * Write a channel record and read it back, then write its name and read that back, all in
 * one session. Reads the old record first so encodeChannel keeps its BCL, PTT-ID, S-code and
 * scan settings.
 */
export async function writeChannel(s: Session, n: number, spec: ChannelSpec): Promise<Channel> {
  checkChannelNumber(n);
  const prior = await s.readBlock(CHANNEL_BASE + n * 16, 0x10);
  const mem = encodeChannel(spec, prior);
  const name = encodeName(spec.name ?? formatMhz(spec.rxHz));
  await s.writeBlock(CHANNEL_BASE + n * 16, mem);
  const back = await s.readBlock(CHANNEL_BASE + n * 16, 0x10);
  if (hex(back) !== hex(mem)) {
    throw new DeviceStateError(
      'verification-failed',
      `channel ${n} did not take the write`,
      { wrote: hex(mem), read: hex(back) },
      { remedy: `read channel ${n}, then rerun the write` },
    );
  }
  const nameBack = await writeAndReadBack(s, NAME_BASE + n * 16, name);
  if (hex(nameBack) !== hex(name)) {
    throw new DeviceStateError(
      'verification-failed',
      `channel ${n} record written; name did not take the write`,
      { wrote: hex(name), read: hex(nameBack) },
      { remedy: `read channel ${n}; rerun the write to fix the name` },
    );
  }
  return decodeChannel(back, nameBack)!;
}

/**
 * Write 0xFF over a channel record and read it back, then over its name and read that back,
 * all in one session.
 */
export async function eraseChannel(s: Session, n: number): Promise<void> {
  checkChannelNumber(n);
  const blank = new Uint8Array(16).fill(0xff);
  await s.writeBlock(CHANNEL_BASE + n * 16, blank);
  const back = await s.readBlock(CHANNEL_BASE + n * 16, 0x10);
  if (hex(back) !== hex(blank)) {
    throw new DeviceStateError(
      'verification-failed',
      `channel ${n} did not take the erase`,
      { wrote: hex(blank), read: hex(back) },
      { remedy: `read channel ${n}, then rerun the erase` },
    );
  }
  const nameBack = await writeAndReadBack(s, NAME_BASE + n * 16, blank);
  if (hex(nameBack) !== hex(blank)) {
    throw new DeviceStateError(
      'verification-failed',
      `channel ${n} record erased; name did not take the erase`,
      { wrote: hex(blank), read: hex(nameBack) },
      { remedy: `read channel ${n}; rerun the erase to clear the name` },
    );
  }
}

/** Write one 16-byte block at `addr` and return what reads back there. */
async function writeAndReadBack(s: Session, addr: number, data: Uint8Array): Promise<Uint8Array> {
  await s.writeBlock(addr, data);
  return s.readBlock(addr, 0x10);
}

/** Full image in CHIRP layout: 8-byte ident, main 0x0000-0x17FF, aux 0x1EC0-0x1FFF. */
export async function dumpImage(s: Session, onProgress?: (addr: number) => void): Promise<Uint8Array> {
  const ident = s.startedIdent;
  const out: number[] = [...ident.bytes];
  for (let a = 0; a < 0x1800; a += 0x40) {
    out.push(...(await s.readBlock(a, 0x40)));
    onProgress?.(a);
  }
  if (ident.droppedByte) {
    for (let a = 0x1ec0; a < 0x1fc0; a += 0x40) out.push(...(await s.readBlock(a, 0x40)));
    for (let a = 0x1fc0; a < 0x2000; a += 0x10) out.push(...(await s.readBlock(a, 0x10)));
  } else {
    for (let a = 0x1ec0; a < 0x2000; a += 0x40) out.push(...(await s.readBlock(a, 0x40)));
  }
  return Uint8Array.from(out);
}

/** Main-memory ranges CHIRP uploads by default, as radio addresses. */
export const RESTORE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x0cf0],
  [0x0d00, 0x0df0],
  [0x0e00, 0x1800],
];

/** The settings block as an image stores it, for verifySettingsBlock after a restore. */
export function imageSettingsBlock(image: Uint8Array): Uint8Array {
  return image.subarray(IMAGE_HEADER + SETTINGS_BASE, IMAGE_HEADER + SETTINGS_BASE + SETTINGS_SIZE);
}

/**
 * Write the main memory of an image back; aux memory stays untouched. The 16-byte blocks go
 * in address order, so the 0x0E40 write commits the staged settings block.
 */
export async function restoreImage(s: Session, image: Uint8Array, onProgress?: (addr: number) => void): Promise<number> {
  if (image.length < IMAGE_HEADER + 0x1800) throw new DeviceStateError('image-incompatible', `image too short: ${image.length} bytes`, { bytes: image.length });
  const ident = s.startedIdent;
  if (hex(image.subarray(0, IMAGE_HEADER)) !== hex(ident.bytes)) {
    throw new DeviceStateError('image-incompatible', 'image ident does not match this radio', { image: hex(image.subarray(0, IMAGE_HEADER)), radio: hex(ident.bytes) });
  }
  let blocks = 0;
  try {
    for (const [start, end] of RESTORE_RANGES) {
      for (let a = start; a < end; a += 0x10) {
        await s.writeBlock(a, image.subarray(IMAGE_HEADER + a, IMAGE_HEADER + a + 0x10));
        blocks++;
        onProgress?.(a);
      }
    }
  } catch (err) {
    throw unacknowledged(err, { remedy: 'rerun the restore' });
  }
  return blocks;
}

/** Channel records and names, the restored ranges the radio takes on write and verifyRestoredRanges reads back. */
export const VERIFY_RANGES: ReadonlyArray<readonly [number, number]> = [
  [CHANNEL_BASE, CHANNEL_BASE + 0x0800],
  [NAME_BASE, NAME_BASE + 0x0800],
];

/** Mismatches listed in the error detail of verifyRestoredRanges. */
const MISMATCHES_REPORTED = 4;

/**
 * Read back VERIFY_RANGES in 64-byte blocks and compare each 16-byte row with the image.
 * Run it in a fresh session after restoreImage. Throws DeviceStateError listing the first
 * mismatched rows; returns the number of 64-byte blocks compared.
 */
export async function verifyRestoredRanges(s: Session, image: Uint8Array): Promise<number> {
  const mismatches: Array<{ addr: string; wrote: string; read: string }> = [];
  let blocks = 0;
  for (const [start, end] of VERIFY_RANGES) {
    for (let a = start; a < end; a += 0x40) {
      const back = await s.readBlock(a, 0x40);
      blocks++;
      for (let row = 0; row < 0x40; row += 0x10) {
        const wrote = hex(image.subarray(IMAGE_HEADER + a + row, IMAGE_HEADER + a + row + 0x10));
        const read = hex(back.subarray(row, row + 0x10));
        if (wrote !== read) mismatches.push({ addr: `0x${(a + row).toString(16).padStart(4, '0')}`, wrote, read });
      }
    }
  }
  if (mismatches.length > 0) {
    throw new DeviceStateError(
      'verification-failed',
      `restore did not take ${mismatches.length} blocks; first at ${mismatches[0]!.addr}`,
      { mismatches: mismatches.length, first: mismatches.slice(0, MISMATCHES_REPORTED) },
      { remedy: 'rerun the restore; ask the human if the same blocks fail again' },
    );
  }
  return blocks;
}

/** Signals that end a key early. */
export const KEY_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGTSTP'];

/** Milliseconds keyWhile waits for the body after it drops PTT on a signal or at maxMs. */
export const STOP_GRACE_MS = 2000;
/** Milliseconds holdPtt adds to its hold for the keyWhile watchdog. */
const HOLD_WATCHDOG_SLACK_MS = 5000;
/** Milliseconds keyWhile waits for the port to confirm each PTT change. */
export const PTT_CONTROL_TIMEOUT_MS = 3000;
const UNPLUG = 'ask the human to unplug the AIOC to drop PTT';

export interface HoldResult {
  /** True after setPtt(true) succeeded. */
  pttAsserted: true;
  /** Seconds PTT stayed asserted, rounded to 0.1. */
  seconds: number;
  /** True after setPtt(false) succeeded. */
  released: true;
  interrupted?: NodeJS.Signals;
  /** True when keyWhile dropped PTT at maxMs before the body settled. */
  timedOut?: true;
}

/** Limits on one keyWhile transmission. */
export interface KeyOptions {
  /** Milliseconds after the assertion at which keyWhile drops PTT and stops the body. */
  maxMs: number;
}

/** Message for a failed key, from what the port confirmed and whether a timed-out assertion may still land. */
function keyFailureMessage(pttAsserted: boolean, released: boolean, lateAssert: boolean, cause: string): string {
  if (pttAsserted && !released) return `PTT rose and the release is unconfirmed: ${cause}; ${UNPLUG}`;
  if (!released) return `PTT assertion and release unconfirmed: ${cause}; ${UNPLUG}`;
  if (lateAssert) return `PTT assertion unconfirmed: ${cause}; ${UNPLUG}`;
  return `PTT assertion unconfirmed: ${cause}; PTT released`;
}

/** Return the message of `err`, or `err` as a string. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Set PTT on `t` and reject when the port gives no confirmation within PTT_CONTROL_TIMEOUT_MS.
 * The timeout error carries detail `timedOut: true`. After a timed-out assertion, a late
 * completion drops PTT again.
 */
async function setPttWithin(t: Transport, on: boolean): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new TransportError('ptt-control-failed', `the port did not confirm PTT ${on ? 'high' : 'low'} within ${PTT_CONTROL_TIMEOUT_MS / 1000} s`, { timedOut: true })),
      PTT_CONTROL_TIMEOUT_MS,
    );
  });
  const set = t.setPtt(on);
  // Attach a handler so a rejection after the timeout stays handled.
  set.catch(() => {});
  try {
    await Promise.race([set, late]);
  } catch (err) {
    // Lower PTT when a timed-out assertion completes late.
    if (on && err instanceof BaofengError && err.detail.timedOut === true) void set.then(() => t.setPtt(false), () => {}).catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve after `ms`, or as soon as `stop` resolves, and leave no timer pending. */
export function wait(ms: number, stop: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void stop.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Assert PTT on `t`, run `body(stop)` and release PTT when the body settles, when `signals`
 * emits one of KEY_SIGNALS, or when `options.maxMs` passes after the assertion. On a signal
 * or at maxMs, drop PTT first, then resolve `stop` and wait up to STOP_GRACE_MS for the body.
 * A signal that arrives while PTT rises skips the body and releases at once. A body rejection
 * after a signal or maxMs counts as the stop and fails nothing.
 *
 * The first failure wins. A PTT failure throws ptt-control-failed with what the port
 * confirmed. Each PTT change gets PTT_CONTROL_TIMEOUT_MS; a late assertion counts as a failed
 * one and keyWhile still releases. A body failure keeps its own reason and gains `seconds`
 * and any `interrupted`. When the release fails or the assertion timed out, the message and
 * remedy tell the human to unplug the AIOC.
 */
export async function keyWhile(t: Transport, body: (stop: Promise<void>) => Promise<unknown>, options: KeyOptions, signals: EventEmitter = process): Promise<HoldResult> {
  let interrupted: NodeJS.Signals | undefined;
  let wake = () => {};
  const handlers = KEY_SIGNALS.map((signal) => {
    const handler = () => {
      if (interrupted) return;
      interrupted = signal;
      wake();
    };
    signals.on(signal, handler);
    return [signal, handler] as const;
  });
  let resolveStop = () => {};
  const stop = new Promise<void>((resolve) => (resolveStop = resolve));
  let pttAsserted = false;
  let released = false;
  let failure: { err: unknown; fromBody: boolean } | undefined;
  let releaseCause = '';
  let lateAssert = false;
  let stopped = false;
  let timedOut = false;
  let running: Promise<void> | undefined;
  let heldMs = 0;
  let watchdog: NodeJS.Timeout | undefined;
  try {
    try {
      await setPttWithin(t, true);
      pttAsserted = true;
      const assertedAt = performance.now();
      if (!interrupted) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const end = (byStop: boolean) => {
            if (settled) return;
            settled = true;
            stopped = byStop;
            resolve();
          };
          wake = () => end(true);
          watchdog = setTimeout(() => {
            if (!settled) timedOut = true;
            end(true);
          }, options.maxMs);
          running = new Promise<unknown>((r) => r(body(stop))).then(
            () => end(false),
            (err: unknown) => {
              if (!settled) failure = { err, fromBody: true };
              end(false);
            },
          );
        });
      }
      heldMs = performance.now() - assertedAt;
    } catch (err) {
      failure = { err, fromBody: false };
      lateAssert = !pttAsserted && err instanceof BaofengError && err.detail.timedOut === true;
    }
    clearTimeout(watchdog);
    try {
      await setPttWithin(t, false);
      released = true;
    } catch (err) {
      releaseCause = messageOf(err);
      failure ??= { err, fromBody: false };
    }
    resolveStop();
    if (stopped && running) {
      let grace: NodeJS.Timeout | undefined;
      await Promise.race([running, new Promise<void>((resolve) => (grace = setTimeout(resolve, STOP_GRACE_MS)))]);
      clearTimeout(grace);
    }
  } finally {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }
  const held = Math.round(heldMs / 100) / 10;
  if (failure?.fromBody) {
    const err = withDetail(failure.err, { seconds: held, ...(interrupted ? { interrupted } : {}) });
    if (!released) {
      err.message = `${err.message}; PTT release unconfirmed: ${releaseCause}; ${UNPLUG}`;
      err.attach({}, { remedy: UNPLUG, retry: 'no' });
    }
    throw err;
  }
  if (failure) {
    const { timedOut: _, ...base } = failure.err instanceof BaofengError ? failure.err.detail : {};
    throw new TransportError(
      'ptt-control-failed',
      keyFailureMessage(pttAsserted, released, lateAssert, messageOf(failure.err)),
      {
        ...base,
        ...(pttAsserted ? { seconds: held } : {}),
        ...(interrupted ? { interrupted } : {}),
      },
      { remedy: released && !lateAssert ? 'report the error and ask the human to check the AIOC cable before keying again' : UNPLUG, retry: 'no' },
    );
  }
  const result: HoldResult = { pttAsserted: true, seconds: held, released: true };
  if (interrupted) result.interrupted = interrupted;
  if (timedOut) result.timedOut = true;
  return result;
}

/**
 * Assert PTT for `seconds` through keyWhile, stop early when `signals` emits one of
 * KEY_SIGNALS, and release PTT in both cases. A failure in any step throws a TransportError
 * whose message and remedy say what the port confirmed.
 */
export function holdPtt(t: Transport, seconds: number, signals: EventEmitter = process): Promise<HoldResult> {
  const ms = seconds * 1000;
  return keyWhile(t, (stop) => wait(ms, stop), { maxMs: ms + HOLD_WATCHDOG_SLACK_MS }, signals);
}
