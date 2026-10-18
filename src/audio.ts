import { execFile } from 'node:child_process';
import { TransportError, UsageError } from './errors.ts';

export interface ListenResult {
  device: string;
  seconds: number;
  /** RMS level of each captured second in dBFS; null marks a second of digital zero. */
  rmsDbfs: (number | null)[];
  /** Count of seconds that were digital zero, as a muted device or denied microphone access produces. */
  zeroSeconds: number;
  /** Power mean of the per-second RMS levels in dBFS; null when every second is digital zero. */
  meanRmsDbfs: number | null;
  /** Highest sample peak over the captured seconds in dBFS; null when every sample is zero. */
  peakDbfs: number | null;
  /** One entry per second, aligned with rmsDbfs; true when that second's RMS is above the floor. */
  active: boolean[];
  /** Count of true entries in `active`. */
  activeSeconds: number;
  /** Level problems found in the capture, such as clipping. */
  warnings: string[];
  /** Path of the WAV written with the capture; present when the caller passed `out`. */
  out?: string;
}

/** Options for `listen`. `play` needs `out`. */
export interface ListenOptions {
  /** Write the analysed seconds to this path as a 48 kHz mono 16-bit WAV. */
  out?: string;
  /** Run afplay on `out` after ffmpeg exits. */
  play?: boolean;
}

/**
 * Per-frame astats levels; samples holds each frame's sample count when ffmpeg reports it.
 * min, max and peakCount come from the astats before the high-pass, so they describe the
 * samples as the ADC delivered them. peakCount is the number of samples at min or max.
 */
export interface Levels {
  rms: number[];
  peak: number[];
  samples: number[];
  min: number[];
  max: number[];
  peakCount: number[];
}

/** Capture sample rate; asetnsamples cuts frames of this many samples, so each frame is one second. */
const RATE = 48000;

/** High-pass corner that removes the ADC bias so levels report audio only. */
const HIGHPASS_HZ = 50;

/** Fraction of the `-t` duration that ffmpeg 9.0.2 avfoundation returns as samples on macOS 26.7.1; the AIOC and the built-in microphone both stamped 48000-sample frames about 1.137 s apart on 2026-10-18. */
const RATIO = 0.88;

/** Extra seconds added to the padded request. */
const PAD_SECONDS = 2;

/** RMS level in dBFS above which a second counts as active. */
export const DEFAULT_FLOOR_DBFS = -50;

/** Sample magnitude, on the float scale where 1 is full scale, at or above which a sample counts as clipped; the AIOC rails read -1 and 0.999512 on 2026-10-18. */
const FULL_SCALE = 0.999;

/** Fraction of full-scale samples above which the result warns of clipping. */
const CLIP_FRACTION = 0.01;

export const CLIP_WARNING = 'input clips: turn the volume knob down';

/** Duration to pass to `-t` so that at least `seconds` whole frames come back. */
export function captureSeconds(seconds: number): number {
  return Math.ceil(seconds / RATIO) + PAD_SECONDS;
}

/**
 * ffmpeg arguments that capture at least `seconds` from `device`, remove DC, and print per-second astats on stderr.
 * The first astats runs before the high-pass, which smooths clipped flat tops in float audio, and reports the peak count.
 * The second astats reports the levels after the high-pass.
 * With `out`, a second output writes a WAV of the same seconds that the levels cover.
 */
export function ffmpegArgs(device: string, seconds: number, out?: string): string[] {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-f',
    'avfoundation',
    '-i',
    `:${device}`,
    '-t',
    String(captureSeconds(seconds)),
    '-af',
    [
      `aformat=sample_fmts=flt:sample_rates=${RATE}:channel_layouts=mono`,
      `asetnsamples=n=${RATE}:p=0`,
      'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Min_level+Max_level+Peak_count',
      `highpass=f=${HIGHPASS_HZ}`,
      'astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level+RMS_level+Number_of_samples',
      'ametadata=print',
    ].join(','),
    '-f',
    'null',
    '-',
  ];
  if (out === undefined) return args;
  return [...args, ...wavOutput(seconds, out)];
}

/**
 * ffmpeg output arguments that write captured seconds 2 to `seconds` + 1 as a 48 kHz mono 16-bit WAV.
 * asetpts restamps by sample count, since avfoundation stamps drift from the sample clock, so atrim cuts the same frames that summarize reads.
 */
function wavOutput(seconds: number, out: string): string[] {
  return [
    '-t',
    String(captureSeconds(seconds)),
    '-af',
    [
      `aformat=sample_fmts=s16:sample_rates=${RATE}:channel_layouts=mono`,
      'asetpts=N/SR/TB',
      `atrim=start_sample=${RATE}:end_sample=${RATE * (seconds + 1)}`,
    ].join(','),
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    '-y',
    out,
  ];
}

const round = (x: number) => Math.round(x * 100) / 100;

/** Round a dBFS level and map -Infinity (digital zero) to null. */
const dbfs = (x: number) => (x === -Infinity ? null : round(x));

/** Map each astats key to its Levels series. */
const SERIES = {
  RMS_level: 'rms',
  Peak_level: 'peak',
  Number_of_samples: 'samples',
  Min_level: 'min',
  Max_level: 'max',
  Peak_count: 'peakCount',
} as const satisfies Record<string, keyof Levels>;

/** Pull the per-second levels, sample counts and peak counts out of ffmpeg's stderr. */
export function parseAstats(stderr: string): Levels {
  const levels: Levels = { rms: [], peak: [], samples: [], min: [], max: [], peakCount: [] };
  for (const [, key, value] of stderr.matchAll(/lavfi\.astats\.Overall\.(RMS_level|Peak_level|Number_of_samples|Min_level|Max_level|Peak_count)=(\S+)/g)) {
    levels[SERIES[key as keyof typeof SERIES]].push(value === '-inf' ? -Infinity : Number(value));
  }
  return levels;
}

