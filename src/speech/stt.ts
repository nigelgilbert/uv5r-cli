import { accessSync, constants, existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execDetached, exitHow, stderrTail } from '../cli/audio.ts';
import { TransportError } from '../core/index.ts';

/** The repo root, found from this file the way packageVersion() finds package.json. */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Model `hear` loads when the config names none, relative to the repo root. */
export const DEFAULT_MODEL = 'models/ggml-base.en-q5_1.bin';

/** Silero VAD model whisper-cli runs inside each segment, relative to the repo root. */
export const VAD_MODEL = 'models/ggml-silero-v6.2.0.bin';

/** Engine name a transmission line reports. */
export const ENGINE = 'whisper.cpp';

/** Milliseconds one whisper-cli run gets, model load included. */
const WHISPER_TIMEOUT_MS = 120_000;

/** Guidance for a failed whisper-cli run. */
const WHISPER_FAILED = { remedy: 'ask the human to check the whisper-cli build and run shasum -a 256 -c models.sha256, then rerun the command' } as const;

/** What `hear` passes whisper-cli besides the segment. */
export interface WhisperOptions {
  /** Absolute path of the whisper.cpp model. */
  model: string;
  /** Absolute path of the Silero VAD model. */
  vadModel: string;
  /** Initial prompt, the callsign; empty leaves it out. */
  prompt: string;
}

/** The text whisper-cli heard in one segment and the milliseconds the run took. */
export interface Transcript {
  text: string;
  inferMs: number;
}

/** Transcribe one segment WAV. */
export type Transcribe = (wav: string) => Promise<Transcript>;

/** Return `path` as given when absolute, else joined to the repo root. */
export function repoPath(path: string): string {
  return isAbsolute(path) ? path : join(REPO_ROOT, path);
}

/** Return the model name a transmission line reports: the file name without `.bin`. */
export function modelName(path: string): string {
  return basename(path).replace(/\.bin$/, '');
}

/** whisper-cli arguments that transcribe `wav` with Silero VAD and suppressed non-speech tokens and write `out`.json. */
export function whisperArgs(wav: string, out: string, { model, vadModel, prompt }: WhisperOptions): string[] {
  return ['-m', model, '--vad', '-vm', vadModel, '-sns', ...(prompt ? ['--prompt', prompt] : []), '-oj', '-of', out, wav];
}

/**
 * Return the transcript in whisper-cli `-oj` output: the `text` of each `transcription`
 * entry joined, with whitespace runs collapsed and the ends trimmed. Output without a
 * `transcription` array throws speech-engine-failed.
 */
export function parseWhisperJson(text: string): string {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new TransportError('speech-engine-failed', `whisper-cli wrote JSON that does not parse: ${(err as Error).message}`);
  }
  const segments = (json as { transcription?: unknown } | null)?.transcription;
  if (!Array.isArray(segments)) throw new TransportError('speech-engine-failed', 'whisper-cli JSON has no transcription array');
  return segments
    .map((s) => (typeof (s as { text?: unknown }).text === 'string' ? (s as { text: string }).text : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The dependency-missing error for a whisper-cli absent from PATH. */
function whisperMissing(): TransportError {
  return new TransportError('dependency-missing', 'whisper-cli not found on PATH; build whisper.cpp and put build/bin on PATH', {}, { remedy: 'ask the human to build whisper.cpp and put whisper-cli on PATH' });
}

/** Return whether an executable `name` sits in a PATH directory. */
function onPath(name: string, path = process.env.PATH ?? ''): boolean {
  return path.split(delimiter).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Run whisper-cli on `wav` and resolve its transcript. whisper-cli runs in its own process
 * group so a Ctrl-C to uv5r lets the segment in inference finish, and gets `timeoutMs`. A
 * missing whisper-cli rejects with dependency-missing; a failed run or unreadable output
 * rejects with speech-engine-failed.
 */
export function transcribeWav(wav: string, options: WhisperOptions, timeoutMs = WHISPER_TIMEOUT_MS): Promise<Transcript> {
  const out = wav.replace(/\.wav$/, '');
  const json = `${out}.json`;
  const started = performance.now();
  return new Promise((resolve, reject) => {
    execDetached('whisper-cli', whisperArgs(wav, out, options), timeoutMs, (e, stderr) => {
      try {
        if (e?.code === 'ENOENT') throw whisperMissing();
        if (e) {
          const tail = stderrTail(stderr);
          const how = typeof e.code === 'string' ? e.message : exitHow(e, timeoutMs);
          throw new TransportError('speech-engine-failed', `whisper-cli ${how} on ${wav}${tail ? `: ${tail}` : ''}`, { code: e.code ?? null, signal: e.signal ?? null });
        }
        let text: string;
        try {
          text = readFileSync(json, 'utf8');
        } catch (err) {
          throw new TransportError('speech-engine-failed', `whisper-cli wrote no ${json}: ${(err as Error).message}`);
        }
        resolve({ text: parseWhisperJson(text), inferMs: Math.round(performance.now() - started) });
      } catch (err) {
        if (err instanceof TransportError && err.reason === 'speech-engine-failed') err.attach({ wav }, WHISPER_FAILED);
        reject(err);
      } finally {
        rmSync(json, { force: true });
      }
    });
  });
}

/**
 * Check that both model files exist and whisper-cli is on PATH, then return a Transcribe
 * bound to `options`. A missing file or program throws dependency-missing naming it.
 */
export function whisperTranscriber(options: WhisperOptions): Transcribe {
  for (const file of [options.model, options.vadModel]) {
    if (!existsSync(file)) {
      throw new TransportError('dependency-missing', `model file ${file} is missing`, { file }, { remedy: 'ask the human to download the model into models/ and check it with shasum -a 256 -c models.sha256' });
    }
  }
  if (!onPath('whisper-cli')) throw whisperMissing();
  return (wav) => transcribeWav(wav, options);
}
