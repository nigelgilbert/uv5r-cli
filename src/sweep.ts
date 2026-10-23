import type { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { listen, play } from './audio.ts';
import { CHECK_SECONDS, judgeCheck, receiveOnly } from './check.ts';
import { formatMhz, type ChannelSpec } from './codec.ts';
import { withDetail } from './errors.ts';
import type { PlanEntry } from './plan.ts';
import { settle } from './protocol.ts';
import { KEY_SIGNALS, withSession, writeChannel } from './radio.ts';
import type { Transport } from './transport.ts';

/** Seconds `sweep` dwells on each entry when the caller gives no length. */
export const SWEEP_SECONDS = 30;
/** Memory slot `sweep` writes the check record and every plan entry into. */
export const SWEEP_SLOT = 0;

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

/** One finished dwell. */
export interface DwellRecord {
  /** Plan channel of the entry written into `slot`. */
  channel: number;
  slot: number;
  name: string;
  requestedMhz: string;
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
  slot: number;
  name: string;
  requestedMhz: string;
  activeSeconds: number;
  out?: string;
}

/** What slot 0 holds after the last verified write: the plan channel, or null for the check record, and the name read back. */
export interface Slot0 {
  channel: number | null;
  name: string;
}

export interface SweepSummary {
  /** Count of entries whose dwell finished. */
  swept: number;
  seconds: number;
  active: ActiveEntry[];
  /** Warnings from every dwell, each prefixed with its plan channel. */
  warnings: string[];
  /** Contents of slot 0 after the last verified write; null when a write failed or none ran. */
  slot0: Slot0 | null;
  /** Signal that ended the loop early. */
  interrupted?: NodeJS.Signals;
}

/** Step of a sweep: the check write and capture, an entry write, an entry dwell, or its playback. */
export type SweepPhase = 'check' | 'entry' | 'dwell' | 'play';

/** State the sweep steps update as they go; the caller reads it to summarize a sweep that threw. */
export interface SweepProgress {
  /** Dwells finished, in plan order. */
  dwells: DwellRecord[];
  /** Contents of slot 0 after the last verified write; null while a write runs and after a failed one. */
  slot0: Slot0 | null;
}

/** Signal state shared by the loop and the steps that wait on the radio. */
export interface Stop {
  /** Signal that arrived, once one has. */
  signal: NodeJS.Signals | undefined;
  /** Resolves when a signal arrives. */
  stopped: Promise<void>;
}

/** The radio steps of a sweep; each resolves early when `stop.stopped` resolves. */
export interface SweepSteps {
  /** Write the check record, wait for the reload and pass or throw on the capture. */
  check(progress: SweepProgress, stop: Stop): Promise<void>;
  /** Put the radio on `entry` before its dwell. */
  prepare(entry: PlanEntry, progress: SweepProgress, stop: Stop): Promise<void>;
}

/** Return an empty progress record. */
export function newProgress(): SweepProgress {
  return { dwells: [], slot0: null };
}

/** Name a capture from the plan channel and the local start time, as in ch07-2026-10-18T00-15-00.wav. */
export function captureName(channel: number, start: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}T${p(start.getHours())}-${p(start.getMinutes())}-${p(start.getSeconds())}`;
  return `ch${p(channel)}-${time}.wav`;
}

/**
 * Capture `options.seconds` on the channel the radio is on and report it as `entry`.
 * With `outDir` the capture goes to a WAV named by captureName.
 */
export async function dwell(entry: PlanEntry, options: DwellOptions): Promise<DwellRecord> {
  const out = options.outDir === undefined ? undefined : join(options.outDir, captureName(entry.channel, new Date()));
  const heard = await listen(options.device, options.seconds, options.floorDbfs, { out, play: false });
  return {
    channel: entry.channel,
    slot: SWEEP_SLOT,
    name: entry.spec.name ?? formatMhz(entry.spec.rxHz),
    requestedMhz: formatMhz(entry.spec.rxHz),
    activeSeconds: heard.activeSeconds,
    active: heard.active,
    meanRmsDbfs: heard.meanRmsDbfs,
    peakDbfs: heard.peakDbfs,
    warnings: heard.warnings,
    ...(out === undefined ? {} : { out }),
  };
}

/**
 * Play the capture of `record` through afplay when `options.play` is set and any second is
 * active. Skip it once a signal has arrived. A playback that a signal cuts short returns quietly.
 */
export async function playDwell(record: DwellRecord, options: DwellOptions, stop: Stop): Promise<void> {
  if (!options.play || record.out === undefined || record.activeSeconds === 0 || stop.signal) return;
  try {
    await play(record.out, options.seconds);
  } catch (err) {
    if (stop.signal === undefined) throw err;
  }
}

/**
 * Return the steps that work through slot 0 over transport `t`. The check writes
 * `checkSpec` as a receive-only record, waits for the reload, listens CHECK_SECONDS and
 * applies the `check` rule. Each entry write puts the entry with its own TX setting into
 * slot 0 in a fresh clone session and waits for the reload. Each write sets
 * `progress.slot0` to null first, then sets it to the record read back once the write
 * verifies.
 */
export function slotZero(t: Transport, checkSpec: ChannelSpec, options: { device: string; floorDbfs: number }): SweepSteps {
  const write = async (progress: SweepProgress, channel: number | null, spec: ChannelSpec) => {
    progress.slot0 = null;
    const written = await withSession(t, (s) => writeChannel(s, SWEEP_SLOT, spec));
    progress.slot0 = { channel, name: written.name };
  };
  return {
    async check(progress, stop) {
      const spec = receiveOnly(checkSpec);
      await write(progress, null, spec);
      await Promise.race([settle(), stop.stopped]);
      if (stop.signal) return;
      judgeCheck(SWEEP_SLOT, spec, await listen(options.device, CHECK_SECONDS, options.floorDbfs));
    },
    async prepare(entry, progress, stop) {
      await write(progress, entry.channel, entry.spec);
      await Promise.race([settle(), stop.stopped]);
    },
  };
}

/** Summarize the finished dwells and slot 0 in `progress`, naming `interrupted` when a signal ended the loop. */
export function summarize(progress: SweepProgress, seconds: number, interrupted?: NodeJS.Signals): SweepSummary {
  const records = progress.dwells;
  const summary: SweepSummary = {
    swept: records.length,
    seconds,
    active: records
      .filter((r) => r.activeSeconds > 0)
      .map(({ channel, slot, name, requestedMhz, activeSeconds, out }) => ({ channel, slot, name, requestedMhz, activeSeconds, ...(out === undefined ? {} : { out }) })),
    warnings: records.flatMap((r) => r.warnings.map((w) => `channel ${r.channel}: ${w}`)),
    slot0: progress.slot0,
  };
  return interrupted ? { ...summary, interrupted } : summary;
}

/**
 * Run the check, then prepare and dwell on each entry in order, play each capture after
 * its dwell, and summarize. A playback failure throws with
 * its dwell already in `progress`. A failed check throws before any entry is written. SIGINT,
 * SIGTERM or SIGHUP ends the run. The summary then covers the dwells finished before the
 * signal and names it in `interrupted`. A dwell whose capture the signal cut short is left
 * out. On a throw, `progress` holds the finished dwells and slot 0, and the error carries `phase`, `slot` and the plan `channel`, null during the check.
 */
export async function runSweep(
  entries: readonly PlanEntry[],
  steps: SweepSteps,
  options: DwellOptions,
  progress: SweepProgress = newProgress(),
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
  let phase: SweepPhase = 'check';
  let channel: number | null = null;
  try {
    await steps.check(progress, stop);
    for (const entry of entries) {
      if (stop.signal) break;
      phase = 'entry';
      channel = entry.channel;
      await steps.prepare(entry, progress, stop);
      if (stop.signal) break;
      phase = 'dwell';
      const record = await dwell(entry, options);
      progress.dwells.push(record);
      phase = 'play';
      await playDwell(record, options, stop);
    }
  } catch (err) {
    if (!stop.signal) throw withDetail(err, { phase, slot: SWEEP_SLOT, channel });
  } finally {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }
  return summarize(progress, options.seconds, stop.signal);
}
