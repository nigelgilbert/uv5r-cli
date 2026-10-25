import type { EventEmitter } from 'node:events';
import { renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_FLOOR_DBFS, listen, type ListenResult } from './audio.ts';
import { CHECK_SECONDS, judgeCheck, receiveOnly, refuseOpenSquelch } from './check.ts';
import {
  formatMhz,
  KEY_SIGNALS,
  settle,
  TransportError,
  UsageError,
  withDetail,
  withSession,
  writeChannel,
  type ChannelSpec,
  type Magic,
  type PlanEntry,
  type Session,
  type Transport,
} from '../core/index.ts';

/** Seconds `sweep` dwells on each entry when the caller gives no length. */
export const SWEEP_SECONDS = 30;
/** Memory slot `sweep` writes the check record and every plan entry into. */
export const SWEEP_SLOT = 0;

export interface DwellOptions {
  /** avfoundation audio input to capture from. */
  device: string;
  /** Whole seconds to capture per entry. */
  seconds: number;
  /** Directory that takes one WAV per dwell; undefined keeps no capture. */
  outDir?: string;
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
  /** avfoundation audio input the check and every dwell captured from. */
  device: string;
  active: ActiveEntry[];
  /** Warnings from the check, prefixed with check:, then from every dwell, prefixed with its plan channel. */
  warnings: string[];
  /** Contents of slot 0 after the last verified write; null when a write failed or none ran. */
  slot0: Slot0 | null;
  /** Signal that ended the loop early. */
  interrupted?: NodeJS.Signals;
}

/** Step of a sweep: the check write and capture, an entry write, or an entry dwell. */
export type SweepPhase = 'check' | 'entry' | 'dwell';

/** State the sweep steps update as they go; the caller reads it to summarize a sweep that threw. */
export interface SweepProgress {
  /** Dwells finished, in plan order. */
  dwells: DwellRecord[];
  /** Warnings from the check capture, stored before the check is judged. */
  checkWarnings: string[];
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
  return { dwells: [], checkWarnings: [], slot0: null };
}

