import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { TransportError } from '../../src/core/index.ts';
import type { WavLevels } from '../../src/speech/levels.ts';
import type { Monitor } from '../../src/speech/monitor.ts';
import { FRAME_BYTES, FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE } from '../../src/speech/segment.ts';
import type { SpeechDeps } from '../../src/speech/speak.ts';
import type { Transcript, WhisperOptions } from '../../src/speech/stt.ts';
import { TRAILING_PAD_SECONDS } from '../../src/speech/tts.ts';

/** Sample rate of the WAVs the fakes write. */
const RATE = 48000;
/** Frequency of the test tone. */
const TONE_HZ = 1000;
/** Bytes of the canonical WAV header wavBytes writes. */
const HEADER = 44;
const FULL_SCALE = 32768;

/** Return `n` samples of 1 kHz sine at `rate` with its peak at `dbfs` as s16le PCM; -Infinity gives digital zero. */
function sine(n: number, rate: number, dbfs: number): Buffer {
  const amp = dbfs === -Infinity ? 0 : 32767 * 10 ** (dbfs / 20);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * TONE_HZ * i) / rate)), i * 2);
  return pcm;
}

/** Wrap s16le mono PCM at 48 kHz in a 44-byte WAV header. */
function wrap(pcm: Buffer): Buffer {
  const header = Buffer.alloc(HEADER);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** A 48 kHz mono 16-bit WAV of `seconds` of 1 kHz sine with its peak at `dbfs`; -Infinity gives digital zero. */
export function wavBytes(seconds: number, dbfs: number): Buffer {
  return wrap(sine(Math.round(seconds * RATE), RATE, dbfs));
}

/** One 20 ms 16 kHz monitor frame of 1 kHz sine with its peak at `dbfs`. */
export function pcmFrame(dbfs: number): Buffer {
  return sine(FRAME_SAMPLES, SAMPLE_RATE, dbfs);
}

/** A clock whose time moves only when the test or a fake advances it. */
export function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/** A synthesize stand-in that writes wavBytes(seconds, dbfs) and records each call. */
export function fakeSynthesize({ seconds = 2, dbfs = -3 }: { seconds?: number; dbfs?: number } = {}) {
  const calls: { text: string; voice: string; wav: string }[] = [];
  const fn = async (text: string, voice: string, wav: string) => {
    calls.push({ text, voice, wav });
    writeFileSync(wav, wavBytes(seconds, dbfs));
  };
  return Object.assign(fn, { calls });
}

/** A condition stand-in that adds `leadMs` of leading and TRAILING_PAD_SECONDS of trailing silence. */
export function fakeCondition() {
  const calls: { input: string; output: string; leadMs: number }[] = [];
  const fn = async (input: string, output: string, leadMs: number) => {
    calls.push({ input, output, leadMs });
    const pcm = readFileSync(input).subarray(HEADER);
    const silence = (s: number) => Buffer.alloc(Math.round(s * RATE) * 2);
    writeFileSync(output, wrap(Buffer.concat([silence(leadMs / 1000), pcm, silence(TRAILING_PAD_SECONDS)])));
  };
  return Object.assign(fn, { calls });
}

/** Measure a WAV that wavBytes or fakeCondition wrote. */
export async function fakeMeasureWav(file: string): Promise<WavLevels> {
  const pcm = readFileSync(file).subarray(HEADER);
  const n = pcm.length / 2;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
    peak = Math.max(peak, Math.abs(s));
  }
  return { seconds: n / RATE, peakDbfs: 20 * Math.log10(peak / FULL_SCALE), rmsDbfs: 20 * Math.log10(Math.sqrt(sum / n) / FULL_SCALE) };
}

/** A resolveOutput stand-in over a name-to-index table; an absent name throws audio-device-unavailable. */
export function fakeResolveOutput(devices: Record<string, number> = { 'AIOC Audio': 3 }) {
  const calls: string[] = [];
  const fn = async (name: string) => {
    calls.push(name);
    const index = devices[name];
    if (index === undefined) throw new TransportError('audio-device-unavailable', `no audiotoolbox output named ${JSON.stringify(name)}`, { output: name });
    return index;
  };
  return Object.assign(fn, { calls });
}

export interface FakePlayOptions {
  /** Real milliseconds the play takes; the clock advances by the same amount. */
  ms?: number;
  /** Reject with this error after `ms`. */
  fail?: Error;
  /** Called as the play starts. */
  onStart?: () => void;
  clock?: { advance: (ms: number) => void };
}

/** A playTo stand-in that plays for `ms`, rejects with audio-process-failed once stopped, and records each call. */
export function fakePlayTo({ ms = 20, fail, onStart, clock }: FakePlayOptions = {}) {
  const calls: { index: number; wav: string }[] = [];
  const fn = (index: number, wav: string, stop: Promise<void>) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ index, wav });
      onStart?.();
      const started = Date.now();
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        clock?.advance(ms);
        if (fail) reject(fail);
        else resolve();
      }, ms);
      void stop.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clock?.advance(Date.now() - started);
        reject(new TransportError('audio-process-failed', 'ffmpeg stopped when PTT dropped', { output: index }));
      });
    });
  return Object.assign(fn, { calls });
}

/** A Monitor that yields `frames` once ready and then waits for stop; with `end`, frames ends after the last one. */
export function fakeMonitor(frames: Buffer[], { end = false }: { end?: boolean } = {}) {
  let stopped = 0;
  let wake = () => {};
  async function* iterate(): AsyncGenerator<Buffer> {
    for (const frame of frames) {
      if (stopped) return;
      yield frame;
    }
    if (end) return;
    while (!stopped) await new Promise<void>((resolve) => (wake = resolve));
  }
  const monitor: Monitor = {
    frames: iterate(),
    ready: Promise.resolve(),
    stop: async () => {
      stopped++;
      wake();
    },
  };
  return Object.assign(monitor, { stops: () => stopped });
}

