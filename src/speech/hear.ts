import type { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEY_SIGNALS, TransportError } from '../core/index.ts';
import type { Monitor } from './monitor.ts';
import { FRAME_MS, FRAMES_PER_SECOND, MAX_FRAMES, Segmenter, type Segment } from './segment.ts';
import { ENGINE, type Transcribe } from './stt.ts';
import { writeWav } from './wav.ts';

/** Segments that wait for whisper-cli behind the one in inference; past it the oldest is dropped. */
export const QUEUE_LIMIT = 8;

/** Normalized transcripts that print as noise warnings; whisper produces them on non-speech. */
export const NOISE_PHRASES: readonly string[] = ['thank you', 'you', 'bye'];

/** Seconds added to --timeout and the longest segment before hear --once stops capture, even while frames arrive. */
const STALL_SLACK_SECONDS = 10;

const MAX_SEGMENT_SECONDS = MAX_FRAMES / FRAMES_PER_SECOND;

export interface HearOptions {
  /** Input device name the summary reports. */
  device: string;
  floorDbfs: number;
  hangSeconds: number;
  /** Return after the first transmission or the timeout. */
  once: boolean;
  /** Seconds from capture ready after which no new segment opens; used with once. */
  timeoutSeconds: number;
  /** Directory that keeps one WAV per segment; segment WAVs go to a scratch dir and are deleted without it. */
  outDir?: string;
  /** Model name a transmission line reports. */
  model: string;
  /** Sequence number of the first segment. */
  firstSeq?: number;
}

export type WarningKind = 'kerchunk' | 'noise' | 'backlog';

export interface TransmissionLine {
  type: 'transmission';
  seq: number;
  /** ISO time of the segment's first sample. */
  start: string;
  seconds: number;
  rmsDbfs: number;
  peakDbfs: number;
  text: string;
  engine: string;
  model: string;
  inferMs: number;
  /** Kept path with outDir, else null. */
  wav: string | null;
}

export interface WarningLine {
  type: 'warning';
  warning: WarningKind;
  start: string;
  seconds: number;
  /** The transcript for noise, else null. */
  text: string | null;
  wav: string | null;
}

export interface SummaryLine {
  type: 'summary';
  transmissions: number;
  /** Seconds from capture ready to the end, rounded to 0.1. */
  seconds: number;
  device: string;
  /** Count of warning lines. */
  warnings: number;
  interrupted?: NodeJS.Signals;
  /** Set with once; true when no transmission printed before the end. */
  timedOut?: boolean;
}

export type HearLine = TransmissionLine | WarningLine | SummaryLine;

/** A closed segment with its sequence number and start time. */
interface Pending {
  seq: number;
  segment: Segment;
  start: string;
}

/** Lowercase `text`, strip punctuation and collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return whether a transcript is empty or matches NOISE_PHRASES once normalized. */
export function isNoise(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized === '' || NOISE_PHRASES.includes(normalized);
}

/** File name of segment `seq`, as in seg-000042.wav. */
export function segmentFileName(seq: number): string {
  return `seg-${String(seq).padStart(6, '0')}.wav`;
}

