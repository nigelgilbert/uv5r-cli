import type { EventEmitter } from 'node:events';
import { CLIP_WARNING, DEFAULT_FLOOR_DBFS, listen, type ListenResult } from './audio.ts';
import {
  KEY_SIGNALS,
  readSettings,
  startFreshSession,
  verifySettingsInFreshSession,
  withDetail,
  withSession,
  writeSettings,
  type BaofengError,
  type Magic,
  type Transport,
} from '../core/index.ts';

/** Seconds `volume` captures of open-squelch static. */
export const VOLUME_SECONDS = 2;
/** Low edge of the static RMS band in dBFS; provisional until the bench pass with live speech sets it. */
export const TARGET_LOW_DBFS = -28;
/** High edge of the static RMS band in dBFS; provisional until the bench pass with live speech sets it. */
export const TARGET_HIGH_DBFS = -22;
/** Distance in dB outside the band past which the instruction asks for a quarter turn. */
export const COARSE_STEP_DB = 6;

/** Which way the volume knob needs to go, or ok when the static sits inside the band. */
export type VolumeState = 'too-loud' | 'too-quiet' | 'silent' | 'ok';

/** One volume reading: the state, the mean RMS in dBFS and the sentence to relay to the human. */
export interface VolumeResult {
  state: VolumeState;
  /** Mean RMS of the capture in dBFS; null when every second is digital zero. */
  rmsDbfs: number | null;
  instruction: string;
}

/** The sentence for each row of the judgement, in the order judgeVolume applies them. */
export const VOLUME_INSTRUCTIONS = {
  clipped: 'Turn the volume knob down about a half turn, then say done.',
  zero:
    'The Mac is sending the radio tool silence. In System Settings, Privacy & Security, Microphone, allow the terminal, and check that AIOC Audio is not muted. Then say done.',
  underFloor: 'Turn the volume knob up a little. If it is already up, push the plug all the way in. Then say done.',
  farAbove: 'Turn the volume knob down about a quarter turn, then say done.',
  above: 'Turn the volume knob down a little, then say done.',
  farBelow: 'Turn the volume knob up about a quarter turn, then say done.',
  below: 'Turn the volume knob up a little, then say done.',
  inside: 'The volume knob is set. Leave it there.',
} as const;

/**
 * Judge a capture of open-squelch static. The rows apply in order, so a clip warning reads
 * too-loud at any RMS. A null mean reads silent as digital zero, and a mean at or under
 * DEFAULT_FLOOR_DBFS reads silent as a knob down or an unseated plug. A mean outside
 * TARGET_LOW_DBFS..TARGET_HIGH_DBFS reads too-loud or too-quiet, with a quarter turn past
 * COARSE_STEP_DB. A mean inside the band reads ok.
 */
export function judgeVolume(heard: ListenResult): VolumeResult {
  const rms = heard.meanRmsDbfs;
  const result = (state: VolumeState, instruction: string): VolumeResult => ({ state, rmsDbfs: rms, instruction });
  const say = VOLUME_INSTRUCTIONS;
  if (heard.warnings.includes(CLIP_WARNING)) return result('too-loud', say.clipped);
  if (rms === null) return result('silent', say.zero);
  if (rms <= DEFAULT_FLOOR_DBFS) return result('silent', say.underFloor);
  if (rms > TARGET_HIGH_DBFS + COARSE_STEP_DB) return result('too-loud', say.farAbove);
  if (rms > TARGET_HIGH_DBFS) return result('too-loud', say.above);
  if (rms < TARGET_LOW_DBFS - COARSE_STEP_DB) return result('too-quiet', say.farBelow);
  if (rms < TARGET_LOW_DBFS) return result('too-quiet', say.below);
  return result('ok', say.inside);
}

/** Run `fn` with the serial port open and close the port after it. */
export type WithPort = (fn: (t: Transport) => Promise<void>) => Promise<void>;

export interface VolumeOptions {
  /** avfoundation audio input to capture from. */
  device: string;
  /** Magic every clone session opens with; 291 when absent. */
  magic?: Magic;
  /** Source of the key signals. */
  signals?: EventEmitter;
}

/** A finished capture, or the signal that ended the run before one finished. */
export type VolumeReading = { heard: ListenResult } | { interrupted: NodeJS.Signals };

/** Return `err` with `squelch` set to `kept` and the remedy that writes it back. */
function withSquelch(err: unknown, kept: number): BaofengError {
  return withDetail(err, { squelch: kept }).attach({}, { remedy: `run uv5r settings squelch ${kept}`, retry: 'after-remedy' });
}

/**
 * Install handlers for SIGINT, SIGTERM, SIGHUP and SIGTSTP on `options.signals`, then open the
 * port through `withPort`. In one clone session read the squelch setting and keep it. When it
 * is above 0, write squelch 0 and verify the block in a fresh session. Capture VOLUME_SECONDS
 * at DEFAULT_FLOOR_DBFS. Once the squelch is kept and above 0, write it back in a fresh session
 * and verify it, also after a failed write, a failed verification, a failed capture or a
 * signal. The handlers stay until the restore ends. A signal skips the steps that have not
 * started, kills a capture in progress and returns the signal in place of a capture. Any error
 * once the squelch is kept and above 0 carries `squelch` and the remedy that writes it back,
 * and keeps its own reason. A failed restore throws even after a signal, and after an earlier
 * failure the earlier error is the one thrown.
 */
export async function readVolume(withPort: WithPort, options: VolumeOptions): Promise<VolumeReading> {
  const { device, magic, signals = process } = options;
  let signal: NodeJS.Signals | undefined;
  let wake = () => {};
  const stopped = new Promise<void>((resolve) => (wake = resolve));
  const handlers = KEY_SIGNALS.map((s) => {
    const handler = () => {
      if (signal) return;
      signal = s;
      wake();
    };
    signals.on(s, handler);
    return [s, handler] as const;
  });
  let heard: ListenResult | undefined;
  try {
    await withPort(async (t) => {
      if (signal) return;
      let kept: number | undefined;
      let failure: unknown;
      try {
        const block = await withSession(
          t,
          async (s) => {
            // Squelch has no value names, so it decodes as a number.
            kept = Number((await readSettings(s)).squelch);
            if (kept === 0) return undefined;
            return writeSettings(s, { squelch: 0 });
          },
          { magic },
        );
        if (block !== undefined && !signal) await verifySettingsInFreshSession(t, block, { magic });
        if (!signal) heard = await listen(device, VOLUME_SECONDS, DEFAULT_FLOOR_DBFS, { stop: stopped });
      } catch (err) {
        // Drop an error after a signal, as the killed capture raises one.
        if (!signal) failure = err;
      }
      if (kept === undefined || kept === 0) {
        if (failure !== undefined) throw failure;
        return;
      }
      try {
        const s = await startFreshSession(t, { magic });
        const block = await writeSettings(s, { squelch: kept });
        await verifySettingsInFreshSession(t, block, { magic });
      } catch (err) {
        throw withSquelch(failure ?? err, kept);
      }
      if (failure !== undefined) throw withSquelch(failure, kept);
    });
  } finally {
    for (const [s, handler] of handlers) signals.off(s, handler);
  }
  if (signal) return { interrupted: signal };
  return { heard: heard! };
}