/** Count the full-scale samples in frame `i`: its peak count when its min or max sits at full scale, else zero. */
function fullScaleSamples(levels: Levels, i: number): number {
  const top = Math.max(Math.abs(levels.min[i] ?? 0), Math.abs(levels.max[i] ?? 0));
  return top >= FULL_SCALE ? (levels.peakCount[i] ?? 0) : 0;
}

/** Count leading frames that hold a full second; a frame without a sample count counts as full. */
export function wholeSeconds(levels: Levels): number {
  let n = 0;
  while (n < levels.rms.length && (levels.samples[n] ?? RATE) >= RATE) n++;
  return n;
}

/**
 * Summarize a capture; the caller checks that `seconds + 1` whole frames exist.
 * Every field covers frames 1 to seconds, which drops the capture-start burst in frame 0.
 * rmsDbfs[i] and active[i] describe the same second.
 */
export function summarize(device: string, seconds: number, levels: Levels, floorDbfs = DEFAULT_FLOOR_DBFS): ListenResult {
  // Skip frame 0 and the frames past the window that the padded request returns.
  const window = Array.from({ length: seconds }, (_, k) => k + 1);
  const rms = window.map((i) => levels.rms[i] ?? -Infinity);
  const peak = window.map((i) => levels.peak[i] ?? -Infinity);
  const power = rms.reduce((sum, db) => sum + 10 ** (db / 10), 0) / rms.length;
  const active = rms.map((db) => db > floorDbfs);
  const total = window.reduce((sum, i) => sum + (levels.samples[i] ?? RATE), 0);
  const clipped = window.reduce((sum, i) => sum + fullScaleSamples(levels, i), 0);
  return {
    device,
    seconds,
    rmsDbfs: rms.map(dbfs),
    zeroSeconds: rms.filter((db) => db === -Infinity).length,
    meanRmsDbfs: dbfs(10 * Math.log10(power)),
    peakDbfs: dbfs(Math.max(...peak)),
    active,
    activeSeconds: active.filter(Boolean).length,
    warnings: clipped > CLIP_FRACTION * total ? [CLIP_WARNING] : [],
  };
}

/** Join the last three non-empty stderr lines for an error message. */
function stderrTail(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' | ');
}

/**
 * Capture `seconds` of receive audio through ffmpeg and report levels, activity against `floorDbfs`, and warnings.
 * With `out`, ffmpeg also writes the capture to that WAV and the result carries `out`.
 * With `play`, afplay plays the WAV once ffmpeg exits; one ffmpeg process that captured and played hung on the bench.
 */
export async function listen(device: string, seconds: number, floorDbfs = DEFAULT_FLOOR_DBFS, options: ListenOptions = {}): Promise<ListenResult> {
  const { out, play: playIt = false } = options;
  if (playIt && out === undefined) throw new UsageError('play needs an out file; pass --out FILE with --play');
  const result = await capture(device, seconds, floorDbfs, out);
  if (out === undefined) return result;
  if (playIt) await play(out, seconds);
  return { ...result, out };
}

/** Run afplay on `file`, a WAV of about `seconds`, and resolve when playback ends. */
export function play(file: string, seconds: number): Promise<void> {
  const timeoutMs = (seconds + 15) * 1000;
  return new Promise((resolve, reject) => {
    execFile('afplay', [file], { timeout: timeoutMs }, (err, _stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null }) | null;
      if (!e) {
        resolve();
        return;
      }
      if (e.code === 'ENOENT') {
        reject(new TransportError(`afplay not found on PATH; cannot play ${file}`, { file }));
        return;
      }
      const tail = stderrTail(stderr);
      const how = e.killed && e.signal ? `timed out after ${timeoutMs / 1000}s` : e.signal ? `stopped on ${e.signal}` : `exited with code ${e.code}`;
      reject(new TransportError(`afplay ${how} playing ${file}${tail ? `: ${tail}` : ''}`, { file, code: e.code ?? null, signal: e.signal ?? null }));
    });
  });
}

/** Run ffmpeg once and summarize its astats output; with `out`, ffmpeg also writes the WAV. */
function capture(device: string, seconds: number, floorDbfs: number, out: string | undefined): Promise<ListenResult> {
  const timeoutMs = (captureSeconds(seconds) + 15) * 1000;
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ffmpegArgs(device, seconds, out), { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, _stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null }) | null;
      if (e?.code === 'ENOENT') {
        reject(new TransportError('ffmpeg not found on PATH; install it with brew install ffmpeg'));
        return;
      }
      const tail = stderrTail(stderr);
      const suffix = tail ? `: ${tail}` : '';
      if (e) {
        const how = e.killed && e.signal ? `timed out after ${timeoutMs / 1000}s` : e.signal ? `stopped on ${e.signal}` : `exited with code ${e.code}`;
        reject(new TransportError(`ffmpeg ${how} capturing from ${JSON.stringify(device)}${suffix}`, { device, code: e.code ?? null, signal: e.signal ?? null }));
        return;
      }
      const levels = parseAstats(stderr);
      // Frame 0 holds the capture-start burst, so one whole frame more than requested is needed.
      const captured = wholeSeconds(levels);
      const needed = seconds + 1;
      if (captured < needed) {
        reject(new TransportError(`ffmpeg captured ${captured} of ${needed} seconds from ${JSON.stringify(device)}${suffix}`, { device, captured, requested: needed }));
        return;
      }
      resolve(summarize(device, seconds, levels, floorDbfs));
    });
  });
}
