import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

import { BaofengError, TransportError, type Transport } from '../../src/core/index.ts';
import { idSentence } from '../../src/tts/phonetic.ts';
import { checkClear, ID_OWED_REMEDY, speakUtterance, withId, type SpeakOptions, type WithPort } from '../../src/tts/speak.ts';
import { condition, conditionArgs, sayArgs, synthesize } from '../../src/tts/tts.ts';
import { FakeRadio } from '../core/fake.ts';
import { fakeClock, fakeMonitor, fakePlayTo, fakeResolveOutput, fakeSpeechDeps, fakeSynthesize, pcmFrame, spawnThen, wavBytes } from './fakes.ts';

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
  spawn.mockReset();
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
    const clock = fakeClock();
    const deps = fakeSpeechDeps({ now: clock.now });
    deps.playTo = fakePlayTo({
      ms: 5000,
      clock,
      onStart: () => {
        clock.advance(1000);
        setTimeout(() => deps.signals.emit('SIGINT'), 30);
      },
    });
    const result = await speakUtterance(OPTIONS, deps, port(radio));
    expect(result).toMatchObject({ interrupted: 'SIGINT', identified: false, idOwed: true, remedy: ID_OWED_REMEDY, pttAsserted: true, released: true });
    expect(radio.pttLog).toEqual([true, false]);
    expect(deps.signals.listenerCount('SIGINT')).toBe(0);
  });

  it('owes no ID when the signal lands inside --lead', async () => {
    const clock = fakeClock();
    const deps = fakeSpeechDeps({ now: clock.now });
    deps.playTo = fakePlayTo({ ms: 5000, clock, onStart: () => setTimeout(() => deps.signals.emit('SIGINT'), 30) });
    const result = await speakUtterance(OPTIONS, deps, port());
    expect(result).toMatchObject({ interrupted: 'SIGINT', identified: false, idOwed: false, pttAsserted: true, released: true });
    expect(result).not.toHaveProperty('remedy');
  });

  it.each(['SIGINT', 'SIGTSTP'] as const)('keys nothing on %s during synthesis', async (signal) => {
    const radio = new FakeRadio();
    const withPort = port(radio);
    const deps = fakeSpeechDeps();
    const synth = fakeSynthesize();
    deps.synthesize = async (text, voice, wav) => {
      deps.signals.emit(signal);
      await synth(text, voice, wav);
    };
    const result = await speakUtterance(OPTIONS, deps, withPort);
    expect(result).toMatchObject({ interrupted: signal, identified: false, idOwed: false, pttAsserted: false, released: true, seconds: 0, peakDbfs: -3 });
    expect(result).not.toHaveProperty('remedy');
    expect(withPort.opens).toBe(0);
    expect(radio.pttLog).toEqual([]);
    expect(deps.signals.listenerCount(signal)).toBe(0);
  });

  it.each(['SIGINT', 'SIGTSTP'] as const)('stops the clear check and keys nothing on %s during --clear', async (signal) => {
    const radio = new FakeRadio();
    const withPort = port(radio);
    const monitor = fakeMonitor([pcmFrame(-80)]);
    const deps = fakeSpeechDeps({ monitor: () => monitor });
    setTimeout(() => deps.signals.emit(signal), 30);
    const result = await speakUtterance({ ...OPTIONS, clearSeconds: 30 }, deps, withPort);
    expect(result).toMatchObject({ interrupted: signal, idOwed: false, pttAsserted: false, released: true });
    expect(monitor.stops()).toBeGreaterThan(0);
    expect(withPort.opens).toBe(0);
    expect(radio.pttLog).toEqual([]);
  });

  it('keys nothing on a signal while the port opens', async () => {
    const radio = new FakeRadio();
    const deps = fakeSpeechDeps();
    const withPort: WithPort = async (fn) => {
      deps.signals.emit('SIGHUP');
      return fn(radio);
    };
    const result = await speakUtterance(OPTIONS, deps, withPort);
    expect(result).toMatchObject({ interrupted: 'SIGHUP', idOwed: false, pttAsserted: false });
    expect(radio.pttLog).toEqual([]);
  });

  it('owes no ID when the signal lands in the tail after the ID played', async () => {
    const deps = fakeSpeechDeps();
    deps.playTo = fakePlayTo({ ms: 10, onStart: () => setTimeout(() => deps.signals.emit('SIGTERM'), 100) });
    const result = await speakUtterance({ ...OPTIONS, tailMs: 2000 }, deps, port());
    expect(result).toMatchObject({ interrupted: 'SIGTERM', identified: true, idOwed: false });
    expect(result).not.toHaveProperty('remedy');
  });

  it('turns a player failure after --lead into audio-process-failed with retry no, the PTT fields and idOwed', async () => {
    const radio = new FakeRadio();
    const clock = fakeClock();
    const fail = new TransportError('audio-process-failed', 'ffmpeg exited with code 1 playing tx.wav', { output: 3 });
    const deps = fakeSpeechDeps({ now: clock.now, playTo: fakePlayTo({ ms: 40, fail, clock, onStart: () => clock.advance(1200) }) });
    const err = await failure(speakUtterance(OPTIONS, deps, port(radio)));
    expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', remedy: ID_OWED_REMEDY, pttAsserted: true, released: true, playedSeconds: 1.2, idOwed: true });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('owes no ID when the player fails inside --lead', async () => {
    const clock = fakeClock();
    const fail = new TransportError('audio-process-failed', 'ffmpeg exited with code 1 playing tx.wav', { output: 3 });
    const deps = fakeSpeechDeps({ now: clock.now, playTo: fakePlayTo({ ms: 40, fail, clock }) });
    const err = await failure(speakUtterance(OPTIONS, deps, port()));
    expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', pttAsserted: true, released: true, playedSeconds: 0, idOwed: false });
    expect(err.remedy).not.toBe(ID_OWED_REMEDY);
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
      const pending = failure(speakUtterance(OPTIONS, fakeSpeechDeps({ now: () => Date.now(), playTo: fakePlayTo({ ms: 60_000 }) }), port(radio)));
      // The 2.6 s WAV plus 0 ms tail plus 5 s gives a 7.6 s watchdog.
      await vi.advanceTimersByTimeAsync(7599);
      expect(radio.ptt).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      const err = await pending;
      expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', retry: 'no', remedy: ID_OWED_REMEDY, pttAsserted: true, released: true, playedSeconds: 7.6, idOwed: true });
      expect(radio.pttLog).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets no identified when the player exits 0 after the watchdog drops PTT and before stop resolves', async () => {
    vi.useFakeTimers();
    try {
      const radio = new FakeRadio();
      const setPtt = radio.setPtt.bind(radio);
      let exit = () => {};
      radio.setPtt = async (on: boolean) => {
        if (!on) exit();
        await setPtt(on);
      };
      const deps = fakeSpeechDeps({ now: () => Date.now() });
      deps.playTo = () => new Promise<void>((resolve) => (exit = resolve));
      const pending = failure(speakUtterance(OPTIONS, deps, port(radio)));
      // The 2.6 s WAV plus 0 ms tail plus 5 s gives a 7.6 s watchdog.
      await vi.advanceTimersByTimeAsync(7600);
      const err = await pending;
      expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', remedy: ID_OWED_REMEDY, released: true, idOwed: true });
      expect(radio.pttLog).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets no identified when the player exits 0 after a signal and before it settles', async () => {
    const radio = new FakeRadio();
    const deps = fakeSpeechDeps();
    deps.playTo = async () => {
      deps.signals.emit('SIGINT');
    };
    const result = await speakUtterance(OPTIONS, deps, port(radio));
    expect(result).toMatchObject({ interrupted: 'SIGINT', identified: false, pttAsserted: true, released: true });
    expect(radio.pttLog).toEqual([true, false]);
  });

  it('attaches the result fields to a failed release after a signal mid-play', async () => {
    const radio = new FakeRadio();
    radio.setPtt = async (on: boolean) => {
      radio.pttLog.push(on);
      if (!on) throw new Error('release failed');
      radio.ptt = on;
    };
    const clock = fakeClock();
    const deps = fakeSpeechDeps({ now: clock.now });
    deps.playTo = fakePlayTo({
      ms: 5000,
      clock,
      onStart: () => {
        clock.advance(1000);
        setTimeout(() => deps.signals.emit('SIGINT'), 30);
      },
    });
    const err = await failure(speakUtterance(OPTIONS, deps, port(radio)));
    expect(err.toJSON()).toMatchObject({
      reason: 'ptt-control-failed',
      interrupted: 'SIGINT',
      remedy: 'ask the human to unplug the AIOC to drop PTT',
      retry: 'no',
      pttAsserted: true,
      released: false,
      idOwed: true,
    });
    expect(err.detail.playedSeconds).toBeGreaterThanOrEqual(1);
  });

  it('returns the interrupted result on a signal during conditioning of a WAV past --max-seconds', async () => {
    const withPort = port();
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'tx.wav');
    const deps = fakeSpeechDeps();
    const condition = deps.condition;
    deps.condition = async (input, output, leadMs) => {
      deps.signals.emit('SIGINT');
      await condition(input, output, leadMs);
    };
    const result = await speakUtterance({ ...OPTIONS, maxSeconds: 1, out }, deps, withPort);
    expect(result).toMatchObject({ interrupted: 'SIGINT', identified: false, idOwed: false, pttAsserted: false, released: true, seconds: 0 });
    expect(result).not.toHaveProperty('out');
    expect(existsSync(out)).toBe(false);
    expect(withPort.opens).toBe(0);
  });

  it('returns the interrupted result when a signal lands in the grace after the watchdog', async () => {
    vi.useFakeTimers();
    try {
      const radio = new FakeRadio();
      const deps = fakeSpeechDeps({ now: () => Date.now() });
      deps.playTo = () => new Promise<void>(() => {});
      const pending = speakUtterance(OPTIONS, deps, port(radio));
      // The 2.6 s WAV plus 0 ms tail plus 5 s gives a 7.6 s watchdog.
      await vi.advanceTimersByTimeAsync(7600);
      expect(radio.ptt).toBe(false);
      deps.signals.emit('SIGINT');
      await vi.advanceTimersByTimeAsync(2000);
      const result = await pending;
      expect(result).toMatchObject({ interrupted: 'SIGINT', identified: false, idOwed: true, pttAsserted: true, released: true });
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
    // The WAV holds 0.3 s of lead, 2 s of tone and 0.3 s of pad as 48 kHz s16.
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
    spawn.mockImplementationOnce(spawnThen((c) => c.fail(Object.assign(new Error('spawn say ENOENT'), { code: 'ENOENT' }))));
    expect((await failure(synthesize('hi', 'Samantha', 'x.wav'))).reason).toBe('dependency-missing');
    spawn.mockImplementationOnce(spawnThen((c) => c.exit(1, { stderr: "Voice `Nope' not found." })));
    const err = await failure(synthesize('hi', 'Nope', 'x.wav'));
    expect(err.toJSON()).toMatchObject({ reason: 'speech-engine-failed', voice: 'Nope', message: expect.stringContaining('not found') });
  });

  it('runs say and the conditioning ffmpeg in their own process groups', async () => {
    spawn.mockImplementation(spawnThen((c) => c.exit(0)));
    await synthesize('hi', 'Samantha', 'x.wav');
    await condition('in.wav', 'out.wav', 300);
    expect(spawn.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['say', expect.objectContaining({ detached: true })],
      ['ffmpeg', expect.objectContaining({ detached: true })],
    ]);
    expect(spawn.mock.calls[1]![1]).toEqual(conditionArgs('in.wav', 'out.wav', 300));
  });

  it('maps a failing conditioning pass to audio-process-failed', async () => {
    spawn.mockImplementationOnce(spawnThen((c) => c.exit(1, { stderr: 'Invalid data found' })));
    const err = await failure(condition('in.wav', 'out.wav', 300));
    expect(err.toJSON()).toMatchObject({ reason: 'audio-process-failed', message: expect.stringContaining('conditioning in.wav: Invalid data found') });
  });

  it('writes a test WAV the fakes can measure', () => {
    expect(wavBytes(1, -6).length).toBe(44 + 96000);
  });
});
