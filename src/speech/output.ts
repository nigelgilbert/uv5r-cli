import { type ChildProcess, spawn } from 'node:child_process';
import { KILL_GRACE_MS, exitHow, ffmpegMissing, stderrTail, type ExecError } from '../cli/audio.ts';
import { TransportError } from '../core/index.ts';

/** Milliseconds the device listing gets. */
const LIST_TIMEOUT_MS = 10_000;

/** UID suffix of the AIOC output device; its input ends in `:2`. */
const OUTPUT_UID_SUFFIX = ':1';

/** Bytes of stderr a detached run keeps. */
const STDERR_KEEP = 1024 * 1024;

/**
 * Run `file` with `args` in its own process group and call `callback` once it exits, as
 * execFile calls its callback: a null error on exit 0, else an ExecError with the exit code
 * or signal, `killed` set after a timeout, or the spawn error itself. A terminal Ctrl-C or
 * Ctrl-Z then reaches only uv5r. `timeoutMs` 0 sets no timeout. Return the child so the
 * caller can kill it.
 */
export function execDetached(file: string, args: string[], timeoutMs: number, callback: (err: ExecError | null, stderr: string) => void): ChildProcess {
  const child = spawn(file, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let stderr = '';
  let timedOut = false;
  let failed: ExecError | undefined;
  let done = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : undefined;
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (failed) callback(failed, stderr);
    else if (code === 0) callback(null, stderr);
    else callback(Object.assign(new Error(`${file} exited`), { code: code as unknown as string, signal, killed: timedOut }), stderr);
  };
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP);
  });
  child.on('error', (e: ExecError) => {
    failed = e;
    // A child that never spawned emits no close.
    if (child.pid === undefined) finish(null, null);
  });
  child.on('close', finish);
  return child;
}

/** One CoreAudio device as the audiotoolbox listing prints it. */
export interface OutputDevice {
  index: number;
  name: string;
  uid: string;
}

/**
 * ffmpeg arguments that print the CoreAudio device list. audiotoolbox lists devices only as
 * an output, so ffmpeg sends one frame of silence to the system default output after the list.
 */
export function listArgs(): string[] {
  return ['-hide_banner', '-nostdin', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-frames:a', '1', '-f', 'audiotoolbox', '-list_devices', 'true', '-'];
}

/**
 * Parse the audiotoolbox device list from ffmpeg stderr. libavdevice/audiotoolbox.m prints
 * `[%d] %30s, %s` per device after `CoreAudio devices:`, behind the
 * `[AudioToolbox @ 0x...]` log prefix, so the name is right-aligned to 30 columns and the
 * UID follows the last comma.
 */
export function parseDeviceList(stderr: string): OutputDevice[] {
  const devices: OutputDevice[] = [];
  for (const [, index, name, uid] of stderr.matchAll(/^(?:\[[^\]]*@[^\]]*\] )?\[(\d+)\] +(.*), ([^,\n]*?)\s*$/gm)) {
    devices.push({ index: Number(index), name: name!.trim(), uid: uid!.trim() });
  }
  return devices;
}

/**
 * Pick the device for `name`, matched against the device name or UID. When several
 * devices share the name, as the AIOC input and output do, take the first whose UID ends
 * in `:1`, else the first match. Throw audio-device-unavailable naming the listed devices
 * when nothing matches.
 */
export function pickOutput(devices: OutputDevice[], name: string): OutputDevice {
  const matches = devices.filter((d) => d.name === name || d.uid === name);
  const picked = matches.find((d) => d.uid.endsWith(OUTPUT_UID_SUFFIX)) ?? matches[0];
  if (picked) return picked;
  const listed = devices.map((d) => d.name).join(', ') || 'none';
  throw new TransportError('audio-device-unavailable', `no audiotoolbox output named ${JSON.stringify(name)}; devices: ${listed}`, { output: name, devices: devices.map((d) => d.name) });
}

/** Run the audiotoolbox listing and return the devices it prints. */
export function listOutputDevices(): Promise<OutputDevice[]> {
  return new Promise((resolve, reject) => {
    execDetached('ffmpeg', listArgs(), LIST_TIMEOUT_MS, (e, stderr) => {
      if (e?.code === 'ENOENT') {
        reject(ffmpegMissing());
        return;
      }
      const devices = parseDeviceList(stderr);
      // Keep a list printed before a later failure, since the listing comes first.
      if (e && devices.length === 0) {
        const tail = stderrTail(stderr);
        reject(new TransportError('audio-process-failed', `ffmpeg ${exitHow(e, LIST_TIMEOUT_MS)} listing audiotoolbox devices${tail ? `: ${tail}` : ''}`, { code: e.code ?? null, signal: e.signal ?? null }));
        return;
      }
      resolve(devices);
    });
  });
}

/** Resolve the audiotoolbox index of `name` from a fresh listing, since the index moves when devices connect. */
export async function resolveOutput(name: string): Promise<number> {
  return pickOutput(await listOutputDevices(), name).index;
}

/** ffmpeg arguments that play `wav` to the audiotoolbox device at `index`. */
export function playArgs(index: number, wav: string): string[] {
  return ['-hide_banner', '-nostdin', '-i', wav, '-f', 'audiotoolbox', '-audio_device_index', String(index), '-'];
}

/**
 * Play `wav` to the audiotoolbox device at `index` and resolve when ffmpeg exits 0. ffmpeg
 * runs in its own process group, so a terminal signal reaches only uv5r. When `stop`
 * resolves first, send ffmpeg SIGTERM, then SIGKILL after KILL_GRACE_MS, and reject with
 * audio-process-failed once it exits.
 */
export function playTo(index: number, wav: string, stop: Promise<void>): Promise<void> {
  let stopped = false;
  let exited = false;
  let escalate: NodeJS.Timeout | undefined;
  let child: ChildProcess | undefined;
  return new Promise((resolve, reject) => {
    child = execDetached('ffmpeg', playArgs(index, wav), 0, (e, stderr) => {
      clearTimeout(escalate);
      exited = true;
      child = undefined;
      if (e?.code === 'ENOENT') {
        reject(ffmpegMissing());
        return;
      }
      if (e || stopped) {
        const tail = stderrTail(stderr);
        const how = stopped || !e ? 'stopped when PTT dropped' : exitHow(e, 0);
        reject(new TransportError('audio-process-failed', `ffmpeg ${how} playing ${wav} to output ${index}${tail ? `: ${tail}` : ''}`, { output: index, code: e?.code ?? null, signal: e?.signal ?? null }));
        return;
      }
      resolve();
    });
    void stop.then(() => {
      if (exited || !child) return;
      stopped = true;
      child.kill('SIGTERM');
      escalate = setTimeout(() => child?.kill('SIGKILL'), KILL_GRACE_MS).unref();
    });
  });
}
