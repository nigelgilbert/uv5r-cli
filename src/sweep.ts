import type { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { listen, play } from './audio.ts';
import { decodeChannel, encodeChannel, encodeName, formatMhz } from './codec.ts';
import { DeviceStateError, UsageError } from './errors.ts';
import type { PlanEntry } from './plan.ts';
import { settle, type Session } from './protocol.ts';
import { KEY_SIGNALS, channelPayload, readChannel, withSession, writeChannel, type ChannelResult } from './radio.ts';
import type { Transport } from './transport.ts';

/** Seconds `sweep` dwells on each entry when the caller gives no length. */
export const SWEEP_SECONDS = 30;

export interface DwellOptions {
  /** avfoundation audio input to capture from. */
  device: string;
  /** Whole seconds to capture per entry. */
  seconds: number;
  /** A second is active when its RMS is above this level in dBFS. */
  floorDbfs: number;
  /** Directory that takes one WAV per dwell; undefined keeps no capture. */
  outDir?: string;
  /** Play each active capture through afplay after its dwell; needs outDir. */
  play: boolean;
}

/** One finished dwell, as `--verbose` prints it. */
export interface DwellRecord {
  channel: number;
  name: string;
  rxMhz: string;
  activeSeconds: number;
  active: boolean[];
  meanRmsDbfs: number | null;
  peakDbfs: number | null;
  warnings: string[];
  out?: string;
}

/** An entry with at least one active second, as the summary lists it. */
export interface ActiveEntry {
  channel: number;
  name: string;
  rxMhz: string;
  activeSeconds: number;
  out?: string;
}

export interface SweepSummary {
  /** Count of entries whose dwell finished. */
  swept: number;
  seconds: number;
  active: ActiveEntry[];
  /** Warnings from every dwell, each prefixed with its plan channel. */
  warnings: string[];
  /** Signal that ended the loop early. */
  interrupted?: NodeJS.Signals;
}

/** Signal state shared by the loop and the steps that wait on the radio. */
export interface Stop {
  /** Signal that arrived, once one has. */
  signal: NodeJS.Signals | undefined;
  /** Resolves when a signal arrives. */
  stopped: Promise<void>;
}

/** Put the radio on `entry` before its dwell; resolve early when `stop.stopped` resolves. */
export type Prepare = (entry: PlanEntry, stop: Stop) => Promise<void>;

/** Name a capture from the plan channel and the local start time, as in ch07-2026-10-18T00-15-00.wav. */
export function captureName(channel: number, start: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}T${p(start.getHours())}-${p(start.getMinutes())}-${p(start.getSeconds())}`;
  return `ch${p(channel)}-${time}.wav`;
}

/**
 * Capture `options.seconds` on the channel the radio is on and report it as `entry`.
 * With `outDir` the capture goes to a WAV named by captureName. With `play`, afplay plays
 * the WAV when any second is active. A playback that a signal cuts short still returns the record.
 */
export async function dwell(entry: PlanEntry, options: DwellOptions, stop: Stop): Promise<DwellRecord> {
  const out = options.outDir === undefined ? undefined : join(options.outDir, captureName(entry.channel, new Date()));
  const heard = await listen(options.device, options.seconds, options.floorDbfs, { out, play: false });
  const record: DwellRecord = {
    channel: entry.channel,
    name: entry.spec.name ?? formatMhz(entry.spec.rxHz),
    rxMhz: formatMhz(entry.spec.rxHz),
    activeSeconds: heard.activeSeconds,
    active: heard.active,
    meanRmsDbfs: heard.meanRmsDbfs,
    peakDbfs: heard.peakDbfs,
    warnings: heard.warnings,
    ...(out === undefined ? {} : { out }),
  };
  if (options.play && out !== undefined && heard.activeSeconds > 0) {
    try {
      await play(out, options.seconds);
    } catch (err) {
      if (stop.signal === undefined) throw err;
    }
  }
  return record;
}

/** Return a Prepare that writes each entry into slot `n` in a fresh clone session and waits for the reload. */
export function scratchSlot(t: Transport, n: number): Prepare {
  return async (entry, stop) => {
    await withSession(t, (s) => writeChannel(s, n, entry.spec));
    await Promise.race([settle(), stop.stopped]);
  };
}

/** Return the record `entry` puts in its slot, in the channelPayload shape `read` prints. */
export function planRecord(entry: PlanEntry): ChannelResult {
  const { channel, spec } = entry;
  return channelPayload(channel, decodeChannel(encodeChannel(spec), encodeName(spec.name ?? formatMhz(spec.rxHz))));
}

/**
 * Read every plan slot in session `s` and compare each with its plan record. Throws
 * DeviceStateError naming the first channel that differs, with both records, and naming
 * `load` as the fix. The detail lists every channel that differs.
 */
export async function verifyPlanSlots(s: Session, entries: readonly PlanEntry[], file: string): Promise<void> {
  const differ: Array<{ channel: number; plan: ChannelResult; radio: ChannelResult }> = [];
  for (const entry of entries) {
    const plan = planRecord(entry);
    const radio = channelPayload(entry.channel, await readChannel(s, entry.channel));
    if (JSON.stringify(radio) !== JSON.stringify(plan)) differ.push({ channel: entry.channel, plan, radio });
  }
  const first = differ[0];
  if (first === undefined) return;
  const also = differ.length > 1 ? `; channels ${differ.slice(1).map((d) => d.channel).join(', ')} differ too` : '';
  throw new DeviceStateError(
    `channel ${first.channel} differs from the plan: plan ${JSON.stringify(first.plan)}, radio ${JSON.stringify(first.radio)}${also}; run uv5r load ${file} to write the plan`,
    { channel: first.channel, plan: first.plan, radio: first.radio, differ: differ.map((d) => d.channel) },
  );
}

/** Lines read from a stream, one per call to `next`; `next` resolves undefined once the stream ends. */
export interface Lines {
  next(): Promise<string | undefined>;
  close(): void;
}

/** Read lines from `input` and queue the ones that arrive before a call to `next`. */
export function readLines(input: NodeJS.ReadableStream): Lines {
  const rl = createInterface({ input, terminal: false });
  const queue: string[] = [];
  let waiter: ((line: string | undefined) => void) | undefined;
  let ended = false;
  rl.on('line', (line) => {
    if (waiter === undefined) queue.push(line);
    else {
      waiter(line);
      waiter = undefined;
    }
  });
  rl.on('close', () => {
    ended = true;
    waiter?.(undefined);
    waiter = undefined;
  });
  return {
    next: () => {
      if (queue.length > 0) return Promise.resolve(queue.shift());
      if (ended) return Promise.resolve(undefined);
      return new Promise((resolve) => (waiter = resolve));
    },
    close: () => rl.close(),
  };
}

/** Return a Prepare that asks the human through `write` to turn the knob to the entry's slot and waits for a line. */
export function knobSlot(lines: Lines, write: (text: string) => void): Prepare {
  return async (entry, stop) => {
    write(`turn the knob to channel ${entry.channel} (${entry.spec.name ?? formatMhz(entry.spec.rxHz)}) and press Enter\n`);
    const line = await Promise.race([lines.next(), stop.stopped.then(() => '')]);
    if (line === undefined && stop.signal === undefined) throw new UsageError(`stdin closed before channel ${entry.channel}; press Enter at each prompt`);
  };
}

/**
 * Prepare and dwell on each entry in order, call `onDwell` as each dwell ends, and summarize.
 * SIGINT, SIGTERM or SIGHUP ends the loop. The summary then covers the dwells finished
 * before the signal and names it in `interrupted`. A dwell whose capture the signal cut
 * short is left out.
 */
export async function runSweep(
  entries: readonly PlanEntry[],
  prepare: Prepare,
  options: DwellOptions,
  onDwell: (record: DwellRecord) => void,
  signals: EventEmitter = process,
): Promise<SweepSummary> {
  let wake = () => {};
  const stop: Stop = { signal: undefined, stopped: new Promise<void>((resolve) => (wake = resolve)) };
  const handlers = KEY_SIGNALS.map((signal) => {
    const handler = () => {
      if (stop.signal) return;
      stop.signal = signal;
      wake();
    };
    signals.on(signal, handler);
    return [signal, handler] as const;
  });
  const records: DwellRecord[] = [];
  try {
    for (const entry of entries) {
      if (stop.signal) break;
      let record: DwellRecord;
      try {
        await prepare(entry, stop);
        if (stop.signal) break;
        record = await dwell(entry, options, stop);
      } catch (err) {
        if (stop.signal) break;
        throw err;
      }
      records.push(record);
      onDwell(record);
    }
  } finally {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }
  const summary: SweepSummary = {
    swept: records.length,
    seconds: options.seconds,
    active: records
      .filter((r) => r.activeSeconds > 0)
      .map(({ channel, name, rxMhz, activeSeconds, out }) => ({ channel, name, rxMhz, activeSeconds, ...(out === undefined ? {} : { out }) })),
    warnings: records.flatMap((r) => r.warnings.map((w) => `channel ${r.channel}: ${w}`)),
  };
  return stop.signal ? { ...summary, interrupted: stop.signal } : summary;
}
