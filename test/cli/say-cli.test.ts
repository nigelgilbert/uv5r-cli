import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportError, type Transport } from '../../src/core/index.ts';
import { signalExitCode } from '../../src/cli/exit.ts';
import { cli, TRANSMIT_RULE, type OpenTransport } from '../../src/cli/main.ts';
import { idSentence } from '../../src/speech/phonetic.ts';
import { FakeRadio } from '../core/fake.ts';
import { fakeClock, fakeMonitor, fakePlayTo, fakeResolveOutput, fakeSpeechDeps, fakeSynthesize, pcmFrame } from '../speech/fakes.ts';

const ID = idSentence('KJ7ABC');

/** Write a station config holding `json` and return its path. */
function config(json: object): string {
  const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'uv5r.json');
  writeFileSync(file, JSON.stringify(json));
  return file;
}

const STATION = config({ callsign: 'kj7abc' });

/** Record each open and hand back `radio`. */
function opener(radio: Transport = new FakeRadio()): OpenTransport & { calls: number } {
  const open = Object.assign(
    async () => {
      open.calls++;
      return radio;
    },
    { calls: 0 },
  );
  return open;
}

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

const outJson = () => JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
const errJson = () => JSON.parse(stderr.join('').trim()) as Record<string, unknown>;

describe('say', () => {
  it('exits 2 with station-unconfigured before open when the config has no callsign', async () => {
    const open = opener();
    const synth = fakeSynthesize();
    await cli(['say', 'hello', '--config', config({ outputDevice: 'AIOC Audio' }), '--json'], open, fakeSpeechDeps({ synthesize: synth }));
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'station-unconfigured', retry: 'no' });
    expect(open.calls).toBe(0);
    expect(synth.calls).toEqual([]);
  });

  it('exits 2 with station-unconfigured before open when the default config file is absent', async () => {
    const open = opener();
    const synth = fakeSynthesize();
    const defaultConfig = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'uv5r.json');
    vi.stubEnv('UV5R_CONFIG', '');
    await cli(['say', 'hello', '--json'], open, fakeSpeechDeps({ synthesize: synth, defaultConfig }));
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'station-unconfigured', file: defaultConfig });
    expect(open.calls).toBe(0);
    expect(synth.calls).toEqual([]);
  });

  it('exits 2 before open when the named config file is missing', async () => {
    const open = opener();
    vi.stubEnv('UV5R_CONFIG', join(tmpdir(), 'uv5r-missing-config.json'));
    await cli(['say', 'hello', '--json'], open, fakeSpeechDeps());
    expect(process.exitCode).toBe(2);
    expect(open.calls).toBe(0);
  });

  it('speaks the text with the phonetic ID and prints the result keys', async () => {
    const radio = new FakeRadio();
    const synth = fakeSynthesize();
    await cli(['say', 'bench check, over', '--config', STATION, '--tail', '0', '--json'], opener(radio), fakeSpeechDeps({ synthesize: synth }));
    expect(process.exitCode).toBe(0);
    const result = outJson();
    expect(Object.keys(result)).toEqual(['text', 'spoken', 'identified', 'seconds', 'peakDbfs', 'rmsDbfs', 'device', 'pttAsserted', 'released']);
    expect(result).toMatchObject({ text: 'bench check, over', spoken: `bench check, over. ${ID}`, identified: true, device: 'AIOC Audio', pttAsserted: true, released: true });
    expect(synth.calls[0]).toMatchObject({ text: `bench check, over. ${ID}`, voice: 'Samantha' });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('raises PTT before the player starts and drops it after', async () => {
    const radio = new FakeRadio();
    const atStart: boolean[][] = [];
    const deps = fakeSpeechDeps({ playTo: fakePlayTo({ onStart: () => atStart.push([...radio.pttLog]) }) });
    await cli(['say', 'hello', '--config', STATION, '--tail', '0', '--json'], opener(radio), deps);
    expect(atStart).toEqual([[true]]);
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('speaks text that starts with -- after the terminator', async () => {
    const synth = fakeSynthesize();
    await cli(['say', '--config', STATION, '--tail', '0', '--json', '--', '--hello'], opener(), fakeSpeechDeps({ synthesize: synth }));
    expect(process.exitCode).toBe(0);
    expect(synth.calls[0]!.text).toBe(`--hello. ${ID}`);
    expect(outJson()).toMatchObject({ text: '--hello' });
  });

  it('exits 3 with speech-engine-failed before open on a digital-zero WAV', async () => {
    const open = opener();
    await cli(['say', 'hello', '--config', STATION, '--json'], open, fakeSpeechDeps({ synthesize: fakeSynthesize({ dbfs: -Infinity }) }));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'speech-engine-failed' });
    expect(open.calls).toBe(0);
  });

  it('counts --tail toward --max-seconds and exits 2 with utterance-too-long before open', async () => {
    const open = opener();
    const deps = () => fakeSpeechDeps({ synthesize: fakeSynthesize({ seconds: 2 }) });
    await cli(['say', 'hello', '--config', STATION, '--max-seconds', '3', '--tail', '500', '--json'], open, deps());
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'utterance-too-long', maxSeconds: 3 });
    expect(open.calls).toBe(0);
    stdout = [];
    await cli(['say', 'hello', '--config', STATION, '--max-seconds', '3', '--tail', '300', '--json'], open, deps());
    expect(process.exitCode).toBe(0);
  });

  it('exits 3 with audio-device-unavailable before PTT when the output is missing', async () => {
    const open = opener();
    await cli(['say', 'hello', '--config', config({ callsign: 'KJ7ABC', outputDevice: 'USB Out' }), '--json'], open, fakeSpeechDeps());
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'audio-device-unavailable', output: 'USB Out' });
    expect(open.calls).toBe(0);
  });

  it('takes --output over the config outputDevice', async () => {
    const resolveOutput = fakeResolveOutput({ 'MacBook Pro Speakers': 2 });
    await cli(['say', 'hello', '--config', config({ callsign: 'KJ7ABC', outputDevice: 'USB Out' }), '--output', 'MacBook Pro Speakers', '--tail', '0', '--json'], opener(), fakeSpeechDeps({ resolveOutput }));
    expect(process.exitCode).toBe(0);
    expect(resolveOutput.calls).toEqual(['MacBook Pro Speakers']);
    expect(outJson()).toMatchObject({ device: 'MacBook Pro Speakers' });
  });

  it('exits 5 with channel-busy before PTT when --clear hears activity on the config inputDevice', async () => {
    const open = opener();
    const devices: string[] = [];
    const deps = fakeSpeechDeps({
      monitor: (device) => {
        devices.push(device);
        return fakeMonitor([pcmFrame(-20)]);
      },
    });
    await cli(['say', 'hello', '--config', config({ callsign: 'KJ7ABC', inputDevice: 'USB In' }), '--clear', '1', '--json'], open, deps);
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'channel-busy', device: 'USB In' });
    expect(devices).toEqual(['USB In']);
    expect(open.calls).toBe(0);
  });

  it('releases PTT on SIGTSTP while keyed, reports idOwed and exits 128 plus the platform number', async () => {
    const radio = new FakeRadio();
    const clock = fakeClock();
    const deps = fakeSpeechDeps({ now: clock.now });
    deps.playTo = fakePlayTo({
      ms: 5000,
      clock,
      onStart: () => {
        clock.advance(1000);
        setTimeout(() => deps.signals.emit('SIGTSTP'), 30);
      },
    });
    await cli(['say', 'hello', '--config', STATION, '--json'], opener(radio), deps);
    expect(process.exitCode).toBe(signalExitCode('SIGTSTP'));
    expect(outJson()).toMatchObject({ interrupted: 'SIGTSTP', identified: false, idOwed: true, remedy: 'identify by voice or run uv5r id', released: true });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it.each(['SIGINT', 'SIGTSTP'] as const)('keys nothing on %s during synthesis and exits 128 plus the signal number', async (signal) => {
    const radio = new FakeRadio();
    const open = opener(radio);
    const deps = fakeSpeechDeps();
    const synth = fakeSynthesize();
    deps.synthesize = async (text, voice, wav) => {
      deps.signals.emit(signal);
      await synth(text, voice, wav);
    };
    await cli(['say', 'hello', '--config', STATION, '--json'], open, deps);
    expect(process.exitCode).toBe(signalExitCode(signal));
    expect(outJson()).toMatchObject({ interrupted: signal, identified: false, idOwed: false, pttAsserted: false, released: true });
    expect(open.calls).toBe(0);
    expect(radio.pttLog).toEqual([]);
  });

  it.each(['SIGINT', 'SIGTSTP'] as const)('stops --clear and keys nothing on %s, exiting 128 plus the signal number', async (signal) => {
    const radio = new FakeRadio();
    const open = opener(radio);
    const monitor = fakeMonitor([pcmFrame(-80)]);
    const deps = fakeSpeechDeps({ monitor: () => monitor });
    setTimeout(() => deps.signals.emit(signal), 30);
    await cli(['say', 'hello', '--config', STATION, '--clear', '30', '--json'], open, deps);
    expect(process.exitCode).toBe(signalExitCode(signal));
    expect(outJson()).toMatchObject({ interrupted: signal, idOwed: false, pttAsserted: false });
    expect(open.calls).toBe(0);
    expect(radio.pttLog).toEqual([]);
  });

  it('exits 3 with retry no and the PTT fields when the player fails while keyed', async () => {
    const fail = new TransportError('audio-process-failed', 'ffmpeg exited with code 1 playing tx.wav', { output: 3 });
    const clock = fakeClock();
    await cli(['say', 'hello', '--config', STATION, '--json'], opener(), fakeSpeechDeps({ now: clock.now, playTo: fakePlayTo({ fail, clock, onStart: () => clock.advance(1000) }) }));
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    expect(errJson()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', pttAsserted: true, released: true, playedSeconds: expect.any(Number), idOwed: true });
  });

  it('plays with the port closed on --rehearse', async () => {
    const open = opener();
    const played: string[] = [];
    await cli(['say', 'hello', '--config', STATION, '--rehearse', '--json'], open, fakeSpeechDeps({ play: async (wav) => void played.push(wav) }));
    expect(process.exitCode).toBe(0);
    expect(open.calls).toBe(0);
    expect(played).toHaveLength(1);
    expect(outJson()).toMatchObject({ rehearsed: true, pttAsserted: false });
  });

  it('ignores UV5R_MAGIC', async () => {
    vi.stubEnv('UV5R_MAGIC', 'NOPE');
    await cli(['say', 'hello', '--config', STATION, '--tail', '0', '--json'], opener(), fakeSpeechDeps());
    expect(process.exitCode).toBe(0);
  });

  it.each([
    [['say', '--json'], 'say needs TEXT'],
    [['say', 'hi', '--max-seconds', '56', '--json'], '--max-seconds takes 0 < S <= 55'],
    [['say', 'hi', '--lead', '-1', '--json'], '--lead takes 0..5000 ms'],
    [['say', 'hi', '--clear', '31', '--json'], '--clear takes 0..30 seconds'],
    [['say', 'hi', '--out', '-', '--json'], '--out takes a file path'],
  ])('exits 2 on %j before open', async (argv, message) => {
    const open = opener();
    await cli([...argv, '--config', STATION], open, fakeSpeechDeps());
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(message) });
    expect(open.calls).toBe(0);
  });

  it('prints the spoken text, levels and PTT on a terminal', async () => {
    const tty = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      await cli(['say', 'hello', '--config', STATION, '--tail', '0'], opener(), fakeSpeechDeps());
    } finally {
      process.stdout.isTTY = tty;
    }
    const text = stdout.join('');
    expect(text).toContain(`spoken     hello. ${ID}\n`);
    expect(text).toMatch(/levels {5}peak -3 dBFS, rms -[\d.]+ dBFS\n/);
    expect(text).toMatch(/PTT {8}asserted for [\d.]+ s; released\n/);
    expect(text).toContain('identified yes');
  });

  it('carries the control-operator rule in help say and help --json', async () => {
    await cli(['help', 'say', '--json']);
    const help = JSON.parse(stdout.join('')) as { preconditions: string[]; flags: { flag: string; default: unknown }[] };
    expect(help.preconditions).toContain(TRANSMIT_RULE);
    const flag = (name: string) => help.flags.find((f) => f.flag === name)?.default;
    expect([flag('--voice'), flag('--lead'), flag('--tail'), flag('--max-seconds'), flag('--clear'), flag('--rehearse')]).toEqual(['Samantha', 300, 400, 30, 0, false]);
    stdout = [];
    await cli(['help', '--json']);
    expect(JSON.parse(stdout.join('')).rules.transmit).toBe(TRANSMIT_RULE);
  });

  it('states the control-operator rule in README.md and lists say and id in its verb table', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme).toContain(TRANSMIT_RULE);
    expect(readme).toMatch(/^\| `say` \|/m);
    expect(readme).toMatch(/^\| `id` \|/m);
  });
});
