import type { EventEmitter } from 'node:events';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FLOOR_DBFS, play } from '../cli/audio.ts';
import { BaofengError, DeviceStateError, KEY_SIGNALS, keyWhile, TransportError, UsageError, wait, type HoldResult, type Transport } from '../core/index.ts';
import { measureWav, type WavLevels } from './levels.ts';
import { startMonitor, type Monitor } from './monitor.ts';
import { playTo, resolveOutput } from './output.ts';
import { idSentence } from './phonetic.ts';
import { FRAMES_PER_SECOND, frameLevels } from './segment.ts';
import { whisperTranscriber, type Transcribe, type WhisperOptions } from './stt.ts';
import { condition, synthesize } from './tts.ts';

/** Milliseconds keyWhile allows past the padded WAV and tailMs for the player to start. */
const PLAYER_START_MS = 5000;

/** Seconds past --clear S after which the clear check stops a capture that delivers too few frames. */
const CLEAR_SLACK_SECONDS = 10;

/** What a result or error tells the operator when audio went out without the full ID. */
export const ID_OWED_REMEDY = 'identify by voice or run uv5r id';

/** Device name the result reports for --rehearse. */
const REHEARSE_DEVICE = 'system default output';

/**
 * The child processes and clocks the transmit and receive verbs use, injected so tests run
 * no say, ffmpeg or whisper-cli.
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
  /** Check the whisper-cli program and model files and return a Transcribe bound to `options`. */
  transcriber: (options: WhisperOptions) => Transcribe;
  /** Milliseconds on a monotonic clock. */
  now: () => number;
  /** Source of the key signals. */
  signals: EventEmitter;
  /** Station config path say and id read when neither --config nor UV5R_CONFIG names one; unset means uv5r.json at the repo root. */
  defaultConfig?: string;
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
    transcriber: whisperTranscriber,
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

/** The station config values a result reports. */
type Pacing = Pick<SpeakOptions, 'voice' | 'leadMs' | 'tailMs' | 'maxSeconds'>;

export interface SpeakResult extends Pacing {
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
  /** Set on a signal; true when the player ran past leadMs and the ID did not finish. */
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

/** Wrap `t` so the caller can read whether a PTT release started and whether it was confirmed. */
function trackRelease(t: Transport): { transport: Transport; dropping: () => boolean; released: () => boolean } {
  let dropping = false;
  let released = false;
  const transport: Transport = {
    get target() {
      return t.target;
    },
    write: (bytes) => t.write(bytes),
    read: (n, ms) => t.read(n, ms),
    discard: () => t.discard(),
    setPtt: async (on) => {
      if (!on) dropping = true;
      await t.setPtt(on);
      if (!on) released = true;
    },
    setBaud: (rate) => t.setBaud(rate),
    close: () => t.close(),
  };
  return { transport, dropping: () => dropping, released: () => released };
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
      input: device,
      rmsDbfs: round(loudest),
    });
  }
  if (got < needed) throw new TransportError('capture-incomplete', `the clear check captured ${got} of ${needed} frames from ${JSON.stringify(device)}`, { input: device, captured: got, requested: needed });
}

/**
 * Speak one utterance over the radio: synthesize the text with the ID sentence at its end,
 * condition it, measure it, resolve the output device, run the clear check, then key PTT
 * through keyWhile while the player runs and for `tailMs` after. Every check runs before
 * `withPort` opens the port. `--rehearse` stops after the measurement and plays through the
 * system default output with the port closed.
 *
 * Without --rehearse, the key signal handlers cover the whole run. A signal before PTT rises
 * skips the WAV checks and the --out copy, stops the clear check, skips keying and returns
 * the result with `interrupted`, `pttAsserted` false and `idOwed` false.
 *
 * `identified` is true when the player exits 0 before a signal and before keyWhile drops PTT.
 * The ID ends the WAV and only the trailing pad follows it, so a clean player exit means the
 * ID went out.
 * `idOwed` is true when the player ran longer than `leadMs` and the ID did not finish. The
 * played time includes player start-up, so the rule is approximate. A signal while keyed
 * returns the result with `interrupted` and `idOwed`. A failure after the player starts, such
 * as a player's audio-process-failed or a release's ptt-control-failed, gains retry no,
 * `pttAsserted`, `released`, `playedSeconds` and `idOwed`. A player that runs past the
 * watchdog throws audio-process-failed unless a signal also arrived, which returns the
 * interrupted result.
 */
