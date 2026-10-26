import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { TransportError } from '../../src/core/index.ts';
import { isNoise, nextSeq, normalizeText, QUEUE_LIMIT, runHear, segmentFileName, type HearLine, type HearOptions } from '../../src/speech/hear.ts';
import { FakeMonitor, fakeClock, fakeTranscribe, silentFrames, toneFrames } from './fakes.ts';

const TMP = mkdtempSync(join(tmpdir(), 'uv5r-hear-test-'));

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const BASE = Date.parse('2026-10-25T14:00:00.000Z');
/** A 1 s transmission, then enough quiet to close it after the 0.8 s hang. */
const TX = [...toneFrames(50), ...silentFrames(45)];
/** A 0.4 s opening, under the 0.5 s kerchunk limit. */
const KERCHUNK = [...toneFrames(20), ...silentFrames(45)];

/** Let pending promise callbacks run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function start(opts: Partial<HearOptions> = {}, transcribe = fakeTranscribe()) {
  const clock = fakeClock(BASE);
  const monitor = new FakeMonitor(clock);
  const signals = new EventEmitter();
  const lines: HearLine[] = [];
  const done = runHear(monitor, transcribe, clock.now, (line) => lines.push(line), signals, {
    device: 'AIOC Audio',
    floorDbfs: -50,
    hangSeconds: 0.8,
    once: false,
    timeoutSeconds: 60,
    model: 'ggml-base.en-q5_1',
    ...opts,
  });
  const of = (type: HearLine['type']) => lines.filter((l) => l.type === type);
  return { clock, monitor, signals, lines, done, transcribe, of };
}

describe('noise filter', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeText('  Thank   you! ')).toBe('thank you');
    expect(normalizeText('Bench, this is KJ7ABC.')).toBe('bench this is kj7abc');
  });

  it('flags empty text and the phrase list', () => {
    for (const text of ['', ' . ', 'Thank you.', 'You', 'Bye!']) expect(isNoise(text), text).toBe(true);
    for (const text of ['thank you bench', 'over']) expect(isNoise(text), text).toBe(false);
  });
});

describe('segment files', () => {
  it('names a segment by its six-digit seq', () => {
    expect(segmentFileName(42)).toBe('seg-000042.wav');
  });

  it('continues past the highest seg number in a directory', () => {
    const dir = mkdtempSync(join(TMP, 'seq-'));
    expect(nextSeq(dir)).toBe(1);
    for (const name of ['seg-000007.wav', 'seg-000041.wav', 'notes.txt', 'seg-12.wav']) writeFileSync(join(dir, name), '');
    expect(nextSeq(dir)).toBe(42);
  });
});

describe('runHear', () => {
  it('prints a transmission line with the wall-clock start, then the summary on a signal', async () => {
    const h = start();
    await h.monitor.feed(silentFrames(100), TX);
    await flush();
    h.signals.emit('SIGINT');
    const summary = await h.done;
    const [line] = h.of('transmission');
    expect(Object.keys(line!)).toEqual(['type', 'seq', 'start', 'seconds', 'rmsDbfs', 'peakDbfs', 'text', 'engine', 'model', 'inferMs', 'wav']);
    // The opening run starts at frame 100; the segment starts 15 pre-roll frames earlier, at 85.
    expect(line).toMatchObject({ seq: 1, start: '2026-10-25T14:00:01.720Z', text: 'bench this is kilo juliett seven status over', engine: 'whisper.cpp', model: 'ggml-base.en-q5_1', inferMs: 640, wav: null });
    expect(summary).toEqual({ type: 'summary', transmissions: 1, seconds: 3.9, device: 'AIOC Audio', warnings: 0, interrupted: 'SIGINT' });
    expect(h.lines.at(-1)).toEqual(summary);
  });

  it('prints phrase-list and empty transcripts as noise warnings and a short segment as a kerchunk', async () => {
    const h = start({}, fakeTranscribe(['Thank you.', '', 'bench check over']));
    await h.monitor.feed(KERCHUNK, TX, TX, TX);
    await flush();
    h.signals.emit('SIGTERM');
    const summary = await h.done;
    expect(h.transcribe.calls).toHaveLength(3);
    expect(h.of('warning')).toEqual([
      { type: 'warning', warning: 'kerchunk', start: expect.any(String), seconds: expect.any(Number), text: null, wav: null },
      { type: 'warning', warning: 'noise', start: expect.any(String), seconds: expect.any(Number), text: 'Thank you.', wav: null },
      { type: 'warning', warning: 'noise', start: expect.any(String), seconds: expect.any(Number), text: '', wav: null },
    ]);
    expect(h.of('transmission')).toMatchObject([{ seq: 4, text: 'bench check over' }]);
    expect(summary).toMatchObject({ transmissions: 1, warnings: 3, interrupted: 'SIGTERM' });
  });

  it('drops the oldest waiting segment as backlog when a ninth waits', async () => {
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = start({}, transcribe);
    await h.monitor.feed(TX);
    expect(transcribe.calls).toHaveLength(1);
    await h.monitor.feed(...Array.from({ length: QUEUE_LIMIT }, () => TX));
    expect(h.of('warning')).toEqual([]);
    await h.monitor.feed(TX);
    const backlog = h.of('warning');
    expect(backlog).toMatchObject([{ warning: 'backlog', text: null, wav: null }]);
    transcribe.pending[0]!.resolve();
    await flush();
    expect(transcribe.calls).toHaveLength(2);
    // Segment 2 was dropped, so the second call transcribes segment 3.
    expect(transcribe.calls[1]!.wav).toMatch(/seg-000003\.wav$/);
    // The signal prints the seven segments still waiting as backlog.
    h.signals.emit('SIGINT');
    transcribe.pending[1]!.resolve();
    expect(await h.done).toMatchObject({ transmissions: 2, warnings: QUEUE_LIMIT });
  });

  it('closes the open segment on a signal, prints the queue as backlog with kept WAVs and finishes the segment in inference', async () => {
    const outDir = mkdtempSync(join(TMP, 'rx-'));
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = start({ outDir }, transcribe);
    await h.monitor.feed(TX, TX, TX, toneFrames(30));
    expect(transcribe.calls).toHaveLength(1);
    h.signals.emit('SIGHUP');
    h.signals.emit('SIGINT');
    await flush();
    expect(h.of('summary')).toEqual([]);
    const backlog = [2, 3, 4].map((seq) => join(outDir, segmentFileName(seq)));
    expect(h.of('warning')).toEqual(backlog.map((wav) => ({ type: 'warning', warning: 'backlog', start: expect.any(String), seconds: expect.any(Number), text: null, wav })));
    for (const wav of backlog) expect(existsSync(wav), wav).toBe(true);
    transcribe.pending[0]!.resolve();
    const summary = await h.done;
    expect(transcribe.calls).toHaveLength(1);
    expect(h.of('transmission')).toMatchObject([{ seq: 1, wav: join(outDir, 'seg-000001.wav') }]);
    expect(summary).toMatchObject({ transmissions: 1, warnings: 3, interrupted: 'SIGHUP' });
    expect(h.lines.at(-1)).toEqual(summary);
    expect(h.monitor.stops).toBeGreaterThan(0);
    expect(h.signals.listenerCount('SIGINT')).toBe(0);
  });

  it('throws a transcription failure after a signal and keeps the lines already printed', async () => {
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = start({}, transcribe);
    await h.monitor.feed(TX);
    transcribe.pending[0]!.resolve();
    await flush();
    await h.monitor.feed(TX, TX);
    h.signals.emit('SIGINT');
    transcribe.pending[1]!.reject(new TransportError('speech-engine-failed', 'whisper-cli exited with code 1'));
    await expect(h.done).rejects.toMatchObject({ reason: 'speech-engine-failed' });
    expect(h.lines.map((l) => (l.type === 'warning' ? l.warning : l.type))).toEqual(['transmission', 'backlog']);
  });

  it('deletes segment WAVs without --out-dir', async () => {
    const h = start();
    await h.monitor.feed(TX);
    await flush();
    h.signals.emit('SIGINT');
    await h.done;
    const [call] = h.transcribe.calls;
    expect(call!.existed).toBe(true);
    expect(existsSync(call!.wav)).toBe(false);
  });

  it('keeps one 16 kHz WAV per segment in --out-dir and reports its path', async () => {
    const outDir = mkdtempSync(join(TMP, 'rx-'));
    const h = start({ outDir, firstSeq: 42 });
    await h.monitor.feed(KERCHUNK, TX);
    await flush();
    h.signals.emit('SIGINT');
    await h.done;
    expect(h.of('warning')).toMatchObject([{ warning: 'kerchunk', wav: join(outDir, 'seg-000042.wav') }]);
    expect(h.of('transmission')).toMatchObject([{ seq: 43, wav: join(outDir, 'seg-000043.wav') }]);
    const wav = readFileSync(join(outDir, 'seg-000043.wav'));
    expect(wav.readUInt32LE(24)).toBe(16000);
  });

  it('stops capture, waits for the segment in inference and throws on a capture failure', async () => {
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = start({}, transcribe);
    await h.monitor.feed(TX);
    h.monitor.fail(new TransportError('audio-process-failed', 'ffmpeg exited with code 1'));
    await flush();
    transcribe.pending[0]!.resolve();
    await expect(h.done).rejects.toMatchObject({ reason: 'audio-process-failed' });
    expect(h.of('transmission')).toHaveLength(1);
    expect(h.of('summary')).toEqual([]);
  });

  it('keeps the lines already printed and throws a transcription failure', async () => {
    const transcribe = fakeTranscribe(undefined, { manual: true });
    const h = start({}, transcribe);
    await h.monitor.feed(TX, TX);
    transcribe.pending[0]!.resolve();
    await flush();
    transcribe.pending[1]!.reject(new TransportError('speech-engine-failed', 'whisper-cli exited with code 1'));
    await expect(h.done).rejects.toMatchObject({ reason: 'speech-engine-failed' });
    expect(h.of('transmission')).toHaveLength(1);
    expect(h.monitor.stops).toBeGreaterThan(0);
  });
});

describe('runHear --once', () => {
  it('keeps going past a kerchunk and a noise segment and exits after the first transmission', async () => {
    const h = start({ once: true }, fakeTranscribe(['you', 'bench check over', 'later']));
    await h.monitor.feed(KERCHUNK, TX, TX, TX);
    const summary = await h.done;
    expect(h.lines.map((l) => (l.type === 'warning' ? l.warning : l.type))).toEqual(['kerchunk', 'noise', 'transmission', 'summary']);
    expect(h.transcribe.calls).toHaveLength(2);
    expect(summary).toMatchObject({ transmissions: 1, warnings: 2, timedOut: false });
    expect(summary).not.toHaveProperty('interrupted');
  });

  it('transcribes a segment open at the deadline', async () => {
    const h = start({ once: true, timeoutSeconds: 1 });
    // The segment opens at frame 44, before the deadline at frame 50, and closes after it.
    await h.monitor.feed(silentFrames(30), TX, TX);
    const summary = await h.done;
    expect(h.transcribe.calls).toHaveLength(1);
    expect(summary).toMatchObject({ transmissions: 1, timedOut: false });
  });

  it('transcribes the remainder of a segment that splits at 30 s after the deadline', async () => {
    const h = start({ once: true, timeoutSeconds: 1 }, fakeTranscribe(['you', 'bench check over']));
    // The segment opens at frame 44, before the deadline, splits 25 s in and closes about 9 s later.
    await h.monitor.feed(silentFrames(30), toneFrames(1700), silentFrames(45));
    const summary = await h.done;
    expect(h.transcribe.calls).toHaveLength(2);
    expect(h.lines.map((l) => (l.type === 'warning' ? l.warning : l.type))).toEqual(['noise', 'transmission', 'summary']);
    expect(h.of('transmission')).toMatchObject([{ seq: 2 }]);
    expect(summary).toMatchObject({ transmissions: 1, warnings: 1, timedOut: false });
  });

  it('ends at the timeout when capture delivers no frames after ready', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(BASE);
    const monitor = new FakeMonitor();
    const lines: HearLine[] = [];
    const opts: HearOptions = { device: 'AIOC Audio', floorDbfs: -50, hangSeconds: 0.8, once: true, timeoutSeconds: 60, model: 'ggml-base.en-q5_1' };
    const done = runHear(monitor, fakeTranscribe(), Date.now, (line) => lines.push(line), new EventEmitter(), opts);
    let ended = false;
    void done.then(() => (ended = true));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toEqual({ type: 'summary', transmissions: 0, seconds: 60, device: 'AIOC Audio', warnings: 0, timedOut: true });
    expect(monitor.stops).toBeGreaterThan(0);
  });

  it('opens no segment past the deadline and prints timedOut true with nothing heard', async () => {
    const h = start({ once: true, timeoutSeconds: 1 });
    await h.monitor.feed(silentFrames(60), TX);
    const summary = await h.done;
    expect(h.transcribe.calls).toEqual([]);
    expect(h.lines).toEqual([{ type: 'summary', transmissions: 0, seconds: 1, device: 'AIOC Audio', warnings: 0, timedOut: true }]);
    expect(summary.timedOut).toBe(true);
  });

  it('drains the segments waiting at the deadline and times out when each is noise', async () => {
    const h = start({ once: true, timeoutSeconds: 3 }, fakeTranscribe(['', 'bye']));
    await h.monitor.feed(TX, silentFrames(60));
    const summary = await h.done;
    expect(h.of('warning')).toMatchObject([{ warning: 'noise' }]);
    expect(summary).toMatchObject({ transmissions: 0, warnings: 1, timedOut: true });
  });

  it('reports interrupted and timedOut false on a signal before the deadline', async () => {
    const h = start({ once: true });
    await h.monitor.feed(silentFrames(10));
    h.signals.emit('SIGTSTP');
    expect(await h.done).toMatchObject({ transmissions: 0, interrupted: 'SIGTSTP', timedOut: false });
  });
});
