import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

import { BaofengError, TransportError, type Transport } from '../../src/core/index.ts';
import { idSentence } from '../../src/speech/phonetic.ts';
import { checkClear, ID_OWED_REMEDY, speakUtterance, withId, type SpeakOptions, type WithPort } from '../../src/speech/speak.ts';
import { conditionArgs, sayArgs, synthesize } from '../../src/speech/tts.ts';
import { FakeRadio } from '../core/fake.ts';
import { fakeClock, fakeMonitor, fakePlayTo, fakeResolveOutput, fakeSpeechDeps, fakeSynthesize, pcmFrame, wavBytes } from './fakes.ts';

const ID = idSentence('KJ7ABC');

const OPTIONS: SpeakOptions = {
  text: 'bench check, over',
  callsign: 'KJ7ABC',
  voice: 'Samantha',
  output: 'AIOC Audio',
  input: 'AIOC Audio',
  leadMs: 300,
  tailMs: 0,
  maxSeconds: 30,
  clearSeconds: 0,
};

/** A WithPort over `radio` that counts how often the port opened. */
function port(radio: Transport = new FakeRadio()): WithPort & { opens: number } {
  const withPort = Object.assign(
    async <T>(fn: (t: Transport) => Promise<T>) => {
      withPort.opens++;
      return fn(radio);
    },
    { opens: 0 },
  );
  return withPort;
}

/** Return the error `promise` rejects with. */
async function failure(promise: Promise<unknown>): Promise<BaofengError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof BaofengError)) throw new Error(`expected a BaofengError, got ${String(err)}`);
  return err;
}

beforeEach(() => {
  execFile.mockReset();
});

describe('withId', () => {
  it('adds a full stop before the ID unless the text ends a sentence', () => {
    expect(withId('bench check', 'KJ7ABC')).toBe(`bench check. ${ID}`);
    expect(withId(' over? ', 'KJ7ABC')).toBe(`over? ${ID}`);
  });
});

