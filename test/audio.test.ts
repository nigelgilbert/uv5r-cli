import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

import { CLIP_WARNING, captureSeconds, ffmpegArgs, listen, parseAstats, play, summarize, wholeSeconds } from '../src/audio.ts';

/** Pre-high-pass astats fields for one frame: sample min and max on the float scale, and the count of samples at either. */
interface Raw {
  min: number;
  max: number;
  peakCount: number;
}

const QUIET: Raw = { min: -0.01, max: 0.01, peakCount: 2 };

/** Build ametadata stderr lines for one frame from both astats instances. */
function frame(i: number, rms: string, peak: string, samples = 48000, raw: Raw = QUIET): string {
  return [
    `[Parsed_ametadata_5 @ 0x1] frame:${i}    pts:${i * 48000}   pts_time:${i}`,
    `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.Min_level=${raw.min.toFixed(6)}`,
    `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.Max_level=${raw.max.toFixed(6)}`,
    `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.Peak_count=${raw.peakCount}.000000`,
    `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.Peak_level=${peak}`,
    `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.RMS_level=${rms}`,
    `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.Number_of_samples=${samples}.000000`,
  ].join('\n');
}

/** Build stderr for whole-second frames with the given RMS levels and a fixed peak. */
function frames(...rms: string[]): string {
  return rms.map((db, i) => frame(i, db, '-10')).join('\n');
}

/** Build stderr whose frames after the first hold `peakCount` samples at full scale on both rails. */
function clipped(seconds: number, peakCount: number): string {
  const rail: Raw = { min: -1, max: 1, peakCount };
  return [frame(0, '-20', '-10'), ...Array.from({ length: seconds }, (_, k) => frame(k + 1, '-6', '0.5', 48000, rail))].join('\n');
}

/** A loud capture-start burst in frame 0, then three seconds of receive audio. */
const STDERR = [frame(0, '-3', '-1'), frame(1, '-48.965978', '-47.141749'), frame(2, '-30', '-20.5'), frame(3, '-inf', '-inf')].join('\n');

/** Make the mocked execFile call back with the given error and stderr. */
function ffmpegReturns(err: Partial<NodeJS.ErrnoException & { killed: boolean; signal: string | null }> | null, stderr: string) {
  execFile.mockImplementation((_file, _args, _opts, cb) => {
    const e = err ? Object.assign(new Error('ffmpeg failed'), err) : null;
    cb(e, '', stderr);
  });
}

describe('ffmpegArgs', () => {
  it('builds a mono 48 kHz avfoundation capture with unpadded one-second frames and a padded duration', () => {
    const args = ffmpegArgs('AIOC Audio', 5);
    expect(args).toContain(':AIOC Audio');
    expect(args[args.indexOf('-t') + 1]).toBe('8');
    expect(args[args.indexOf('-af') + 1]).toMatch(/^aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono,asetnsamples=n=48000:p=0,/);
  });
  it('counts peaks before the high-pass and reads levels after it', () => {
    const chain = ffmpegArgs('AIOC Audio', 5)[ffmpegArgs('AIOC Audio', 5).indexOf('-af') + 1]!;
    expect(chain).toMatch(/astats=[^,]*measure_overall=Min_level\+Max_level\+Peak_count,highpass=f=50,astats=[^,]*measure_overall=Peak_level\+RMS_level\+Number_of_samples,ametadata=print$/);
  });
  it('adds a 48 kHz mono WAV output of the analysed seconds after the null sink', () => {
    const args = ffmpegArgs('AIOC Audio', 3, 'rx.wav');
    const sink = args.indexOf('null');
    expect(args.slice(sink - 1, sink + 2)).toEqual(['-f', 'null', '-']);
    expect(args.slice(0, sink + 2)).toEqual(ffmpegArgs('AIOC Audio', 3));
    expect(args.slice(sink + 2)).toEqual([
      '-t',
      '6',
      '-af',
      'aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=mono,asetpts=N/SR/TB,atrim=start_sample=48000:end_sample=192000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      '-y',
      'rx.wav',
    ]);
  });
});