/** Name a capture from the plan channel and the local start time, as in ch07-2026-10-18T00-15-00.wav. */
export function captureName(channel: number, start: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${start.getFullYear()}-${p(start.getMonth() + 1)}-${p(start.getDate())}T${p(start.getHours())}-${p(start.getMinutes())}-${p(start.getSeconds())}`;
  return `ch${p(channel)}-${time}.wav`;
}

/**
 * Capture `options.seconds` on the channel the radio is on, judge activity against DEFAULT_FLOOR_DBFS,
 * and report it as `entry`. With `outDir` ffmpeg writes the captureName plus .part, and the dwell renames
 * it to the captureName once the capture finishes. A failed capture removes the part file, so every WAV in
 * `outDir` holds a full dwell. A failed rename throws TransportError with reason file-write-failed naming the kept part file. When `stop` resolves, the capture kills ffmpeg and rejects once ffmpeg exits.
 */
export async function dwell(entry: PlanEntry, options: DwellOptions, stop?: Promise<unknown>): Promise<DwellRecord> {
  const out = options.outDir === undefined ? undefined : join(options.outDir, captureName(entry.channel, new Date()));
  const part = out === undefined ? undefined : `${out}.part`;
  let heard: ListenResult;
  try {
    heard = await listen(options.device, options.seconds, DEFAULT_FLOOR_DBFS, { out: part, stop });
  } catch (err) {
    // Remove the part file and keep the capture error when the removal fails.
    if (part !== undefined) {
      try {
        rmSync(part, { force: true });
      } catch {}
    }
    throw err;
  }
  if (part !== undefined && out !== undefined) {
    try {
      renameSync(part, out);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      throw new TransportError('file-write-failed', `cannot rename ${part} to ${out}: ${e.message}`, { out, part, code: e.code }, { remedy: 'pass --out-dir with a writable directory that has free space' });
    }
  }
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
 * Return the steps that work through slot 0 over transport `t`. The check refuses an open squelch,
 * writes `checkSpec` as a receive-only record in the same clone session, waits for the reload, listens
 * CHECK_SECONDS at DEFAULT_FLOOR_DBFS, stores the capture warnings in `progress.checkWarnings` and
 * applies the `check` rule. Each entry write puts the entry with its own TX setting into slot 0 in a
 * fresh clone session and waits for the reload. Each write sets `progress.slot0` to null first, then
 * sets it to the record read back once the write verifies. An error in the check carries `requestedMhz`.
 * Every session opens with `options.magic`, 291 when absent.
 */
export function slotZero(t: Transport, checkSpec: ChannelSpec, options: { device: string; magic?: Magic }): SweepSteps {
  const write = async (progress: SweepProgress, channel: number | null, spec: ChannelSpec, first?: (s: Session) => Promise<void>) => {
    progress.slot0 = null;
    const written = await withSession(t, async (s) => {
      await first?.(s);
      return writeChannel(s, SWEEP_SLOT, spec);
    }, { magic: options.magic });
    progress.slot0 = { channel, name: written.name };
  };
  return {
    async check(progress, stop) {
      const spec = receiveOnly(checkSpec);
      try {
        await write(progress, null, spec, (s) => refuseOpenSquelch(s, SWEEP_SLOT));
        await settle(stop.stopped);
        if (stop.signal) return;
        const heard = await listen(options.device, CHECK_SECONDS, DEFAULT_FLOOR_DBFS, { stop: stop.stopped });
        progress.checkWarnings = heard.warnings;
        judgeCheck(SWEEP_SLOT, spec, heard);
      } catch (err) {
        throw withDetail(err, { requestedMhz: formatMhz(checkSpec.rxHz) });
      }
    },
    async prepare(entry, progress, stop) {
      await write(progress, entry.channel, entry.spec);
      await settle(stop.stopped);
    },
  };
}

/** Summarize the check warnings, the finished dwells and slot 0 in `progress`, naming `interrupted` when a signal ended the loop. */
export function summarize(progress: SweepProgress, options: { seconds: number; device: string }, interrupted?: NodeJS.Signals): SweepSummary {
  const records = progress.dwells;
  const summary: SweepSummary = {
    swept: records.length,
    seconds: options.seconds,
    device: options.device,
    active: records
      .filter((r) => r.activeSeconds > 0)
      .map(({ channel, slot, name, requestedMhz, activeSeconds, out }) => ({ channel, slot, name, requestedMhz, activeSeconds, ...(out === undefined ? {} : { out }) })),
    warnings: [...progress.checkWarnings.map((w) => `check: ${w}`), ...records.flatMap((r) => r.warnings.map((w) => `channel ${r.channel}: ${w}`))],
    slot0: progress.slot0,
  };
  return interrupted ? { ...summary, interrupted } : summary;
}

/**
 * Run the check, then prepare and dwell on each entry in order, and summarize. A failed check throws
 * before any entry is written. SIGINT, SIGTERM or SIGHUP ends the run. The settle waits, the check
 * capture and each dwell race the signal, and a capture the signal reaches kills ffmpeg and waits for
 * it to exit. The summary then covers the dwells finished before the signal and names it in
 * `interrupted`. A dwell whose capture the signal cut short is left out. On a throw, `progress` holds
 * the check warnings, the finished dwells and slot 0, and the error carries `phase`, `slot`,
 * `requestedMhz` and the plan `channel`, null during the check. `requestedMhz` is the entry
 * frequency; the check step sets it to the check frequency.
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
  let requestedMhz: string | null = null;
  try {
    await steps.check(progress, stop);
    for (const entry of entries) {
      if (stop.signal) break;
      phase = 'entry';
      channel = entry.channel;
      requestedMhz = formatMhz(entry.spec.rxHz);
      await steps.prepare(entry, progress, stop);
      if (stop.signal) break;
      phase = 'dwell';
      const record = await dwell(entry, options, stop.stopped);
      progress.dwells.push(record);
    }
  } catch (err) {
    // Leave out a null requestedMhz so the check step's own value stays.
    if (!stop.signal) throw withDetail(err, { phase, slot: SWEEP_SLOT, channel, ...(requestedMhz === null ? {} : { requestedMhz }) });
  } finally {
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }
  return summarize(progress, options, stop.signal);
}