export async function speakUtterance(options: SpeakOptions, deps: SpeechDeps, withPort: WithPort): Promise<SpeakResult> {
  const spoken = options.idOnly ? idSentence(options.callsign) : withId(options.text, options.callsign);
  const scratch = mkdtempSync(join(tmpdir(), 'uv5r-say-'));
  let signalled: NodeJS.Signals | undefined;
  let onSignal = () => {};
  const handlers = options.rehearse
    ? []
    : KEY_SIGNALS.map((signal) => {
        const handler = () => {
          signalled ??= signal;
          onSignal();
        };
        deps.signals.on(signal, handler);
        return [signal, handler] as const;
      });
  try {
    const raw = join(scratch, 'speech.wav');
    const wav = join(scratch, 'tx.wav');
    await deps.synthesize(spoken, options.voice, raw);
    await deps.condition(raw, wav, options.leadMs);
    const levels = await deps.measureWav(wav);
    const measured = { peakDbfs: round(levels.peakDbfs), rmsDbfs: round(levels.rmsDbfs) };
    const pacing: Pacing = { voice: options.voice, leadMs: options.leadMs, tailMs: options.tailMs, maxSeconds: options.maxSeconds };
    let kept: { out?: string } = {};
    const unkeyed = (signal: NodeJS.Signals): SpeakResult => ({
      text: options.text,
      spoken,
      identified: false,
      seconds: 0,
      ...measured,
      device: options.output,
      ...pacing,
      pttAsserted: false,
      released: true,
      interrupted: signal,
      idOwed: false,
      ...kept,
    });
    if (signalled) return unkeyed(signalled);
    if (levels.peakDbfs === -Infinity) {
      throw new TransportError('speech-engine-failed', `say wrote digital zero with voice ${JSON.stringify(options.voice)}`, { voice: options.voice });
    }
    const keyedSeconds = levels.seconds + options.tailMs / 1000;
    if (keyedSeconds > options.maxSeconds) {
      throw new UsageError(
        `the utterance runs ${round(keyedSeconds)} s with tailMs, past maxSeconds ${options.maxSeconds}`,
        { seconds: round(keyedSeconds), maxSeconds: options.maxSeconds },
        options.idOnly ? { remedy: 'raise maxSeconds in the station config, then rerun the command' } : {},
        'utterance-too-long',
      );
    }
    if (options.out !== undefined) {
      try {
        copyFileSync(wav, options.out);
      } catch (err) {
        throw new UsageError(`cannot write ${options.out}: ${(err as NodeJS.ErrnoException).message}`, { out: options.out }, { remedy: 'pass --out with a writable path' });
      }
      kept = { out: options.out };
    }
    if (options.rehearse) {
      try {
        await deps.play(wav, levels.seconds);
      } catch (err) {
        if (err instanceof BaofengError) err.attach({}, { remedy: 'check the system output, then rerun say --rehearse', retry: 'after-remedy' });
        throw err;
      }
      return { text: options.text, spoken, identified: false, seconds: round(levels.seconds), ...measured, device: REHEARSE_DEVICE, ...pacing, pttAsserted: false, released: true, rehearsed: true, ...kept };
    }
    const index = await deps.resolveOutput(options.output);
    if (options.clearSeconds > 0 && !signalled) {
      const monitor = deps.monitor(options.input);
      onSignal = () => void monitor.stop();
      try {
        await checkClear(monitor, options.input, options.clearSeconds);
      } catch (err) {
        // Keep the signal result when the signal cut the capture short.
        if (!signalled) throw err;
      } finally {
        onSignal = () => {};
      }
    }
    if (signalled) return unkeyed(signalled);
    const maxMs = Math.ceil(levels.seconds * 1000) + options.tailMs + PLAYER_START_MS;
    let startedAt: number | undefined;
    let endedAt: number | undefined;
    let identified = false;
    let dropping = () => false;
    const playedMs = () => (startedAt === undefined ? 0 : (endedAt ?? deps.now()) - startedAt);
    const owed = () => !identified && playedMs() > options.leadMs;
    const body = async (stop: Promise<void>) => {
      startedAt = deps.now();
      try {
        await deps.playTo(index, wav, stop);
      } catch (err) {
        endedAt = deps.now();
        throw err;
      }
      endedAt = deps.now();
      if (!signalled && !dropping()) identified = true;
      await wait(options.tailMs, stop);
    };
    let held: HoldResult | undefined;
    let released = () => false;
    try {
      held = await withPort(async (t) => {
        // Skip keying when a signal arrived while the port opened.
        if (signalled) return undefined;
        const tracked = trackRelease(t);
        dropping = tracked.dropping;
        released = tracked.released;
        return keyWhile(tracked.transport, body, { maxMs }, deps.signals);
      });
    } catch (err) {
      if (startedAt !== undefined && err instanceof BaofengError) {
        const idOwed = owed();
        // Keep the unplug remedy when the port close hung after the release.
        const idRemedy = idOwed && released() && err.reason !== 'ptt-control-failed';
        err.attach({ pttAsserted: true, released: released(), playedSeconds: round(playedMs() / 1000), idOwed }, idRemedy ? { remedy: ID_OWED_REMEDY, retry: 'no' } : { retry: 'no' });
      }
      throw err;
    }
    if (held === undefined) return unkeyed(signalled!);
    if (held.timedOut && !held.interrupted) {
      const idOwed = owed();
      throw new TransportError(
        'audio-process-failed',
        `the player ran past ${maxMs / 1000} s; PTT dropped at the watchdog`,
        { pttAsserted: true, released: true, playedSeconds: round(playedMs() / 1000), seconds: held.seconds, idOwed },
        idOwed ? { remedy: ID_OWED_REMEDY, retry: 'no' } : { retry: 'no' },
      );
    }
    const result: SpeakResult = { text: options.text, spoken, identified, seconds: held.seconds, ...measured, device: options.output, ...pacing, pttAsserted: held.pttAsserted, released: held.released, ...kept };
    if (held.interrupted) {
      result.interrupted = held.interrupted;
      result.idOwed = owed();
      if (result.idOwed) result.remedy = ID_OWED_REMEDY;
    }
    return result;
  } finally {
    for (const [signal, handler] of handlers) deps.signals.off(signal, handler);
    rmSync(scratch, { recursive: true, force: true });
  }
}
