/**
 * Receive segmenter: a pure state machine over 20 ms frames of 16 kHz s16le mono PCM.
 * Squelched FM is digital silence between transmissions, so frame energy marks each one.
 * A segment opens on a run of frames above the floor, closes after the hang and splits at 30 s.
 * The machine holds no clock and does no I/O; the caller maps `startFrame` to a wall-clock time.
 */

export const SAMPLE_RATE = 16000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
/** Bytes in one frame of s16le mono. */
export const FRAME_BYTES = FRAME_SAMPLES * 2;
export const FRAMES_PER_SECOND = 1000 / FRAME_MS;
const BYTES_PER_SECOND = SAMPLE_RATE * 2;

/** Consecutive frames at or above the floor plus OPEN_MARGIN_DB that open a segment; 300 ms. */
export const OPEN_FRAMES = 15;
/** Decibels above the floor that each frame of the opening run reaches. */
const OPEN_MARGIN_DB = 5;
/** Frames before the opening run that a segment includes; 300 ms. */
export const PRE_ROLL_FRAMES = 15;
/** Bytes after the last frame at or above the floor that a closed segment includes; 150 ms. */
export const POST_PAD_BYTES = (BYTES_PER_SECOND * 150) / 1000;
/** Frames the post-pad touches; the pad ends halfway through the last one. */
export const POST_PAD_FRAMES = Math.ceil(POST_PAD_BYTES / FRAME_BYTES);
/** Active frames below which a segment is a kerchunk; 0.5 s. */
export const KERCHUNK_FRAMES = 25;
/** Frames at which an open segment splits; 30 s. */
export const MAX_FRAMES = 30 * FRAMES_PER_SECOND;
/** Frames at the end of a full segment searched for the split point; 5 s. */
export const SPLIT_WINDOW_FRAMES = 5 * FRAMES_PER_SECOND;

const FULL_SCALE = 32768;

/** RMS and sample peak of s16le PCM in dBFS; digital zero reads -Infinity. */
export function frameLevels(pcm: Buffer): { rmsDbfs: number; peakDbfs: number } {
  const n = Math.floor(pcm.length / 2);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
    peak = Math.max(peak, Math.abs(s));
  }
  const rms = n === 0 ? 0 : Math.sqrt(sum / n);
  return { rmsDbfs: 20 * Math.log10(rms / FULL_SCALE), peakDbfs: 20 * Math.log10(peak / FULL_SCALE) };
}

export interface SegmenterOptions {
  /** RMS level in dBFS; a segment opens at floorDbfs + OPEN_MARGIN_DB and closes below floorDbfs. */
  floorDbfs: number;
  /** Seconds of frames below the floor that close an open segment. */
  hangSeconds: number;
}

/** A closed segment. */
export interface Segment {
  /** Segment audio as 16 kHz s16le mono. */
  pcm: Buffer;
  /** Index of the segment's first frame, counting from the first frame pushed. */
  startFrame: number;
  /** Frames the PCM covers; after a close the post-pad ends partway through the last one. */
  frameCount: number;
  seconds: number;
  rmsDbfs: number;
  peakDbfs: number;
  /** True when the segment opened on its own and held fewer than KERCHUNK_FRAMES active frames; split parts are never kerchunks. */
  kerchunk: boolean;
}

interface Held {
  pcm: Buffer;
  rms: number;
}

interface Open {
  /** Frame index of frames[0]. */
  start: number;
  frames: Held[];
  /** Frame index of the first frame of the opening run; null for the later part of a split. */
  onset: number | null;
  /** Frame index of the last frame at or above the floor. */
  lastActive: number;
  /** Consecutive frames below the floor at the end of frames. */
  quiet: number;
}

const concat = (frames: Held[]) => Buffer.concat(frames.map((f) => f.pcm));

/**
 * Turn a stream of frames into segments. Call push for each frame in order; it returns a
 * segment when one closes or splits. Call close to end the open segment early.
 */
