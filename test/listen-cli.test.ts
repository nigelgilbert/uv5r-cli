import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

import { cli } from '../src/main.ts';

/** Build astats stderr for `n` whole-second frames at -30 dBFS. */
function stderrFrames(n: number): string {
  return Array.from({ length: n }, () =>
    [
      'lavfi.astats.Overall.Min_level=-0.010000',
      'lavfi.astats.Overall.Max_level=0.010000',
      'lavfi.astats.Overall.Peak_count=2.000000',
      'lavfi.astats.Overall.Peak_level=-20',
      'lavfi.astats.Overall.RMS_level=-30',
      'lavfi.astats.Overall.Number_of_samples=48000.000000',
    ].join('\n'),
  ).join('\n');
}

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  execFile.mockReset();
  execFile.mockImplementation((_file, _args, _opts, cb) => cb(null, '', stderrFrames(4)));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => stdout.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => stderr.push(String(chunk)) > 0);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const outJson = () => JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
const errJson = () => JSON.parse(stderr.join('').trim()) as Record<string, unknown>;

describe('listen --out and --play', () => {
  it('exits 2 naming --out when --play comes without it, before running ffmpeg', async () => {
    await cli(['listen', '--seconds', '3', '--play', '--json']);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining('--out') });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('carries out in the JSON result and passes the path to ffmpeg', async () => {
    await cli(['listen', '--seconds', '3', '--out', 'rx.wav', '--json']);
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ seconds: 3, activeSeconds: 3, out: 'rx.wav' });
    expect(execFile.mock.calls.map((c) => c[0])).toEqual(['ffmpeg']);
    expect(execFile.mock.calls[0]![1]).toContain('rx.wav');
  });

  it('plays the file through afplay after the capture with --play', async () => {
    await cli(['listen', '--seconds', '3', '--out', 'rx.wav', '--play', '--json']);
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ out: 'rx.wav' });
    expect(execFile.mock.calls.map((c) => [c[0], c[0] === 'afplay' ? c[1] : undefined])).toEqual([
      ['ffmpeg', undefined],
      ['afplay', ['rx.wav']],
    ]);
  });

  it('accepts --floor at both ends of -100..0', async () => {
    for (const floor of ['-100', '0']) {
      stdout = [];
      await cli(['listen', '--seconds', '3', '--floor', floor, '--json']);
      expect(process.exitCode).toBe(0);
      expect(outJson()).toMatchObject({ seconds: 3 });
    }
  });

  it('leaves out off the JSON result without --out', async () => {
    await cli(['listen', '--seconds', '3', '--json']);
    expect(outJson()).not.toHaveProperty('out');
  });

  it('exits 2 on --out - before running ffmpeg', async () => {
    await cli(['listen', '--seconds', '3', '--out', '-', '--json']);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', flag: 'out', message: expect.stringContaining('--out takes a file path') });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('exits 3 with retry no and a remedy that keeps the capture when afplay fails', async () => {
    execFile.mockImplementation((file, _args, _opts, cb) =>
      file === 'afplay' ? cb(Object.assign(new Error('afplay failed'), { code: 1 }), '', '') : cb(null, '', stderrFrames(4)),
    );
    await cli(['listen', '--seconds', '3', '--out', 'rx.wav', '--play', '--json']);
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({
      reason: 'audio-process-failed',
      file: 'rx.wav',
      remedy: 'the capture is saved at file; ask the human to play it; do not capture again',
      retry: 'no',
    });
    expect(stdout).toEqual([]);
  });

  it('names --out and --play in help listen', async () => {
    const tty = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      await cli(['help', 'listen']);
    } finally {
      process.stdout.isTTY = tty;
    }
    const help = stdout.join('');
    expect(help).toMatch(/--out FILE +write the capture as a 48 kHz mono WAV and report out; overwrites FILE/);
    expect(help).toMatch(/--play +play .*needs --out/);
  });
});
