import { describe, expect, it } from 'vitest';
import {
  FRAME_BYTES,
  KERCHUNK_FRAMES,
  MAX_FRAMES,
  OPEN_FRAMES,
  POST_PAD_BYTES,
  POST_PAD_FRAMES,
  PRE_ROLL_FRAMES,
  SPLIT_WINDOW_FRAMES,
  Segmenter,
  frameLevels,
  type Segment,
} from '../../src/speech/segment.ts';

const FLOOR = -50;
const OPEN = FLOOR + 5;
const LOUD = -20;
const QUIET = -70;
const HANG = 0.8;
const HANG_FRAMES = 40;

/** Build one frame of a square wave whose RMS and peak sit at `db` dBFS; -Infinity gives digital zero. */
function tone(db: number): Buffer {
  const a = db === -Infinity ? 0 : Math.min(32767, Math.round(32768 * 10 ** (db / 20)));
  const pcm = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES / 2; i++) pcm.writeInt16LE(i % 2 ? -a : a, i * 2);
  return pcm;
}

/** Repeat `db` for `n` frames. */
const run = (db: number, n: number): number[] => Array(n).fill(db);

/** Push one frame per dBFS value with that RMS and return the segments emitted. */
function feed(seg: Segmenter, dbs: number[]): Segment[] {
  const out: Segment[] = [];
  for (const db of dbs) {
    const s = seg.push(tone(db), db);
    if (s) out.push(s);
  }
  return out;
}

const segmenter = (hangSeconds = HANG) => new Segmenter({ floorDbfs: FLOOR, hangSeconds });

describe('frameLevels', () => {
  it('reads a square wave at its amplitude and digital zero as -Infinity', () => {
    expect(frameLevels(tone(-20)).rmsDbfs).toBeCloseTo(-20, 2);
    expect(frameLevels(tone(-20)).peakDbfs).toBeCloseTo(-20, 2);
    expect(frameLevels(tone(-Infinity))).toEqual({ rmsDbfs: -Infinity, peakDbfs: -Infinity });
  });
});

describe('Segmenter open', () => {
  it('opens on the 15th consecutive frame at floor + 5 dB and not on the 14th', () => {
    const seg = segmenter();
    feed(seg, run(OPEN, OPEN_FRAMES - 1));
    expect(seg.isOpen()).toBe(false);
    feed(seg, [OPEN]);
    expect(seg.isOpen()).toBe(true);
  });

  it('restarts the count after a frame below floor + 5 dB', () => {
    const seg = segmenter();
    feed(seg, [...run(OPEN, 14), OPEN - 0.01, ...run(OPEN, 14)]);
    expect(seg.isOpen()).toBe(false);
  });

  it('stays idle on frames between the floor and floor + 5 dB', () => {
    const seg = segmenter();
    expect(feed(seg, [...run(FLOOR, 100), ...run(OPEN - 0.01, 100), ...run(-47, 100)])).toEqual([]);
    expect(seg.isOpen()).toBe(false);
  });

  it('measures RMS from the PCM when the caller passes none', () => {
    const seg = segmenter();
    for (let i = 0; i < OPEN_FRAMES; i++) seg.push(tone(LOUD));
    expect(seg.isOpen()).toBe(true);
  });
});

describe('Segmenter pre-roll', () => {
  it('starts the segment 300 ms before the opening run', () => {
    const seg = segmenter();
    const [s] = feed(seg, [...run(QUIET, 40), ...run(LOUD, 45), ...run(QUIET, HANG_FRAMES)]);
    expect(s!.startFrame).toBe(40 - PRE_ROLL_FRAMES);
    expect(s!.pcm.subarray(0, PRE_ROLL_FRAMES * FRAME_BYTES)).toEqual(Buffer.concat(run(QUIET, PRE_ROLL_FRAMES).map(tone)));
    expect(s!.pcm.subarray(PRE_ROLL_FRAMES * FRAME_BYTES, (PRE_ROLL_FRAMES + 1) * FRAME_BYTES)).toEqual(tone(LOUD));
  });

  it('takes the frames it has when fewer than 300 ms precede the run', () => {
    const [s] = feed(segmenter(), [...run(QUIET, 5), ...run(LOUD, 45), ...run(QUIET, HANG_FRAMES)]);
    expect(s!.startFrame).toBe(0);
    expect(s!.frameCount).toBe(5 + 45 + POST_PAD_FRAMES);
  });
});