/** `n` monitor frames of digital zero. */
export function silentFrames(n: number): Buffer[] {
  return Array.from({ length: n }, () => Buffer.alloc(FRAME_BYTES));
}

/** `n` monitor frames of 1 kHz sine with its peak at `dbfs`. */
export function toneFrames(n: number, dbfs = -10): Buffer[] {
  const frame = pcmFrame(dbfs);
  return Array.from({ length: n }, () => frame);
}

/**
 * A Monitor that yields the frames the test feeds it, on demand. With a clock, each frame
 * advances it by FRAME_MS as it is yielded. feed resolves once the consumer has taken every
 * fed frame and waits for more, or once the monitor stops.
 */
export class FakeMonitor implements Monitor {
  readonly frames: AsyncIterable<Buffer>;
  ready: Promise<void> = Promise.resolve();
  stops = 0;
  private queue: Buffer[] = [];
  private failure: Error | undefined;
  private stopped = false;
  private wake = () => {};
  private idle: (() => void)[] = [];

  private readonly clock: { advance: (ms: number) => void } | undefined;

  constructor(clock?: { advance: (ms: number) => void }) {
    this.clock = clock;
    this.frames = this.iterate();
  }

  /** Queue frames for the consumer. */
  feed(...frames: Buffer[][]): Promise<void> {
    this.queue.push(...frames.flat());
    const drained = new Promise<void>((resolve) => this.idle.push(resolve));
    this.wake();
    return drained;
  }

  /** Make frames throw `err` once the queued frames are taken. */
  fail(err: Error): void {
    this.failure = err;
    this.wake();
  }

  async stop(): Promise<void> {
    this.stops++;
    this.stopped = true;
    this.settle();
    this.wake();
  }

  private settle(): void {
    for (const resolve of this.idle.splice(0)) resolve();
  }

  private async *iterate(): AsyncGenerator<Buffer> {
    while (!this.stopped) {
      const frame = this.queue.shift();
      if (frame) {
        this.clock?.advance(FRAME_MS);
        yield frame;
        continue;
      }
      if (this.failure) throw this.failure;
      this.settle();
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }
}

/**
 * A transcribe stand-in that replies with `replies[i]` on call i, or the last reply past the
 * end, and records each WAV path with whether the file existed at the call. With manual, each
 * call waits until the test settles it through `pending`.
 */
export function fakeTranscribe(replies: string[] = ['bench this is kilo juliett seven status over'], { manual = false }: { manual?: boolean } = {}) {
  const calls: { wav: string; existed: boolean }[] = [];
  const pending: { resolve: () => void; reject: (err: Error) => void }[] = [];
  const fn = (wav: string): Promise<Transcript> => {
    calls.push({ wav, existed: existsSync(wav) });
    const text = replies[Math.min(calls.length - 1, replies.length - 1)] ?? '';
    const result = { text, inferMs: 640 };
    if (!manual) return Promise.resolve(result);
    return new Promise((resolve, reject) => pending.push({ resolve: () => resolve(result), reject }));
  };
  return Object.assign(fn, { calls, pending });
}

/** A transcriber stand-in that records the options and returns `transcribe`. */
export function fakeTranscriber(transcribe: (wav: string) => Promise<Transcript> = fakeTranscribe()) {
  const calls: WhisperOptions[] = [];
  const fn = (options: WhisperOptions) => {
    calls.push(options);
    return transcribe;
  };
  return Object.assign(fn, { calls });
}

/**
 * A child process stand-in for spawn. `exit` writes `stderr` and emits close with the code
 * and signal; `fail` emits a spawn error with no pid. kill records each signal in `kills`.
 */
export function fakeChild() {
  const kills: NodeJS.Signals[] = [];
  const child = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    pid: 4242 as number | undefined,
    kills,
    kill: (signal: NodeJS.Signals = 'SIGTERM') => kills.push(signal) > 0,
    exit: (code: number | null, { signal = null, stderr = '' }: { signal?: NodeJS.Signals | null; stderr?: string } = {}) => {
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', code, signal);
    },
    fail: (err: NodeJS.ErrnoException) => {
      child.pid = undefined;
      child.emit('error', err);
    },
  });
  return child;
}

/** A spawn stand-in body that returns a fakeChild and settles it on the next tick with `settle`. */
export function spawnThen(settle: (child: ReturnType<typeof fakeChild>) => void) {
  return () => {
    const child = fakeChild();
    setImmediate(() => settle(child));
    return child;
  };
}

/** SpeechDeps built from the fakes, with `overrides` in place; signals is a fresh EventEmitter. */
export function fakeSpeechDeps(overrides: Partial<SpeechDeps> = {}): SpeechDeps & { signals: EventEmitter } {
  const clock = fakeClock();
  return {
    synthesize: fakeSynthesize(),
    condition: fakeCondition(),
    measureWav: fakeMeasureWav,
    resolveOutput: fakeResolveOutput(),
    playTo: fakePlayTo({ clock }),
    play: async () => {},
    monitor: () => fakeMonitor([]),
    transcriber: fakeTranscriber(),
    now: clock.now,
    signals: new EventEmitter(),
    ...overrides,
  } as SpeechDeps & { signals: EventEmitter };
}
