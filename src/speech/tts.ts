import { execDetached, exitHow, ffmpegMissing, stderrTail } from '../cli/audio.ts';
import { TransportError } from '../core/index.ts';
import { WAV_RATE } from './levels.ts';

/** Milliseconds `say` gets to render one utterance. */
const SAY_TIMEOUT_MS = 60_000;

/** Milliseconds the conditioning pass gets. */
const CONDITION_TIMEOUT_MS = 30_000;

/** Seconds of silence the conditioning pass appends, which covers audiotoolbox cutting the last buffer. */
export const TRAILING_PAD_SECONDS = 0.3;

/** High-pass corner that keeps speech energy out of the CTCSS band below 300 Hz. */
const HIGHPASS_HZ = 300;

/** Low-pass corner at the top of the voice band. */
const LOWPASS_HZ = 3000;

/** Arguments for macOS `say` that render `text` in `voice` to `wav` as 48 kHz 16-bit little-endian PCM; `--` lets the text start with a dash. */
export function sayArgs(text: string, voice: string, wav: string): string[] {
  return ['-v', voice, '-o', wav, `--data-format=LEI16@${WAV_RATE}`, '--', text];
}

/**
 * Render `text` in `voice` to `wav` with macOS `say` in its own process group. A missing
 * `say` rejects with dependency-missing; any other failure rejects with speech-engine-failed
 * and the stderr tail, which names an unknown voice.
 */
export function synthesize(text: string, voice: string, wav: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execDetached('say', sayArgs(text, voice, wav), SAY_TIMEOUT_MS, (e, stderr) => {
      if (!e) {
        resolve();
        return;
      }
      if (e.code === 'ENOENT') {
        reject(new TransportError('dependency-missing', 'say not found on PATH; uv5r say runs on macOS', {}, { remedy: 'run uv5r say on the macOS bench' }));
        return;
      }
      const tail = stderrTail(stderr);
      reject(new TransportError('speech-engine-failed', `say ${exitHow(e, SAY_TIMEOUT_MS)} with voice ${JSON.stringify(voice)}${tail ? `: ${tail}` : ''}`, { voice, code: e.code ?? null, signal: e.signal ?? null }));
    });
  });
}

/**
 * ffmpeg arguments for the one conditioning pass: a 300 Hz high-pass, a 3 kHz low-pass and
 * alimiter, then `leadMs` of leading silence and TRAILING_PAD_SECONDS of trailing silence,
 * written as a 48 kHz mono 16-bit WAV.
 */
export function conditionArgs(input: string, output: string, leadMs: number): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-i',
    input,
    '-af',
    [`highpass=f=${HIGHPASS_HZ}`, `lowpass=f=${LOWPASS_HZ}`, 'alimiter', `adelay=delays=${leadMs}:all=1`, `apad=pad_dur=${TRAILING_PAD_SECONDS}`].join(','),
    '-ar',
    String(WAV_RATE),
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    '-f',
    'wav',
    '-y',
    output,
  ];
}

/**
 * Condition `input` into `output` with conditionArgs, with ffmpeg in its own process group.
 * A missing ffmpeg rejects with dependency-missing and any other failure with
 * audio-process-failed and the stderr tail.
 */
export function condition(input: string, output: string, leadMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execDetached('ffmpeg', conditionArgs(input, output, leadMs), CONDITION_TIMEOUT_MS, (e, stderr) => {
      if (!e) {
        resolve();
        return;
      }
      if (e.code === 'ENOENT') {
        reject(ffmpegMissing());
        return;
      }
      const tail = stderrTail(stderr);
      reject(new TransportError('audio-process-failed', `ffmpeg ${exitHow(e, CONDITION_TIMEOUT_MS)} conditioning ${input}${tail ? `: ${tail}` : ''}`, { code: e.code ?? null, signal: e.signal ?? null }));
    });
  });
}