describe('captureSeconds', () => {
  it('pads the request by the measured ratio plus two seconds', () => {
    expect(captureSeconds(1)).toBe(4);
    expect(captureSeconds(3)).toBe(6);
    expect(captureSeconds(5)).toBe(8);
    expect(captureSeconds(20)).toBe(25);
    expect(captureSeconds(600)).toBe(684);
  });
});

describe('parseAstats and summarize', () => {
  it('parses per-second levels and summarizes every field without the first second', () => {
    const levels = parseAstats(STDERR);
    expect(levels.rms).toEqual([-3, -48.965978, -30, -Infinity]);
    expect(levels.samples).toEqual([48000, 48000, 48000, 48000]);
    const r = summarize('AIOC Audio', 3, levels);
    expect(r).toMatchObject({ device: 'AIOC Audio', seconds: 3, rmsDbfs: [-48.97, -30, null], zeroSeconds: 1, peakDbfs: -20.5, active: [true, true, false] });
    expect(r.meanRmsDbfs).toBeCloseTo(-34.72, 1);
  });
  it('trims every series to the requested seconds after the first', () => {
    const levels = parseAstats([frame(0, '-1', '-0.2'), frame(1, '-40', '-35'), frame(2, '-30', '-25'), frame(3, '-3', '-0.5')].join('\n'));
    const r = summarize('AIOC Audio', 2, levels);
    expect(r.rmsDbfs).toEqual([-40, -30]);
    expect(r.peakDbfs).toBe(-25);
    expect(r.active).toEqual([true, true]);
  });
  it('reports null levels when every second is digital zero', () => {
    const zero: Raw = { min: 0, max: 0, peakCount: 96000 };
    const r = summarize('AIOC Audio', 2, parseAstats([0, 1, 2].map((i) => frame(i, '-inf', '-inf', 48000, zero)).join('\n')));
    expect(r).toEqual({
      device: 'AIOC Audio',
      seconds: 2,
      rmsDbfs: [null, null],
      zeroSeconds: 2,
      meanRmsDbfs: null,
      peakDbfs: null,
      active: [false, false],
      activeSeconds: 0,
      warnings: [],
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
  it('parses the pre-high-pass min, max and peak count', () => {
    const levels = parseAstats(frame(0, '-6', '0.5', 48000, { min: -1, max: 1, peakCount: 900 }));
    expect(levels).toMatchObject({ min: [-1], max: [1], peakCount: [900] });
  });
  it('counts leading whole-second frames', () => {
    expect(wholeSeconds(parseAstats([frame(0, '-40', '-35'), frame(1, '-40', '-35', 24000)].join('\n')))).toBe(1);
    expect(wholeSeconds(parseAstats('lavfi.astats.Overall.RMS_level=-40'))).toBe(1);
    expect(wholeSeconds(parseAstats(''))).toBe(0);
  });
});

describe('summarize activity', () => {
  it('marks seconds above the default -50 dBFS floor and skips the first second', () => {
    const r = summarize('AIOC Audio', 4, parseAstats(frames('-20', '-45', '-55', '-inf', '-30')));
    expect(r.active).toEqual([true, false, false, true]);
    expect(r.activeSeconds).toBe(2);
    expect(r.rmsDbfs).toEqual([-45, -55, null, -30]);
  });
  it('moves the threshold with an override floor', () => {
    const r = summarize('AIOC Audio', 4, parseAstats(frames('-20', '-45', '-55', '-inf', '-30')), -40);
    expect(r.active).toEqual([false, false, false, true]);
    expect(r.activeSeconds).toBe(1);
  });
  it('reports no activity when only the first second is loud', () => {
    const r = summarize('AIOC Audio', 5, parseAstats(frames('-3', '-66', '-66', '-66', '-66', '-66')));
    expect(r.active).toEqual([false, false, false, false, false]);
    expect(r.activeSeconds).toBe(0);
  });
});

describe('summarize clipping', () => {
  it('warns when more than 1 percent of samples sit at full scale', () => {
    // 1000 of 48000 samples per second is 2.1 percent.
    expect(summarize('AIOC Audio', 3, parseAstats(clipped(3, 1000))).warnings).toEqual([CLIP_WARNING]);
  });
  it('stays quiet when fewer than 1 percent of samples sit at full scale', () => {
    // 400 of 48000 samples per second is 0.83 percent.
    expect(summarize('AIOC Audio', 3, parseAstats(clipped(3, 400))).warnings).toEqual([]);
  });
  it('ignores a peak count when the frame never reaches full scale', () => {
    const loud: Raw = { min: -0.9, max: 0.9, peakCount: 20000 };
    const stderr = [0, 1, 2].map((i) => frame(i, '-10', '-1', 48000, loud)).join('\n');
    expect(summarize('AIOC Audio', 2, parseAstats(stderr)).warnings).toEqual([]);
  });
  it('ignores clipping in the first second', () => {
    const burst = frame(0, '-1', '0.5', 48000, { min: -1, max: 1, peakCount: 20000 });
    expect(summarize('AIOC Audio', 2, parseAstats([burst, frame(1, '-40', '-30'), frame(2, '-40', '-30')].join('\n'))).warnings).toEqual([]);
  });
});

describe('listen', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  it('reports a missing ffmpeg', async () => {
    ffmpegReturns({ code: 'ENOENT' }, '');
    await expect(listen('AIOC Audio', 2)).rejects.toMatchObject({ kind: 'transport', reason: 'dependency-missing', message: expect.stringMatching(/ffmpeg not found on PATH/) });
  });
  it('rejects a killed run even when astats output already arrived', async () => {
    const stderr = [STDERR, 'Input #0, avfoundation, from \':AIOC Audio\':', 'Exiting normally, received signal 15.'].join('\n');
    ffmpegReturns({ killed: true, signal: 'SIGTERM', code: undefined }, stderr);
    const err = await listen('AIOC Audio', 3).catch((e) => e);
    expect(err).toMatchObject({ kind: 'transport', reason: 'audio-process-failed', detail: { signal: 'SIGTERM' } });
    expect(err.message).toMatch(/^ffmpeg timed out after 21s capturing from "AIOC Audio": /);
    expect(err.message).toContain('Number_of_samples=48000.000000 | Input #0, avfoundation');
    expect(err.message).toMatch(/received signal 15\.$/);
  });
  it('rejects a non-zero exit with the stderr tail', async () => {
    ffmpegReturns({ code: 1 as unknown as string }, `${frame(0, '-40', '-35')}\n[AVFoundation indev @ 0x2] Error opening input\n:AIOC Audio: Input/output error`);
    await expect(listen('AIOC Audio', 1)).rejects.toThrow(/^ffmpeg exited with code 1 capturing from "AIOC Audio": .*Error opening input \| :AIOC Audio: Input\/output error$/);
  });
  it('rejects a clean exit with fewer whole seconds than requested plus the dropped first second', async () => {
    ffmpegReturns(null, [frame(0, '-40', '-35'), frame(1, '-40', '-35'), frame(2, '-40', '-35'), frame(3, '-40', '-35', 12000)].join('\n'));
    const err = await listen('AIOC Audio', 3).catch((e) => e);
    expect(err).toMatchObject({ kind: 'transport', reason: 'capture-incomplete', retry: 'once', detail: { captured: 3, requested: 4 } });
    expect(err.message).toMatch(/^ffmpeg captured 3 of 4 seconds from "AIOC Audio": /);
  });
  it('rejects an empty capture with the stderr tail', async () => {
    ffmpegReturns(null, 'Stream mapping:\n  Stream #0:0 -> #0:0 (pcm_f32le (native) -> pcm_s16le (native))\nPress [q] to stop');
    await expect(listen('AIOC Audio', 2)).rejects.toThrow(/^ffmpeg captured 0 of 3 seconds from "AIOC Audio": Stream mapping: \| .* \| Press \[q\] to stop$/);
  });
  it('summarizes a successful run and drops the frames past the window', async () => {
    ffmpegReturns(null, [STDERR, frame(4, '-1', '-0.1')].join('\n'));
    const r = await listen('AIOC Audio', 3);
    expect(r).toMatchObject({ rmsDbfs: [-48.97, -30, null], zeroSeconds: 1, peakDbfs: -20.5, active: [true, true, false], activeSeconds: 2, warnings: [] });
    const [file, args, opts] = execFile.mock.calls[0]!;
    expect(file).toBe('ffmpeg');
    expect(args).toEqual(ffmpegArgs('AIOC Audio', 3));
    expect(opts).toMatchObject({ timeout: 21000 });
  });
  it('accepts exactly the requested whole seconds plus one and drops a trailing partial frame', async () => {
    ffmpegReturns(null, [frame(0, '-40', '-35'), frame(1, '-30', '-25'), frame(2, '-45', '-40'), frame(3, '-3', '-0.5', 20000)].join('\n'));
    const r = await listen('AIOC Audio', 2);
    expect(r).toMatchObject({ seconds: 2, rmsDbfs: [-30, -45], zeroSeconds: 0, peakDbfs: -25, active: [true, true], activeSeconds: 2 });
  });
  it('passes the floor through to the summary', async () => {
    ffmpegReturns(null, [frame(0, '-40', '-35'), frame(1, '-45', '-40'), frame(2, '-35', '-30')].join('\n'));
    const r = await listen('AIOC Audio', 2, -40);
    expect(r).toMatchObject({ active: [false, true], activeSeconds: 1 });
  });
});

describe('listen with out and play', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  it('writes the WAV and reports out without playing it', async () => {
    ffmpegReturns(null, STDERR);
    const r = await listen('AIOC Audio', 3, -50, { out: 'rx.wav' });
    expect(r.out).toBe('rx.wav');
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0]![1]).toEqual(ffmpegArgs('AIOC Audio', 3, 'rx.wav'));
  });
  it('leaves out off the result without an out path', async () => {
    ffmpegReturns(null, STDERR);
    expect(await listen('AIOC Audio', 3)).not.toHaveProperty('out');
  });
  it('spawns afplay with the path after ffmpeg resolves and not before', async () => {
    let finish = () => {};
    execFile.mockImplementation((file, _args, _opts, cb) => {
      if (file === 'ffmpeg') finish = () => cb(null, '', STDERR);
      else cb(null, '', '');
    });
    const done = listen('AIOC Audio', 3, -50, { out: 'rx.wav', play: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(execFile.mock.calls.map((c) => c[0])).toEqual(['ffmpeg']);
    finish();
    const r = await done;
    expect(execFile.mock.calls.map((c) => c[0])).toEqual(['ffmpeg', 'afplay']);
    expect(execFile.mock.calls[1]![1]).toEqual(['rx.wav']);
    expect(r.out).toBe('rx.wav');
  });
  it('does not play when the capture fails', async () => {
    ffmpegReturns({ code: 1 as unknown as string }, 'Error opening input');
    await expect(listen('AIOC Audio', 3, -50, { out: 'rx.wav', play: true })).rejects.toMatchObject({ kind: 'transport' });
    expect(execFile.mock.calls.map((c) => c[0])).toEqual(['ffmpeg']);
  });
  it('rejects play without out before running ffmpeg', async () => {
    await expect(listen('AIOC Audio', 3, -50, { play: true })).rejects.toMatchObject({ kind: 'usage' });
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('play', () => {
  beforeEach(() => {
    execFile.mockReset();
  });

  it('reports a missing afplay as a transport error naming the file', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(Object.assign(new Error('spawn afplay ENOENT'), { code: 'ENOENT' }), '', ''));
    await expect(play('rx.wav', 3)).rejects.toMatchObject({
      kind: 'transport',
      reason: 'dependency-missing',
      message: 'afplay not found on PATH; cannot play rx.wav',
      detail: { file: 'rx.wav' },
      remedy: 'the capture is saved at file; ask the human to play it; do not capture again',
      retry: 'no',
    });
  });
  it('reports a non-zero afplay exit as a transport error naming the file', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(Object.assign(new Error('afplay failed'), { code: 1 }), '', "Error: AudioFileOpen failed ('dta?')\n"));
    await expect(play('rx.wav', 3)).rejects.toMatchObject({
      kind: 'transport',
      reason: 'audio-process-failed',
      message: "afplay exited with code 1 playing rx.wav: Error: AudioFileOpen failed ('dta?')",
      detail: { file: 'rx.wav', code: 1 },
      remedy: 'the capture is saved at file; ask the human to play it; do not capture again',
      retry: 'no',
    });
  });
  it('passes the file to afplay with a timeout past its length', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(null, '', ''));
    await play('rx.wav', 3);
    expect(execFile.mock.calls[0]!.slice(0, 3)).toEqual(['afplay', ['rx.wav'], { timeout: 18000 }]);
  });
});
