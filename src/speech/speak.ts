import type { EventEmitter } from 'node:events';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FLOOR_DBFS, play } from '../cli/audio.ts';
import { BaofengError, DeviceStateError, keyWhile, TransportError, UsageError, type HoldResult, type Transport } from '../core/index.ts';
import { measureWav, type WavLevels } from './levels.ts';
import { startMonitor, type Monitor } from './monitor.ts';
import { playTo, resolveOutput } from './output.ts';
import { idSentence } from './phonetic.ts';
import { FRAMES_PER_SECOND, frameLevels } from './segment.ts';
import { condition, synthesize } from './tts.ts';

/** Milliseconds keyWhile allows past the padded WAV and --tail for the player to start. */
export const PLAYER_START_MS = 5000;

/** Seconds past --clear S after which the clear check stops a capture that delivers too few frames. */
const CLEAR_SLACK_SECONDS = 10;

/** What a result or error tells the operator when audio went out without the full ID. */
export const ID_OWED_REMEDY = 'identify by voice or run uv5r id';

/** Device name the result reports for --rehearse. */
export const REHEARSE_DEVICE = 'system default output';

/**
 * The child processes and clocks the transmit and receive verbs use, injected so tests run
 * no say, ffmpeg or whisper-cli. `transcribe` is unused until `hear` lands.
 */
export interface SpeechDeps {
  /** Render text in a voice to a WAV with macOS `say`. */
  synthesize: (text: string, voice: string, wav: string) => Promise<void>;
  /** Filter and pad `input` into `output` with `leadMs` of leading silence. */
  condition: (input: string, output: string, leadMs: number) => Promise<void>;
  /** Measure a WAV's peak, RMS and length. */
  measureWav: (file: string) => Promise<WavLevels>;
  /** Return the audiotoolbox index of an output device name. */
  resolveOutput: (name: string) => Promise<number>;
  /** Play a WAV to an audiotoolbox index; reject once stopped. */
  playTo: (index: number, wav: string, stop: Promise<void>) => Promise<void>;
  /** Play a WAV of about `seconds` through the system default output, for --rehearse. */
  play: (wav: string, seconds: number) => Promise<void>;
  /** Start a continuous capture from an input device. */
  monitor: (device: string) => Monitor;
  /** Transcribe one WAV; `hear` wires it. */
  transcribe?: (wav: string) => Promise<unknown>;
  /** Milliseconds on a monotonic clock. */
  now: () => number;
  /** Source of the key signals. */
  signals: EventEmitter;
}

/** Return the real speech dependencies. */
export function defaultSpeechDeps(): SpeechDeps {
  return {
    synthesize,
    condition,
    measureWav,
    resolveOutput,
    playTo,
    play,
    monitor: (device) => startMonitor(device),
    now: () => performance.now(),
    signals: process,
  };
}

export interface SpeakOptions {
  /** Text to send; `id` passes the ID sentence. */
  text: string;
  callsign: string;
  /** Send the ID sentence alone, as `id` does. */
  idOnly?: boolean;
  voice: string;
  /** Output device name. */
  output: string;
  /** Input device name for the clear check. */
  input: string;
  leadMs: number;
  tailMs: number;
  maxSeconds: number;
  /** Seconds the clear check listens before keying; 0 skips it. */
  clearSeconds: number;
  /** Path that keeps a copy of the conditioned WAV. */
  out?: string;
  /** Play through the system default output with the port closed. */
  rehearse?: boolean;
}

export interface SpeakResult {
  text: string;
  spoken: string;
  /** True when the player exited 0 before any stop, so the ID at the end of the WAV went out. */
  identified: boolean;
  /** PTT hold rounded to 0.1 s; with --rehearse, the WAV length. */
  seconds: number;
  peakDbfs: number;
  rmsDbfs: number;
  device: string;
  pttAsserted: boolean;
  released: boolean;
  interrupted?: NodeJS.Signals;
  /** Set on a signal; true when the player started and the ID did not finish. */
  idOwed?: boolean;
  /** ID_OWED_REMEDY when idOwed is true. */
  remedy?: string;
  rehearsed?: true;
  out?: string;
}