/** Return one past the highest seg-NNNNNN.wav in `dir`, or 1 when it holds none. */
export function nextSeq(dir: string): number {
  let high = 0;
  for (const name of readdirSync(dir)) {
    const m = /^seg-(\d{6,})\.wav$/.exec(name);
    if (m) high = Math.max(high, Number(m[1]));
  }
  return high + 1;
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;

/** Write a segment WAV and raise file-write-failed when the write fails. */
function saveWav(path: string, pcm: Buffer): void {
  try {
    writeWav(path, pcm);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new TransportError('file-write-failed', `cannot write ${path}: ${e.message}`, { wav: path, code: e.code ?? null });
  }
}

/**
 * Segment the capture from `monitor` and transcribe each segment through `transcribe`, one
 * at a time, while capture continues. Print each line through `onLine` and end with the
 * summary line, which the call also returns. `now` returns epoch milliseconds; segment start
 * times and the --once deadline come from it.
 *
 * Closed segments wait in a FIFO queue of QUEUE_LIMIT; past it the oldest waiting segment
 * prints a backlog warning. A kerchunk prints a warning and skips whisper-cli. A transcript
 * that isNoise flags prints a noise warning. With once, the first transmission line stops
 * capture and discards later segments. The deadline starts when capture is ready; past it no
 * new segment opens, an open one runs to close or until MAX_SEGMENT_SECONDS plus
 * STALL_SLACK_SECONDS past the deadline, and the queue drains. Capture that is idle at the
 * deadline stops then, whether or not frames arrive.
 *
 * One of KEY_SIGNALS on `signals` stops capture and closes the open segment. Each waiting
 * segment, the closed one included, prints a backlog warning and keeps its WAV with outDir.
 * The segment in inference finishes and prints, then the summary prints with interrupted.
 * A capture or transcription failure stops capture, waits for the segment in inference and
 * throws; lines already printed stay printed. A transcription failure after a signal throws too.
 */
export async function runHear(monitor: Monitor, transcribe: Transcribe, now: () => number, onLine: (line: HearLine) => void, signals: EventEmitter, opts: HearOptions): Promise<SummaryLine> {
  const scratch = mkdtempSync(join(tmpdir(), 'uv5r-hear-'));
  const segmenter = new Segmenter({ floorDbfs: opts.floorDbfs, hangSeconds: opts.hangSeconds });
  const queue: Pending[] = [];
  let seq = opts.firstSeq ?? 1;
  let transmissions = 0;
  let warnings = 0;
  let interrupted: NodeJS.Signals | undefined;
  let heard = false;
  let stopping = false;
  let failure: unknown;
  let busy: Promise<void> | undefined;
  let guard: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;
  // Map segment frames to wall time from the frame that opened the segment.
  let anchor = { frame: 0, wall: 0 };
  let deadlineStop = false;

  const halt = () => {
    stopping = true;
    queue.length = 0;
    void monitor.stop();
  };
  const handlers = KEY_SIGNALS.map((signal) => {
    const handler = () => {
      if (interrupted) return;
      interrupted = signal;
      stopping = true;
      void monitor.stop();
      try {
        const last = segmenter.close();
        if (last) handle(last, anchor);
        for (const p of queue.splice(0)) warn('backlog', p, null, keep(p));
      } catch (err) {
        failure ??= err;
      }
    };
    signals.on(signal, handler);
    return [signal, handler] as const;
  });

  const keptPath = (p: Pending) => (opts.outDir === undefined ? null : join(opts.outDir, segmentFileName(p.seq)));
  const warn = (warning: WarningKind, p: Pending, text: string | null, wav: string | null) => {
    warnings++;
    onLine({ type: 'warning', warning, start: p.start, seconds: round(p.segment.seconds, 2), text, wav });
  };
  /** Write the WAV of a segment that skips whisper-cli when outDir keeps it, and return the kept path. */
  const keep = (p: Pending) => {
    const path = keptPath(p);
    if (path !== null) saveWav(path, p.segment.pcm);
    return path;
  };

  const transcribeOne = async (p: Pending) => {
    const kept = keptPath(p);
    const wav = kept ?? join(scratch, segmentFileName(p.seq));
    saveWav(wav, p.segment.pcm);
    let result;
    try {
      result = await transcribe(wav);
    } finally {
      if (kept === null) rmSync(wav, { force: true });
    }
    if (isNoise(result.text)) {
      warn('noise', p, result.text, kept);
      return;
    }
    transmissions++;
    const { segment } = p;
    onLine({
      type: 'transmission',
      seq: p.seq,
      start: p.start,
      seconds: round(segment.seconds, 2),
      rmsDbfs: round(segment.rmsDbfs, 1),
      peakDbfs: round(segment.peakDbfs, 1),
      text: result.text,
      engine: ENGINE,
      model: opts.model,
      inferMs: result.inferMs,
      wav: kept,
    });
    if (opts.once) {
      heard = true;
      halt();
    }
  };

  const kick = () => {
    if (busy || failure || stopping) return;
    const next = queue.shift();
    if (!next) return;
    busy = transcribeOne(next)
      .catch((err: unknown) => {
        failure ??= err;
        halt();
      })
      .finally(() => {
        busy = undefined;
        kick();
      });
  };

  const handle = (segment: Segment, anchor: { frame: number; wall: number }) => {
    const start = new Date(anchor.wall + (segment.startFrame - anchor.frame) * FRAME_MS).toISOString();
    const p: Pending = { seq: seq++, segment, start };
    if (segment.kerchunk) {
      warn('kerchunk', p, null, keep(p));
      return;
    }
    queue.push(p);
    if (queue.length > QUEUE_LIMIT) {
      const oldest = queue.shift()!;
      warn('backlog', oldest, null, keep(oldest));
    }
    kick();
  };

  let readyAt = now();
  try {
    try {
      await monitor.ready;
      readyAt = now();
      const deadline = opts.once ? readyAt + opts.timeoutSeconds * 1000 : Infinity;
      if (opts.once) {
        // Stop capture at the deadline when no segment is open, so a stalled capture ends on time.
        deadlineTimer = setTimeout(() => {
          if (segmenter.isOpen()) return;
          deadlineStop = true;
          void monitor.stop();
        }, opts.timeoutSeconds * 1000);
        guard = setTimeout(() => void monitor.stop(), (opts.timeoutSeconds + MAX_SEGMENT_SECONDS + STALL_SLACK_SECONDS) * 1000);
      }
      let index = 0;
      anchor = { frame: 0, wall: readyAt };
      for await (const frame of monitor.frames) {
        if (stopping) break;
        const expired = now() >= deadline;
        if (expired && !segmenter.isOpen()) {
          deadlineStop = true;
          break;
        }
        const wasOpen = segmenter.isOpen();
        const closed = segmenter.push(frame);
        if (!wasOpen && segmenter.isOpen()) anchor = { frame: index, wall: now() };
        index++;
        if (closed) handle(closed, anchor);
        // Run the remainder of a split to close before stopping at the deadline.
        if (expired && !segmenter.isOpen()) {
          deadlineStop = true;
          break;
        }
      }
      // Transcribe a segment still open when the stall guard stopped capture.
      if (!stopping && !deadlineStop) {
        const last = segmenter.close();
        if (last) handle(last, anchor);
      }
    } catch (err) {
      if (!interrupted) failure ??= err;
    }
    await monitor.stop();
    while (busy) await busy;
  } finally {
    clearTimeout(guard);
    clearTimeout(deadlineTimer);
    for (const [signal, handler] of handlers) signals.off(signal, handler);
    await monitor.stop();
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failure) throw failure;
  const summary: SummaryLine = { type: 'summary', transmissions, seconds: round((now() - readyAt) / 1000, 1), device: opts.device, warnings };
  if (interrupted) summary.interrupted = interrupted;
  if (opts.once) summary.timedOut = !heard && !interrupted;
  onLine(summary);
  return summary;
}
