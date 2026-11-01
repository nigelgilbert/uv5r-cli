import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { KILL_GRACE_MS, ffmpegMissing, stderrTail } from '../cli/audio.ts';
import { TransportError } from '../core/index.ts';
import { FRAME_BYTES, FRAMES_PER_SECOND, SAMPLE_RATE } from './segment.ts';

/** Frames dropped once at capture start for the capture-start burst; one second. */
export const DROP_FRAMES = FRAMES_PER_SECOND;

/** Characters of ffmpeg stderr kept for the error message. */
const STDERR_KEEP = 8192;

/** Split arbitrary byte chunks into exact FRAME_BYTES frames, carrying the remainder to the next chunk. */
export class FrameAccumulator {
  private rest: Buffer = Buffer.alloc(0);

  /** Add a chunk and return the whole frames it completes. */
  push(chunk: Buffer): Buffer[] {
    const buf = this.rest.length === 0 ? chunk : Buffer.concat([this.rest, chunk]);
    const whole = buf.length - (buf.length % FRAME_BYTES);
    const frames: Buffer[] = [];
    for (let at = 0; at < whole; at += FRAME_BYTES) frames.push(buf.subarray(at, at + FRAME_BYTES));
    this.rest = Buffer.from(buf.subarray(whole));
    return frames;
  }

  /** Bytes held toward the next frame. */
  get pending(): number {
    return this.rest.length;
  }
}

/** ffmpeg arguments that capture `device` as 16 kHz s16le mono PCM on stdout. */
function monitorArgs(device: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-f',
    'avfoundation',
    '-i',
    `:${device}`,
    '-af',
    `aformat=sample_fmts=flt:channel_layouts=mono,highpass=f=50,aresample=${SAMPLE_RATE}`,
    '-f',
    's16le',
    '-ac',
    '1',
    '-ar',
    String(SAMPLE_RATE),
    'pipe:1',
  ];
}

/** The spawn signature startMonitor calls; node:child_process spawn matches it. */
export type Spawn = (command: string, args: string[], options: { stdio: ['ignore', 'pipe', 'pipe']; detached: boolean }) => ChildProcess;

export interface MonitorOptions {
  /** Spawn function; tests pass a fake child process. */
  spawn?: Spawn;
}

/** A running capture. */
export interface Monitor {
  /** 640-byte frames after the first-second drop; ends after stop and throws when ffmpeg exits first. */
  frames: AsyncIterable<Buffer>;
  /** Resolves once the first second is dropped or stop is called; rejects when ffmpeg exits first. */
  ready: Promise<void>;
  /** Send ffmpeg SIGTERM, then SIGKILL after KILL_GRACE_MS, and resolve once it exits. */
  stop(): Promise<void>;
}

/**
 * Start one long-running ffmpeg capture from `device` and frame its stdout.
 * ffmpeg runs in its own process group so a Ctrl-C or Ctrl-Z reaches uv5r alone, and stop
 * ends it. An ffmpeg exit before stop raises audio-process-failed through `ready` and `frames`.
 * frames has one consumer.
 */
export function startMonitor(device: string, { spawn = nodeSpawn }: MonitorOptions = {}): Monitor {
  const child = spawn('ffmpeg', monitorArgs(device), { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const accumulator = new FrameAccumulator();
  const queue: Buffer[] = [];
  let dropped = 0;
  let stderr = '';
  let stopping = false;
  let exited = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  let markReady!: () => void;
  let failReady!: (e: Error) => void;
  let markExited!: () => void;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    failReady = reject;
  });
  // Attach a handler so a caller that awaits only frames leaves no unhandled rejection.
  ready.catch(() => {});
  const exit = new Promise<void>((resolve) => (markExited = resolve));

  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const fail = (e: Error) => {
    if (stopping || failure) return;
    failure = e;
    failReady(e);
    notify();
  };
  const finish = () => {
    if (exited) return;
    exited = true;
    markExited();
    notify();
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    if (stopping || failure) return;
    for (const frame of accumulator.push(chunk)) {
      if (dropped < DROP_FRAMES) {
        dropped++;
        if (dropped === DROP_FRAMES) markReady();
        continue;
      }
      queue.push(frame);
    }
    notify();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP);
  });
  child.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') fail(ffmpegMissing());
    else fail(new TransportError('audio-process-failed', `ffmpeg failed capturing from ${JSON.stringify(device)}: ${e.message}`, { input: device, code: e.code ?? null, signal: null }));
    // A child that never spawned emits no close.
    if (child.pid === undefined) finish();
  });
  child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
    const tail = stderrTail(stderr);
    const how = signal ? `stopped on ${signal}` : `exited with code ${code}`;
    fail(new TransportError('audio-process-failed', `ffmpeg ${how} capturing from ${JSON.stringify(device)}${tail ? `: ${tail}` : ''}`, { input: device, code, signal }));
    finish();
  });

  async function* frames(): AsyncGenerator<Buffer> {
    while (true) {
      const frame = queue.shift();
      if (frame) {
        yield frame;
        continue;
      }
      if (failure) throw failure;
      if (stopping || exited) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  }

  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopped ??= (async () => {
      stopping = true;
      markReady();
      notify();
      if (exited) return;
      child.kill('SIGTERM');
      // Escalate in case ffmpeg ignores SIGTERM.
      const escalate = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
      await exit;
      clearTimeout(escalate);
    })();
    return stopped;
  };

  return { frames: frames(), ready, stop };
}
