import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KILL_GRACE_MS } from '../../src/cli/audio.ts';
import { DROP_FRAMES, FrameAccumulator, startMonitor } from '../../src/tts/monitor.ts';
import { FRAME_BYTES } from '../../src/tts/segment.ts';

/** A child process stand-in; kill emits close unless the signal is in `ignore`. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  pid: number | undefined = 4242;
  ignore: NodeJS.Signals[] = [];
  readonly kill = vi.fn((signal: NodeJS.Signals) => {
    if (!this.ignore.includes(signal)) setImmediate(() => this.emit('close', null, signal));
    return true;
  });
}

function start(child = new FakeChild()) {
  const spawn = vi.fn(() => child as unknown as ChildProcess);
  const monitor = startMonitor('AIOC Audio', { spawn });
  return { child, spawn, monitor, frames: monitor.frames[Symbol.asyncIterator]() };
}

/** One frame whose every byte is `k`. */
const frame = (k: number) => Buffer.alloc(FRAME_BYTES, k);

/** Emit frames `from` to `to` - 1 on stdout in uneven chunks. */
function emitFrames(child: FakeChild, from: number, to: number) {
  const bytes = Buffer.concat(Array.from({ length: to - from }, (_, i) => frame(from + i)));
  const sizes = [1, 639, 641, 1283, 7];
  let at = 0;
  for (let i = 0; at < bytes.length; i++) {
    const n = sizes[i % sizes.length]!;
    child.stdout.emit('data', bytes.subarray(at, at + n));
    at += n;
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.useRealTimers();
});

describe('FrameAccumulator', () => {
  it('emits exact 640-byte frames from uneven chunks and carries the remainder', () => {
    const stream = Buffer.from(Array.from({ length: 6000 }, (_, i) => i % 251));
    const acc = new FrameAccumulator();
    const out: Buffer[] = [];
    let at = 0;
    const counts: number[] = [];
    for (const n of [1, 639, 641, 1280 + 3, 0, 2, 1434]) {
      const frames = acc.push(stream.subarray(at, at + n));
      at += n;
      counts.push(frames.length);
      out.push(...frames);
    }
    expect(counts).toEqual([0, 1, 1, 2, 0, 0, 2]);
    expect(out.every((f) => f.length === FRAME_BYTES)).toBe(true);
    expect(Buffer.concat(out)).toEqual(stream.subarray(0, out.length * FRAME_BYTES));
    expect(acc.pending).toBe(at - out.length * FRAME_BYTES);
  });
});

describe('startMonitor', () => {
  it('spawns ffmpeg with the capture argv in its own process group', () => {
    const { spawn } = start();
    expect(spawn).toHaveBeenCalledWith(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-f',
        'avfoundation',
        '-i',
        ':AIOC Audio',
        '-af',
        'aformat=sample_fmts=flt:channel_layouts=mono,highpass=f=50,aresample=16000',
        '-f',
        's16le',
        '-ac',
        '1',
        '-ar',
        '16000',
        'pipe:1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
  });

  it('drops the first second once, then resolves ready and yields every later frame', async () => {
    const { child, monitor, frames } = start();
    let ready = false;
    void monitor.ready.then(() => (ready = true));
    emitFrames(child, 0, DROP_FRAMES - 1);
    await tick();
    expect(ready).toBe(false);
    emitFrames(child, DROP_FRAMES - 1, DROP_FRAMES + 3);
    await tick();
    expect(ready).toBe(true);
    const got: Buffer[] = [];
    for (let i = 0; i < 3; i++) got.push((await frames.next()).value as Buffer);
    expect(got).toEqual([frame(DROP_FRAMES), frame(DROP_FRAMES + 1), frame(DROP_FRAMES + 2)]);
    emitFrames(child, DROP_FRAMES + 3, DROP_FRAMES + 4);
    expect((await frames.next()).value).toEqual(frame(DROP_FRAMES + 3));
  });

  it('stop kills ffmpeg, resolves once it exits and ends the frames', async () => {
    const { child, monitor, frames } = start();
    const next = frames.next();
    await monitor.stop();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(await next).toEqual({ done: true, value: undefined });
    await expect(monitor.ready).resolves.toBeUndefined();
  });

  it('stop sends SIGKILL when ffmpeg ignores SIGTERM', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    child.ignore = ['SIGTERM'];
    const { monitor } = start(child);
    let stopped = false;
    void monitor.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS - 1);
    expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
    await vi.runAllTimersAsync();
    expect(stopped).toBe(true);
  });

  it('raises audio-process-failed when ffmpeg exits before stop', async () => {
    const { child, monitor, frames } = start();
    child.stderr.emit('data', Buffer.from('[avfoundation @ 0x1] Input/output error\n:AIOC Audio: Input/output error\n'));
    child.emit('close', 1, null);
    const expected = {
      kind: 'transport',
      reason: 'audio-process-failed',
      message: expect.stringMatching(/^ffmpeg exited with code 1 capturing from "AIOC Audio": .*Input\/output error$/),
      detail: { device: 'AIOC Audio', code: 1, signal: null },
    };
    await expect(monitor.ready).rejects.toMatchObject(expected);
    await expect(frames.next()).rejects.toMatchObject(expected);
    await monitor.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('yields the frames already captured before raising the exit', async () => {
    const { child, frames } = start();
    emitFrames(child, 0, DROP_FRAMES + 1);
    child.emit('close', 0, null);
    expect((await frames.next()).value).toEqual(frame(DROP_FRAMES));
    await expect(frames.next()).rejects.toMatchObject({ reason: 'audio-process-failed', message: expect.stringMatching(/^ffmpeg exited with code 0/) });
  });

  it('raises dependency-missing when ffmpeg is absent from PATH', async () => {
    const child = new FakeChild();
    child.pid = undefined;
    const { monitor } = start(child);
    child.emit('error', Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }));
    await expect(monitor.ready).rejects.toMatchObject({ reason: 'dependency-missing' });
    await monitor.stop();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
