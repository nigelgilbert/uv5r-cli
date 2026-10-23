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
import { BaofengError, DeviceStateError, TransportError } from './errors.ts';
import { Session, hex, settle } from './protocol.ts';
import type { Transport } from './transport.ts';

/** Fixed explanation attached to every status payload. */
export const STATUS_NOTE = 'channelA/B are the values stored in EEPROM; the radio display shows the channel the knob selected';

/** Channel fields every channel payload carries. */
export type ChannelPayload = { channel: number } & Omit<ChannelJson, 'scan'>;

export type ChannelResult = ChannelPayload | { channel: number; empty: true };

export type RadioStatus = {
  firmware: string;
  workmode: 'vfo' | 'channel';
  channelA: number;
  channelB: number;
  squelch: number | string;
  voice: number | string;
  beep: number | string;
  abr: number | string;
  note: string;
} & ChannelResult;

/** Build the flat payload for channel `n`; an undefined record gives `empty: true`. */
export function channelPayload(n: number, ch: Channel | undefined): ChannelResult {
  if (!ch) return { channel: n, empty: true };
  // Destructure the first three keys to keep the documented order, which puts txTone before rxTone.
  const { scan: _scan, rxMhz, txMhz, txTone, ...rest } = channelToJson(ch);
  return { channel: n, rxMhz, txMhz, txTone, ...rest };
}

/** Bytes of ident before main memory in a CHIRP image. */
export const IMAGE_HEADER = 8;

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
  await s.writeBlock(SETTINGS_BASE, block.subarray(0, 0x10));
  await s.writeBlock(SETTINGS_BASE + 0x10, block.subarray(0x10, 0x20));
  await s.writeBlock(SETTINGS_COMMIT, commit);
  return block;
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

/** Start a session on `t`, run `fn` on it and return its result. */
export async function withSession<T>(t: Transport, fn: (s: Session) => Promise<T>): Promise<T> {
  const s = new Session(t);
  await s.start();
  return fn(s);
}

/** Wait for the radio to drop the current session and reload, then start a new session on `t`. */
export async function startFreshSession(t: Transport): Promise<Session> {
  await settle();
  const fresh = new Session(t);
  await fresh.start();
  return fresh;
}

/**
 * Wait for the radio to drop the current session and reload, start a new session on `t`,
 * and verify the settings block against `expected`. Call it after writeSettings.
 */
export async function verifySettingsInFreshSession(t: Transport, expected: Uint8Array): Promise<Settings> {
  return verifySettingsBlock(await startFreshSession(t), expected);
}

/** Read work mode, both channel numbers, the audio settings and the record on the display line in use. */
export async function readStatus(s: Session): Promise<RadioStatus> {
  const ident = s.startedIdent;
  const settings = await readSettings(s);
  const page = await s.readBlock(ADDR.statePage, 0x40);
  const workmode = page[ADDR.workmode - ADDR.statePage] === 1 ? 'channel' : 'vfo';
  const lineB = ((page[ADDR.flags - ADDR.statePage] ?? 0) & 0x80) !== 0;
  const channelA = (page[ADDR.mrcha - ADDR.statePage] ?? 0) & 0x7f;
  const channelB = (page[ADDR.mrchb - ADDR.statePage] ?? 0) & 0x7f;
  const active = lineB ? channelB : channelA;
  const record = channelPayload(active, await readChannel(s, active));
  return {
    firmware: ident.firmware,
    workmode,
    channelA,
    channelB,
    squelch: settings.squelch,
    voice: settings.voice,
    beep: settings.beep,
    abr: settings.abr,
    ...record,
    note: STATUS_NOTE,
  };
}

export async function readChannel(s: Session, n: number): Promise<Channel | undefined> {
  checkChannelNumber(n);
  const mem = await s.readBlock(CHANNEL_BASE + n * 16, 0x10);
  const name = await s.readBlock(NAME_BASE + n * 16, 0x10);
  return decodeChannel(mem, name);
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
  for (const [start, end] of RESTORE_RANGES) {
    for (let a = start; a < end; a += 0x10) {
      await s.writeBlock(a, image.subarray(IMAGE_HEADER + a, IMAGE_HEADER + a + 0x10));
      blocks++;
      onProgress?.(a);
    }
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
export const KEY_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

export interface HoldResult {
  /** True after setPtt(true) succeeded. */
  pttAsserted: true;
  /** Seconds PTT stayed asserted, rounded to 0.1. */
  seconds: number;
  /** True after setPtt(false) succeeded. */
  released: true;
  interrupted?: NodeJS.Signals;
}

/** Message for a failed key, from what the port confirmed. */
function keyFailureMessage(pttAsserted: boolean, released: boolean, cause: string): string {
  if (released) return `PTT assertion unconfirmed: ${cause}; PTT released`;
  const unplug = 'ask the human to unplug the AIOC to drop PTT';
  if (pttAsserted) return `PTT rose and the release is unconfirmed: ${cause}; ${unplug}`;
  return `PTT assertion and release unconfirmed: ${cause}; ${unplug}`;
}

/**
 * Assert PTT for `seconds`, stop early when `signals` emits SIGINT, SIGTERM or SIGHUP, and
 * release PTT in both cases. A failure in any step throws a TransportError whose message
 * and remedy say what the port confirmed.
 */
export async function holdPtt(t: Transport, seconds: number, signals: EventEmitter = process): Promise<HoldResult> {
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
  let pttAsserted = false;
  let released = false;
  let failure: unknown;
  let heldMs = 0;
  let timer: NodeJS.Timeout | undefined;
  try {
    try {
      await t.setPtt(true);
      pttAsserted = true;
      const assertedAt = performance.now();
      if (!interrupted) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, seconds * 1000);
        });
      }
      heldMs = performance.now() - assertedAt;
    } catch (err) {
      failure = err;
    }
    clearTimeout(timer);
    try {
      await t.setPtt(false);
      released = true;
    } catch (err) {
      if (failure === undefined) failure = err;
    }
  } finally {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }
  const held = Math.round(heldMs / 100) / 10;
  if (failure !== undefined) {
    const cause = failure instanceof Error ? failure.message : String(failure);
    const base = failure instanceof BaofengError ? failure.detail : {};
    throw new TransportError(
      'ptt-control-failed',
      keyFailureMessage(pttAsserted, released, cause),
      {
        ...base,
        ...(pttAsserted ? { seconds: held } : {}),
        ...(interrupted ? { interrupted } : {}),
      },
      { remedy: released ? 'report the error and ask the human to check the AIOC cable before keying again' : 'ask the human to unplug the AIOC to drop PTT', retry: 'no' },
    );
  }
  const result: HoldResult = { pttAsserted: true, seconds: held, released: true };
  return interrupted ? { ...result, interrupted } : result;
}