describe('speakUtterance', () => {
  it('ends every utterance with the phonetic ID and keys PTT around the player', async () => {
    const radio = new FakeRadio();
    const pttAtStart: boolean[][] = [];
    const synth = fakeSynthesize();
    const deps = fakeSpeechDeps({ synthesize: synth, playTo: fakePlayTo({ onStart: () => pttAtStart.push([...radio.pttLog]) }) });
    const result = await speakUtterance(OPTIONS, deps, port(radio));
    expect(synth.calls.map((c) => c.text)).toEqual([`bench check, over. ${ID}`]);
    expect(result.spoken.endsWith(ID)).toBe(true);
    expect(pttAtStart).toEqual([[true]]);
    expect(radio.pttLog).toEqual([true, false]);
    expect(Object.keys(result)).toEqual(['text', 'spoken', 'identified', 'seconds', 'peakDbfs', 'rmsDbfs', 'device', 'pttAsserted', 'released']);
    expect(result).toMatchObject({ text: 'bench check, over', identified: true, device: 'AIOC Audio', pttAsserted: true, released: true, peakDbfs: -3 });
  });

  it('passes --lead to the conditioning pass and plays to the resolved index', async () => {
    const deps = fakeSpeechDeps({ resolveOutput: fakeResolveOutput({ 'AIOC Audio': 7 }) });
    const playTo = fakePlayTo();
    await speakUtterance({ ...OPTIONS, leadMs: 500 }, { ...deps, playTo }, port());
    expect((deps.condition as unknown as { calls: { leadMs: number }[] }).calls[0]!.leadMs).toBe(500);
    expect(playTo.calls[0]!.index).toBe(7);
  });

  it('holds PTT for --tail after the player exits', async () => {
    const result = await speakUtterance({ ...OPTIONS, tailMs: 200 }, fakeSpeechDeps(), port());
    expect(result.seconds).toBeGreaterThanOrEqual(0.2);
  });

  it('removes the scratch dir', async () => {
    const synth = fakeSynthesize();
    await speakUtterance(OPTIONS, fakeSpeechDeps({ synthesize: synth }), port());
    expect(existsSync(dirname(synth.calls[0]!.wav))).toBe(false);
  });

  it('exits on a digital-zero WAV with speech-engine-failed before the port opens', async () => {
    const withPort = port();
    const err = await failure(speakUtterance(OPTIONS, fakeSpeechDeps({ synthesize: fakeSynthesize({ dbfs: -Infinity }) }), withPort));
    expect(err.toJSON()).toMatchObject({ reason: 'speech-engine-failed', voice: 'Samantha' });
    expect(err.kind).toBe('transport');
    expect(withPort.opens).toBe(0);
  });

  it('counts --tail toward --max-seconds', async () => {
    // 2 s of speech plus 0.3 s lead and 0.3 s trailing pad make a 2.6 s WAV.
    const deps = () => fakeSpeechDeps({ synthesize: fakeSynthesize({ seconds: 2 }) });
    await expect(speakUtterance({ ...OPTIONS, maxSeconds: 3, tailMs: 300 }, deps(), port())).resolves.toMatchObject({ identified: true });
    const withPort = port();
    const err = await failure(speakUtterance({ ...OPTIONS, maxSeconds: 3, tailMs: 500 }, deps(), withPort));
    expect(err.toJSON()).toMatchObject({ reason: 'utterance-too-long', seconds: 3.1, maxSeconds: 3 });
    expect(err.kind).toBe('usage');
    expect(withPort.opens).toBe(0);
  });

  it('exits on a missing output with audio-device-unavailable before PTT', async () => {
    const withPort = port();
    const err = await failure(speakUtterance({ ...OPTIONS, output: 'Nope' }, fakeSpeechDeps(), withPort));
    expect(err.reason).toBe('audio-device-unavailable');
    expect(withPort.opens).toBe(0);
  });

  it('exits with channel-busy on activity during --clear before PTT', async () => {
    const withPort = port();
    const monitor = fakeMonitor([pcmFrame(-80), pcmFrame(-20), pcmFrame(-80)]);
    const err = await failure(speakUtterance({ ...OPTIONS, clearSeconds: 1 }, fakeSpeechDeps({ monitor: () => monitor }), withPort));
    expect(err.toJSON()).toMatchObject({ reason: 'channel-busy', device: 'AIOC Audio' });
    expect(err.kind).toBe('device-state');
    expect(withPort.opens).toBe(0);
    expect(monitor.stops()).toBeGreaterThan(0);
  });

  it('keys after a quiet --clear on the input device', async () => {
    const devices: string[] = [];
    const quiet = Array.from({ length: 50 }, () => pcmFrame(-Infinity));
    const deps = fakeSpeechDeps({
      monitor: (device) => {
        devices.push(device);
        return fakeMonitor(quiet);
      },
    });
    const result = await speakUtterance({ ...OPTIONS, input: 'USB In', clearSeconds: 1 }, deps, port());
    expect(devices).toEqual(['USB In']);
    expect(result.pttAsserted).toBe(true);
  });

  it('reports interrupted and idOwed on a signal mid-utterance and releases PTT', async () => {
    const radio = new FakeRadio();
    const deps = fakeSpeechDeps();
    deps.playTo = fakePlayTo({ ms: 5000, onStart: () => setTimeout(() => deps.signals.emit('SIGINT'), 30) });
    const result = await speakUtterance(OPTIONS, deps, port(radio));
    expect(result).toMatchObject({ interrupted: 'SIGINT', identified: false, idOwed: true, remedy: ID_OWED_REMEDY, pttAsserted: true, released: true });
    expect(radio.pttLog).toEqual([true, false]);
    expect(deps.signals.listenerCount('SIGINT')).toBe(0);
  });

  it('owes no ID when the signal lands in the tail after the ID played', async () => {
    const deps = fakeSpeechDeps();
    deps.playTo = fakePlayTo({ ms: 10, onStart: () => setTimeout(() => deps.signals.emit('SIGTERM'), 100) });
    const result = await speakUtterance({ ...OPTIONS, tailMs: 2000 }, deps, port());
    expect(result).toMatchObject({ interrupted: 'SIGTERM', identified: true, idOwed: false });
    expect(result).not.toHaveProperty('remedy');
  });

  it('turns a player failure while keyed into audio-process-failed with retry no and the PTT fields', async () => {
    const radio = new FakeRadio();
    const clock = fakeClock();
    const fail = new TransportError('audio-process-failed', 'ffmpeg exited with code 1 playing tx.wav', { output: 3 });
    const deps = fakeSpeechDeps({ now: clock.now, playTo: fakePlayTo({ ms: 40, fail, clock }) });
    const err = await failure(speakUtterance(OPTIONS, deps, port(radio)));
    expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', remedy: ID_OWED_REMEDY, pttAsserted: true, released: true, playedSeconds: 0, idOwed: true });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('keeps the unplug remedy when the release fails after a player failure', async () => {
    const radio = new FakeRadio();
    radio.setPtt = async (on: boolean) => {
      radio.pttLog.push(on);
      if (!on) throw new Error('release failed');
      radio.ptt = on;
    };
    const fail = new TransportError('audio-process-failed', 'ffmpeg exited with code 1', {});
    const err = await failure(speakUtterance(OPTIONS, fakeSpeechDeps({ playTo: fakePlayTo({ fail }) }), port(radio)));
    expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', remedy: 'ask the human to unplug the AIOC to drop PTT', pttAsserted: true, released: false });
    expect(err.message).toContain('unplug the AIOC');
  });

  it('drops PTT at the watchdog when the player runs past the padded WAV plus --tail plus 5 s', async () => {
    vi.useFakeTimers();
    try {
      const radio = new FakeRadio();
      const pending = failure(speakUtterance(OPTIONS, fakeSpeechDeps({ playTo: fakePlayTo({ ms: 60_000 }) }), port(radio)));
      // The 2.6 s WAV plus 0 ms tail plus 5 s gives a 7.6 s watchdog.
      await vi.advanceTimersByTimeAsync(7599);
      expect(radio.ptt).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      const err = await pending;
      expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', remedy: ID_OWED_REMEDY, pttAsserted: true, released: true, idOwed: true });
      expect(radio.pttLog).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays through the system output with the port closed on --rehearse', async () => {
    const withPort = port();
    const played: { wav: string; seconds: number }[] = [];
    const resolveOutput = fakeResolveOutput();
    const deps = fakeSpeechDeps({ resolveOutput, play: async (wav, seconds) => void played.push({ wav, seconds }) });
    const result = await speakUtterance({ ...OPTIONS, rehearse: true }, deps, withPort);
    expect(withPort.opens).toBe(0);
    expect(resolveOutput.calls).toEqual([]);
    expect(played).toHaveLength(1);
    expect(played[0]!.seconds).toBeCloseTo(2.6, 5);
    expect(result).toMatchObject({ rehearsed: true, pttAsserted: false, released: true, identified: false, seconds: 2.6, device: 'system default output' });
  });

  it('keeps the conditioned WAV at --out', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'tx.wav');
    const result = await speakUtterance({ ...OPTIONS, out }, fakeSpeechDeps(), port());
    expect(result.out).toBe(out);
    // 0.3 s lead plus 2 s of tone plus the 0.3 s pad at 48 kHz s16.
    expect(readFileSync(out).length).toBe(44 + 2.6 * 48000 * 2);
  });
});

