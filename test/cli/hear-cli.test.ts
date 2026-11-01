import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportError } from '../../src/core/index.ts';
import { signalExitCode } from '../../src/cli/exit.ts';
import { cli, type OpenTransport } from '../../src/cli/main.ts';
import { FRAMES_PER_SECOND } from '../../src/tts/segment.ts';
import { REPO_ROOT, whisperTranscriber } from '../../src/tts/stt.ts';
import { FakeMonitor, fakeClock, fakeSpeechDeps, fakeTranscribe, fakeTranscriber, silentFrames, toneFrames } from '../tts/fakes.ts';

const TMP = mkdtempSync(join(tmpdir(), 'uv5r-hear-cli-'));

/** Write a station config holding `json` and return its path. */
function config(json: object): string {
  const file = join(mkdtempSync(join(TMP, 'cfg-')), 'uv5r.json');
  writeFileSync(file, JSON.stringify(json));
  return file;
}

const STATION = config({ callsign: 'kj7abc', inputDevice: 'USB Input', model: 'models/ggml-small.en.bin' });
/** Frames of silence that close a segment under the default --hang of 1.5 s. */
const HANG_FRAMES = 1.5 * FRAMES_PER_SECOND;
const TX = [...toneFrames(50), ...silentFrames(HANG_FRAMES)];

/** An opener that fails the test when hear opens a port. */
const noPort: OpenTransport = async () => {
  throw new Error('hear opened a serial port');
};

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => stdout.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => stderr.push(String(chunk)) > 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const lines = () =>
  stdout
    .join('')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
const errJson = () => JSON.parse(stderr.join('').trim()) as Record<string, unknown>;

/** Speech deps with a FakeMonitor on a fake clock and a recording transcriber. */
function hearDeps(transcribe = fakeTranscribe()) {
  const clock = fakeClock();
  const monitor = new FakeMonitor(clock);
  const devices: string[] = [];
  const transcriber = fakeTranscriber(transcribe);
  const deps = fakeSpeechDeps({
    now: clock.now,
    transcriber,
    monitor: (device) => {
      devices.push(device);
      return monitor;
    },
  });
  return { deps, monitor, devices, transcriber, transcribe };
}