describe('Segmenter close', () => {
  it('closes once the frames stay below the floor for the hang', () => {
    const seg = segmenter();
    expect(feed(seg, [...run(LOUD, 45), ...run(QUIET, HANG_FRAMES - 1)])).toEqual([]);
    expect(seg.isOpen()).toBe(true);
    expect(feed(seg, [QUIET])).toHaveLength(1);
    expect(seg.isOpen()).toBe(false);
  });

  it('keeps the segment open on a frame at the floor during the hang', () => {
    const seg = segmenter();
    expect(feed(seg, [...run(LOUD, 45), ...run(QUIET, 30), FLOOR, ...run(QUIET, HANG_FRAMES - 1)])).toEqual([]);
    expect(seg.isOpen()).toBe(true);
    const [s] = feed(seg, [QUIET]);
    expect(s!.frameCount).toBe(45 + 31 + POST_PAD_FRAMES);
  });

  it('pads 150 ms past the last frame at or above the floor', () => {
    const [s] = feed(segmenter(), [...run(LOUD, 45), ...run(QUIET, HANG_FRAMES)]);
    expect(s!.pcm.length).toBe(45 * FRAME_BYTES + POST_PAD_BYTES);
    expect(s!.seconds).toBeCloseTo(0.9 + 0.15, 9);
    expect(s!.frameCount).toBe(45 + POST_PAD_FRAMES);
    expect(s!.pcm.subarray(45 * FRAME_BYTES)).toEqual(Buffer.concat(run(QUIET, POST_PAD_FRAMES).map(tone)).subarray(0, POST_PAD_BYTES));
  });

  it('waits for the post-pad when the hang is shorter', () => {
    const seg = segmenter(0.1);
    expect(feed(seg, [...run(LOUD, 45), ...run(QUIET, POST_PAD_FRAMES - 1)])).toEqual([]);
    const [s] = feed(seg, [QUIET]);
    expect(s!.pcm.length).toBe(45 * FRAME_BYTES + POST_PAD_BYTES);
  });

  it('reports RMS and peak over the whole segment', () => {
    const [s] = feed(segmenter(), [...run(LOUD, 30), ...run(-Infinity, HANG_FRAMES)]);
    expect(s!.peakDbfs).toBeCloseTo(LOUD, 2);
    expect(s!.rmsDbfs).toBeCloseTo(LOUD + 10 * Math.log10((30 * FRAME_BYTES) / (30 * FRAME_BYTES + POST_PAD_BYTES)), 2);
  });

  it('opens a second segment after the first closes, with the hang frames as its pre-roll', () => {
    const segs = feed(segmenter(), [...run(LOUD, 30), ...run(QUIET, HANG_FRAMES), ...run(LOUD, 30), ...run(QUIET, HANG_FRAMES)]);
    expect(segs.map((s) => s.startFrame)).toEqual([0, 30 + HANG_FRAMES - PRE_ROLL_FRAMES]);
  });
});

describe('Segmenter kerchunk', () => {
  const kerchunk = (loud: number) => feed(segmenter(), [...run(QUIET, 20), ...run(LOUD, loud), ...run(QUIET, HANG_FRAMES)])[0]!.kerchunk;

  it('flags a segment with under 0.5 s of active frames', () => {
    expect(kerchunk(OPEN_FRAMES)).toBe(true);
    expect(kerchunk(KERCHUNK_FRAMES - 1)).toBe(true);
    expect(kerchunk(KERCHUNK_FRAMES)).toBe(false);
  });
});

describe('Segmenter split', () => {
  it('splits a 30 s segment at the quietest frame in the last 5 s', () => {
    const seg = segmenter();
    const levels = run(LOUD, MAX_FRAMES);
    levels[1000] = -49; // quieter, but before the window
    levels[1400] = -40;
    levels[1450] = -40;
    const [a, ...rest] = feed(seg, levels);
    expect(rest).toEqual([]);
    expect(a).toMatchObject({ startFrame: 0, frameCount: 1400, kerchunk: false });
    expect(a!.pcm.length).toBe(1400 * FRAME_BYTES);
    expect(seg.isOpen()).toBe(true);
    const [b] = feed(seg, run(QUIET, HANG_FRAMES));
    expect(b).toMatchObject({ startFrame: 1400, frameCount: MAX_FRAMES - 1400 + POST_PAD_FRAMES, kerchunk: false });
  });

  it('never flags the later part of a split as a kerchunk', () => {
    const seg = segmenter();
    const levels = run(LOUD, MAX_FRAMES);
    levels[MAX_FRAMES - 3] = -40;
    feed(seg, levels);
    const [b] = feed(seg, run(QUIET, HANG_FRAMES));
    expect(b).toMatchObject({ startFrame: MAX_FRAMES - 3, kerchunk: false });
  });

  it('drops the later part when it holds no frame at or above the floor', () => {
    const seg = segmenter(10);
    const quietFrom = MAX_FRAMES - SPLIT_WINDOW_FRAMES + 50;
    const [a] = feed(seg, [...run(LOUD, quietFrom), ...run(QUIET, MAX_FRAMES - quietFrom)]);
    expect(a!.frameCount).toBe(quietFrom);
    expect(feed(seg, run(QUIET, 500))).toEqual([]);
    expect(seg.isOpen()).toBe(false);
  });
});

describe('Segmenter force-close', () => {
  it('closes the open segment with the pad it holds', () => {
    const seg = segmenter();
    feed(seg, [...run(LOUD, 30), ...run(QUIET, 3)]);
    const s = seg.close();
    expect(s).toMatchObject({ startFrame: 0, frameCount: 33, kerchunk: false });
    expect(s!.pcm.length).toBe(33 * FRAME_BYTES);
    expect(seg.isOpen()).toBe(false);
    expect(seg.close()).toBeUndefined();
  });

  it('returns undefined when idle', () => {
    const seg = segmenter();
    feed(seg, run(QUIET, 10));
    expect(seg.close()).toBeUndefined();
  });
});