/** Run `fn` with the serial port open and close it after. */
export type WithPort = <T>(fn: (t: Transport) => Promise<T>) => Promise<T>;

/** Append the ID sentence for `callsign` to `text`, adding a full stop when the text ends without one. */
export function withId(text: string, callsign: string): string {
  const body = text.trim();
  return `${body}${/[.!?]$/.test(body) ? '' : '.'} ${idSentence(callsign)}`;
}

const round = (x: number) => Math.round(x * 10) / 10;

/** Resolve after `ms`, or as soon as `stop` resolves. */
function wait(ms: number, stop: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void stop.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Wrap `t` so the caller can read whether a PTT release was confirmed. */
function trackRelease(t: Transport): { transport: Transport; released: () => boolean } {
  let released = false;
  const transport: Transport = {
    get target() {
      return t.target;
    },
    write: (bytes) => t.write(bytes),
    read: (n, ms) => t.read(n, ms),
    discard: () => t.discard(),
    setPtt: async (on) => {
      await t.setPtt(on);
      if (!on) released = true;
    },
    setBaud: (rate) => t.setBaud(rate),
    close: () => t.close(),
  };
  return { transport, released: () => released };
}

/**
 * Listen `seconds` on `device` through `monitor` and throw channel-busy when a 20 ms frame
 * reads above DEFAULT_FLOOR_DBFS. The capture stops at the first loud frame. A capture that
 * delivers too few frames within the seconds plus CLEAR_SLACK_SECONDS throws
 * capture-incomplete.
 */
export async function checkClear(monitor: Monitor, device: string, seconds: number): Promise<void> {
  const needed = Math.ceil(seconds * FRAMES_PER_SECOND);
  let loudest = -Infinity;
  let got = 0;
  const guard = setTimeout(() => void monitor.stop(), (seconds + CLEAR_SLACK_SECONDS) * 1000);
  try {
    await monitor.ready;
    for await (const frame of monitor.frames) {
      got++;
      loudest = Math.max(loudest, frameLevels(frame).rmsDbfs);
      if (loudest > DEFAULT_FLOOR_DBFS || got >= needed) break;
    }
  } finally {
    clearTimeout(guard);
    await monitor.stop();
  }
  if (loudest > DEFAULT_FLOOR_DBFS) {
    throw new DeviceStateError('channel-busy', `heard ${round(loudest)} dBFS on ${JSON.stringify(device)} during the ${seconds} s clear check, above ${DEFAULT_FLOOR_DBFS} dBFS`, {
      device,
      rmsDbfs: round(loudest),
    });
  }
  if (got < needed) throw new TransportError('capture-incomplete', `the clear check captured ${got} of ${needed} frames from ${JSON.stringify(device)}`, { device, captured: got, requested: needed });
}

/**
 * Speak one utterance over the radio: synthesize the text with the ID sentence at its end,
 * condition it, measure it, resolve the output device, run the clear check, then key PTT
 * through keyWhile while the player runs and for `tailMs` after. Every check runs before
 * `withPort` opens the port. `--rehearse` stops after the measurement and plays through the
 * system default output with the port closed.
 *
 * `identified` is true when the player exits 0 before keyWhile stops it. The ID ends the
 * WAV and only the trailing pad follows it, so a clean player exit means the ID went out.
 * A signal returns the result with `interrupted` and `idOwed`. A player failure while keyed
 * throws its audio-process-failed error with retry no, `pttAsserted`, `released`,
 * `playedSeconds` and `idOwed`. A player that runs past the watchdog throws the same reason.
 */
export async function speakUtterance(options: SpeakOptions, deps: SpeechDeps, withPort: WithPort): Promise<SpeakResult> {
  const spoken = options.idOnly ? idSentence(options.callsign) : withId(options.text, options.callsign);
  const scratch = mkdtempSync(join(tmpdir(), 'uv5r-say-'));
  try {
    const raw = join(scratch, 'speech.wav');
    const wav = join(scratch, 'tx.wav');
    await deps.synthesize(spoken, options.voice, raw);
    await deps.condition(raw, wav, options.leadMs);
    if (options.out !== undefined) {
      try {
        copyFileSync(wav, options.out);
      } catch (err) {
        throw new UsageError(`cannot write ${options.out}: ${(err as NodeJS.ErrnoException).message}`, { out: options.out }, { remedy: 'pass --out with a writable path' });
      }
    }
    const levels = await deps.measureWav(wav);
    if (levels.peakDbfs === -Infinity) {
      throw new TransportError('speech-engine-failed', `say wrote digital zero with voice ${JSON.stringify(options.voice)}`, { voice: options.voice });
    }
    const keyedSeconds = levels.seconds + options.tailMs / 1000;
    if (keyedSeconds > options.maxSeconds) {
      throw new UsageError(
        `the utterance runs ${round(keyedSeconds)} s with --tail, past --max-seconds ${options.maxSeconds}`,
        { seconds: round(keyedSeconds), maxSeconds: options.maxSeconds },
        {},
        'utterance-too-long',
      );
    }
    const measured = { peakDbfs: round(levels.peakDbfs), rmsDbfs: round(levels.rmsDbfs) };
    const kept = options.out === undefined ? {} : { out: options.out };
    if (options.rehearse) {
      try {
        await deps.play(wav, levels.seconds);
      } catch (err) {
        if (err instanceof BaofengError) err.attach({}, { remedy: 'check the system output, then rerun say --rehearse', retry: 'after-remedy' });
        throw err;
      }
      return { text: options.text, spoken, identified: false, seconds: round(levels.seconds), ...measured, device: REHEARSE_DEVICE, pttAsserted: false, released: true, rehearsed: true, ...kept };
    }
    const index = await deps.resolveOutput(options.output);
    if (options.clearSeconds > 0) await checkClear(deps.monitor(options.input), options.input, options.clearSeconds);
    const maxMs = Math.ceil(levels.seconds * 1000) + options.tailMs + PLAYER_START_MS;
    let started = false;
    let startedAt = 0;
    let playedMs = 0;
    let identified = false;
    let playFailed = false;
    const body = async (stop: Promise<void>) => {
      let stopped = false;
      void stop.then(() => (stopped = true));
      started = true;
      startedAt = deps.now();
      try {
        await deps.playTo(index, wav, stop);
      } catch (err) {
        playedMs = deps.now() - startedAt;
        if (!stopped) playFailed = true;
        throw err;
      }
      playedMs = deps.now() - startedAt;
      if (!stopped) identified = true;
      await wait(options.tailMs, stop);
    };
    let held: HoldResult;
    let released = () => false;
    try {
      held = await withPort((t) => {
        const tracked = trackRelease(t);
        released = tracked.released;
        return keyWhile(tracked.transport, body, { maxMs }, deps.signals);
      });
    } catch (err) {
      if (playFailed && err instanceof BaofengError) {
        err.attach({ pttAsserted: true, released: released(), playedSeconds: round(playedMs / 1000), idOwed: true }, released() ? { remedy: ID_OWED_REMEDY, retry: 'no' } : { retry: 'no' });
      }
      throw err;
    }
    if (held.timedOut) {
      throw new TransportError(
        'audio-process-failed',
        `the player ran past ${maxMs / 1000} s; PTT dropped at the watchdog`,
        { pttAsserted: true, released: true, playedSeconds: round(playedMs / 1000), seconds: held.seconds, idOwed: true },
        { remedy: ID_OWED_REMEDY, retry: 'no' },
      );
    }
    const result: SpeakResult = { text: options.text, spoken, identified, seconds: held.seconds, ...measured, device: options.output, pttAsserted: held.pttAsserted, released: held.released, ...kept };
    if (held.interrupted) {
      result.interrupted = held.interrupted;
      result.idOwed = started && !identified;
      if (result.idOwed) result.remedy = ID_OWED_REMEDY;
    }
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
