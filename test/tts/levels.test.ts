import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

import { measureArgs, measureWav, parseWavLevels } from '../../src/speech/levels.ts';
import { spawnThen } from './fakes.ts';

const ENOENT = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });

/** ametadata lines for one frame of a reset=0 astats run, as ffmpeg prints them. */
function frame(i: number, peak: string, rms: string, samples: number): string {
  return [
    `[Parsed_ametadata_2 @ 0x1] frame:${i}    pts:${i * 4096}   pts_time:${(i * 4096) / 48000}`,
    `[Parsed_ametadata_2 @ 0x1] lavfi.astats.Overall.Peak_level=${peak}`,
    `[Parsed_ametadata_2 @ 0x1] lavfi.astats.Overall.RMS_level=${rms}`,
    `[Parsed_ametadata_2 @ 0x1] lavfi.astats.Overall.Number_of_samples=${samples}.000000`,
  ].join('\n');
}

beforeEach(() => {
  spawn.mockReset();
});

describe('measureArgs', () => {
  it('runs one accumulating astats over the whole file with no frame cut', () => {
    const args = measureArgs('tx.wav');
    const chain = args[args.indexOf('-af') + 1]!;
    expect(args.slice(0, 4)).toEqual(['-hide_banner', '-nostdin', '-i', 'tx.wav']);
    expect(chain).toBe(
      'aformat=sample_fmts=flt:sample_rates=48000:channel_layouts=mono,astats=metadata=1:reset=0:measure_perchannel=none:measure_overall=Peak_level+RMS_level+Number_of_samples,ametadata=print',
    );
    expect(chain).not.toContain('asetnsamples');
  });
});

describe('parseWavLevels', () => {
  it('reads the last frame, which covers the whole file', () => {
    const stderr = [frame(0, '-12.5', '-30.1', 4096), frame(1, '-1.2', '-18.4', 8192), frame(2, '-0.9', '-17.6', 124800)].join('\n');
    expect(parseWavLevels(stderr)).toEqual({ seconds: 2.6, peakDbfs: -0.9, rmsDbfs: -17.6 });
  });

  it('reads digital zero as -Infinity', () => {
    expect(parseWavLevels(frame(0, '-inf', '-inf', 48000))).toEqual({ seconds: 1, peakDbfs: -Infinity, rmsDbfs: -Infinity });
  });

  it('reads an empty run as zero seconds of digital zero', () => {
    expect(parseWavLevels('')).toEqual({ seconds: 0, peakDbfs: -Infinity, rmsDbfs: -Infinity });
  });
});

describe('measureWav', () => {
  it('passes measureArgs to a detached ffmpeg and parses its stderr', async () => {
    spawn.mockImplementation(spawnThen((c) => c.exit(0, { stderr: frame(0, '-3', '-20', 96000) })));
    await expect(measureWav('tx.wav')).resolves.toEqual({ seconds: 2, peakDbfs: -3, rmsDbfs: -20 });
    expect(spawn.mock.calls[0]![0]).toBe('ffmpeg');
    expect(spawn.mock.calls[0]![1]).toEqual(measureArgs('tx.wav'));
    expect(spawn.mock.calls[0]![2]).toMatchObject({ detached: true });
  });

  it('maps a missing ffmpeg to dependency-missing and a failure to audio-process-failed naming the file', async () => {
    spawn.mockImplementationOnce(spawnThen((c) => c.fail(ENOENT)));
    await expect(measureWav('tx.wav')).rejects.toMatchObject({ reason: 'dependency-missing' });
    spawn.mockImplementationOnce(spawnThen((c) => c.exit(1, { stderr: 'tx.wav: Invalid data found when processing input' })));
    await expect(measureWav('tx.wav')).rejects.toMatchObject({ reason: 'audio-process-failed', message: expect.stringContaining('measuring tx.wav: tx.wav: Invalid data') });
  });
});