export class Segmenter {
  private readonly floor: number;
  private readonly closeFrames: number;
  private next = 0;
  /** The most recent frames while idle, for the pre-roll. */
  private ring: Held[] = [];
  /** Consecutive frames at or above the open level while idle. */
  private run = 0;
  private current: Open | undefined;

  constructor({ floorDbfs, hangSeconds }: SegmenterOptions) {
    this.floor = floorDbfs;
    // A hang shorter than the post-pad waits for the pad frames.
    this.closeFrames = Math.max(Math.round(hangSeconds * FRAMES_PER_SECOND), POST_PAD_FRAMES);
  }

  /** Add one 640-byte frame with its RMS in dBFS, measured from the PCM when omitted. */
  push(pcm: Buffer, rmsDbfs: number = frameLevels(pcm).rmsDbfs): Segment | undefined {
    const index = this.next++;
    const frame = { pcm, rms: rmsDbfs };
    const open = this.current;
    if (!open) {
      this.ring.push(frame);
      if (this.ring.length > PRE_ROLL_FRAMES + OPEN_FRAMES) this.ring.shift();
      this.run = rmsDbfs >= this.floor + OPEN_MARGIN_DB ? this.run + 1 : 0;
      if (this.run < OPEN_FRAMES) return undefined;
      this.current = { start: index - this.ring.length + 1, frames: this.ring, onset: index - OPEN_FRAMES + 1, lastActive: index, quiet: 0 };
      this.ring = [];
      this.run = 0;
      return undefined;
    }
    open.frames.push(frame);
    if (rmsDbfs >= this.floor) {
      open.lastActive = index;
      open.quiet = 0;
    } else {
      open.quiet++;
    }
    if (open.quiet >= this.closeFrames) return this.close();
    if (open.frames.length >= MAX_FRAMES) return this.split(open);
    return undefined;
  }

  /** Whether a segment is open. */
  isOpen(): boolean {
    return this.current !== undefined;
  }

  /**
   * Close the open segment and return it with the post-pad the held frames allow.
   * Return undefined when no segment is open or the open part of a split holds no active frame.
   */
  close(): Segment | undefined {
    const open = this.current;
    if (!open) return undefined;
    this.current = undefined;
    const active = open.lastActive - open.start + 1;
    const after = open.frames.slice(Math.max(active, 0));
    // Keep the frames past the post-pad as pre-roll for the next segment.
    this.ring = after.slice(POST_PAD_FRAMES).slice(-(PRE_ROLL_FRAMES + OPEN_FRAMES));
    if (active <= 0) return undefined;
    const pad = concat(after).subarray(0, POST_PAD_BYTES);
    const pcm = Buffer.concat([concat(open.frames.slice(0, active)), pad]);
    const kerchunk = open.onset !== null && open.lastActive - open.onset + 1 < KERCHUNK_FRAMES;
    return segment(open.start, active + Math.ceil(pad.length / FRAME_BYTES), pcm, kerchunk);
  }

  /** Emit the frames before the quietest frame in the last SPLIT_WINDOW_FRAMES and keep the rest open. */
  private split(open: Open): Segment {
    let quietest = open.frames.length - SPLIT_WINDOW_FRAMES;
    for (let i = quietest + 1; i < open.frames.length; i++) {
      if (open.frames[i]!.rms < open.frames[quietest]!.rms) quietest = i;
    }
    const head = open.frames.slice(0, quietest);
    this.current = { ...open, start: open.start + quietest, frames: open.frames.slice(quietest), onset: null };
    return segment(open.start, head.length, concat(head), false);
  }
}

function segment(startFrame: number, frameCount: number, pcm: Buffer, kerchunk: boolean): Segment {
  const { rmsDbfs, peakDbfs } = frameLevels(pcm);
  return { pcm, startFrame, frameCount, seconds: pcm.length / BYTES_PER_SECOND, rmsDbfs, peakDbfs, kerchunk };
}