describe('hear', () => {
  it('exits 2 with invalid-argument on --timeout without --once, before capture', async () => {
    const h = hearDeps();
    await cli(['hear', '--timeout', '30', '--config', STATION, '--json'], noPort, h.deps);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', flag: 'timeout' });
    expect(h.devices).toEqual([]);
  });

  it.each([
    [['--hang', '0']],
    [['--floor', '-120']],
    [['--once', '--timeout', '0']],
  ])('exits 2 on %j before capture', async (flags) => {
    const h = hearDeps();
    await cli(['hear', ...flags, '--config', STATION, '--json'], noPort, h.deps);
    expect(process.exitCode).toBe(2);
    expect(h.devices).toEqual([]);
  });

  it('reads inputDevice, model and callsign from the config and prints NDJSON with --once', async () => {
    const h = hearDeps();
    const done = cli(['hear', '--once', '--config', STATION], noPort, h.deps);
    await h.monitor.feed(TX);
    await done;
    expect(process.exitCode).toBe(0);
    expect(h.devices).toEqual(['USB Input']);
    expect(h.transcriber.calls).toEqual([
      { model: join(REPO_ROOT, 'models/ggml-small.en.bin'), vadModel: join(REPO_ROOT, 'models/ggml-silero-v6.2.0.bin'), prompt: 'KJ7ABC' },
    ]);
    const out = lines();
    expect(out.map((l) => l.type)).toEqual(['transmission', 'summary']);
    expect(out[0]).toMatchObject({ seq: 1, model: 'ggml-small.en', engine: 'whisper.cpp', wav: null });
    expect(out[1]).toEqual({ type: 'summary', transmissions: 1, seconds: 2.5, input: 'USB Input', warnings: 0, timedOut: false });
  });

  it('defaults the device to AIOC Audio, the model to base.en-q5_1 and the prompt to empty with no callsign', async () => {
    const h = hearDeps();
    const done = cli(['hear', '--once', '--config', config({}), '--json'], noPort, h.deps);
    await h.monitor.feed(TX);
    await done;
    expect(h.devices).toEqual(['AIOC Audio']);
    expect(h.transcriber.calls[0]).toMatchObject({ model: join(REPO_ROOT, 'models/ggml-base.en-q5_1.bin'), prompt: '' });
  });

  it('passes --input over the config inputDevice', async () => {
    const h = hearDeps();
    const done = cli(['hear', '--once', '--input', 'AIOC Audio', '--config', STATION, '--json'], noPort, h.deps);
    await h.monitor.feed(TX);
    await done;
    expect(h.devices).toEqual(['AIOC Audio']);
  });

  it('exits 3 with dependency-missing naming a missing model file, before capture', async () => {
    const h = hearDeps();
    const missing = join(TMP, 'no-such-model.bin');
    const deps = { ...h.deps, transcriber: whisperTranscriber };
    await cli(['hear', '--once', '--config', config({ model: missing }), '--json'], noPort, deps);
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'dependency-missing', file: missing, message: expect.stringContaining(missing) });
    expect(h.devices).toEqual([]);
    expect(stdout).toEqual([]);
  });

  it('prints timedOut true with nothing heard and exits 0', async () => {
    const h = hearDeps();
    const done = cli(['hear', '--once', '--timeout', '1', '--config', STATION, '--json'], noPort, h.deps);
    await h.monitor.feed(silentFrames(60));
    await done;
    expect(process.exitCode).toBe(0);
    expect(lines()).toEqual([{ type: 'summary', transmissions: 0, seconds: 1, input: 'USB Input', warnings: 0, timedOut: true }]);
  });

  it('keeps segment WAVs in --out-dir and continues seq past the highest one there', async () => {
    const outDir = join(mkdtempSync(join(TMP, 'out-')), 'rx');
    const h = hearDeps();
    const first = cli(['hear', '--once', '--out-dir', outDir, '--config', STATION, '--json'], noPort, h.deps);
    await h.monitor.feed(TX);
    await first;
    expect(lines()[0]).toMatchObject({ seq: 1, wav: join(outDir, 'seg-000001.wav') });
    writeFileSync(join(outDir, 'seg-000041.wav'), '');
    stdout = [];
    const again = hearDeps();
    const second = cli(['hear', '--once', '--out-dir', outDir, '--config', STATION, '--json'], noPort, again.deps);
    await again.monitor.feed(TX);
    await second;
    expect(lines()[0]).toMatchObject({ seq: 42, wav: join(outDir, 'seg-000042.wav') });
    expect(existsSync(join(outDir, 'seg-000042.wav'))).toBe(true);
  });

  it('exits 2 on an --out-dir it cannot list, before capture', async () => {
    const dir = mkdtempSync(join(TMP, 'out-'));
    chmodSync(dir, 0o300);
    try {
      const h = hearDeps();
      await cli(['hear', '--once', '--out-dir', dir, '--config', STATION, '--json'], noPort, h.deps);
      expect(process.exitCode).toBe(2);
      expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(`cannot write to ${dir}`), outDir: dir });
      expect(h.devices).toEqual([]);
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it('exits 128 plus the signal number on SIGTSTP with the summary on stdout', async () => {
    const h = hearDeps();
    const done = cli(['hear', '--config', STATION, '--json'], noPort, h.deps);
    await h.monitor.feed(silentFrames(10));
    h.deps.signals.emit('SIGTSTP');
    await done;
    expect(process.exitCode).toBe(signalExitCode('SIGTSTP'));
    expect(lines()).toEqual([{ type: 'summary', transmissions: 0, seconds: 0.2, input: 'USB Input', warnings: 0, interrupted: 'SIGTSTP' }]);
  });

  it('keeps the lines printed before a whisper-cli failure and exits 3 with the error on stderr', async () => {
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = hearDeps(transcribe);
    const done = cli(['hear', '--config', STATION, '--json'], noPort, h.deps);
    await h.monitor.feed(TX, TX);
    transcribe.pending[0]!.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    transcribe.pending[1]!.reject(new TransportError('speech-engine-failed', 'whisper-cli exited with code 1'));
    await done;
    expect(process.exitCode).toBe(3);
    expect(lines().map((l) => l.type)).toEqual(['transmission']);
    expect(errJson()).toMatchObject({ reason: 'speech-engine-failed' });
  });

  it('exits 3 with the error on stderr when whisper-cli fails after a signal, keeping the lines printed', async () => {
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = hearDeps(transcribe);
    const done = cli(['hear', '--config', STATION, '--json'], noPort, h.deps);
    await h.monitor.feed(TX);
    transcribe.pending[0]!.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await h.monitor.feed(TX, TX);
    h.deps.signals.emit('SIGINT');
    transcribe.pending[1]!.reject(new TransportError('speech-engine-failed', 'whisper-cli exited with code 1'));
    await done;
    expect(process.exitCode).toBe(3);
    expect(lines().map((l) => l.warning ?? l.type)).toEqual(['transmission', 'backlog']);
    expect(errJson()).toMatchObject({ reason: 'speech-engine-failed' });
  });

  it('prints one readable line per transmission and warning and a summary line on a terminal', async () => {
    const h = hearDeps(fakeTranscribe(['thank you', 'bench check over']));
    const tty = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      const done = cli(['hear', '--once', '--config', STATION], noPort, h.deps);
      await h.monitor.feed(TX, TX);
      await done;
    } finally {
      process.stdout.isTTY = tty;
    }
    const text = stdout.join('').trim().split('\n');
    expect(text).toHaveLength(3);
    expect(text[0]).toMatch(/^warning \S+Z \d+\.\d+ s noise: thank you$/);
    expect(text[1]).toMatch(/^rx +\S+Z \d+\.\d+ s -?\d+(\.\d)? dBFS: bench check over$/);
    expect(text[2]).toBe('heard   1 transmission in 5 s on USB Input, 1 warning');
  });

  it('documents the event lines and the summary result in help hear --json with schema version 4', async () => {
    await cli(['help', 'hear', '--json']);
    const help = JSON.parse(stdout.join('')) as Record<string, any>;
    expect(help.schemaVersion).toBe(4);
    expect(help.lines.map((l: { type: string }) => l.type)).toEqual(['warning', 'transmission']);
    expect(help.result).toMatchObject({ type: 'summary', transmissions: 1, timedOut: false });
    expect(help.flags.map((f: { flag: string }) => f.flag)).toEqual(['--input', '--floor', '--hang', '--out-dir', '--once', '--timeout', '--config', '--json']);
    expect(help.device).toEqual({ opensPort: false, cloneSession: false, writesToRadio: false, appliesAfterMs: 0, partialWrite: false, note: 'audio only' });
  });
});