describe('checkClear', () => {
  it('passes a quiet capture and stops the monitor', async () => {
    const monitor = fakeMonitor(Array.from({ length: 25 }, () => pcmFrame(-60)));
    await checkClear(monitor, 'AIOC Audio', 0.5);
    expect(monitor.stops()).toBe(1);
  });

  it('throws capture-incomplete when the frames end early', async () => {
    const monitor = fakeMonitor([pcmFrame(-60)], { end: true });
    const err = await failure(checkClear(monitor, 'AIOC Audio', 0.5));
    expect(err.toJSON()).toMatchObject({ reason: 'capture-incomplete', captured: 1, requested: 25 });
  });
});

describe('say arguments', () => {
  it('renders 48 kHz 16-bit PCM and ends the options with --', () => {
    expect(sayArgs('--hello', 'Samantha', 'out.wav')).toEqual(['-v', 'Samantha', '-o', 'out.wav', '--data-format=LEI16@48000', '--', '--hello']);
  });

  it('conditions in one ffmpeg pass with the filters in order', () => {
    const args = conditionArgs('in.wav', 'out.wav', 500);
    expect(args[args.indexOf('-af') + 1]).toBe('highpass=f=300,lowpass=f=3000,alimiter,adelay=delays=500:all=1,apad=pad_dur=0.3');
    expect(args.slice(-3)).toEqual(['wav', '-y', 'out.wav']);
  });

  it('maps a missing say to dependency-missing and a failing say to speech-engine-failed', async () => {
    execFile.mockImplementationOnce((_f, _a, _o, cb) => cb(Object.assign(new Error('spawn say ENOENT'), { code: 'ENOENT' }), '', ''));
    expect((await failure(synthesize('hi', 'Samantha', 'x.wav'))).reason).toBe('dependency-missing');
    execFile.mockImplementationOnce((_f, _a, _o, cb) => cb(Object.assign(new Error('say failed'), { code: 1 }), '', "Voice `Nope' not found."));
    const err = await failure(synthesize('hi', 'Nope', 'x.wav'));
    expect(err.toJSON()).toMatchObject({ reason: 'speech-engine-failed', voice: 'Nope', message: expect.stringContaining('not found') });
  });

  it('writes a test WAV the fakes can measure', () => {
    expect(wavBytes(1, -6).length).toBe(44 + 96000);
  });
});
