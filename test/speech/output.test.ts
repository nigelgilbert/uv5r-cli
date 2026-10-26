import { beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

import { KILL_GRACE_MS } from '../../src/cli/audio.ts';
import { listArgs, listOutputDevices, parseDeviceList, pickOutput, playArgs, playTo, resolveOutput } from '../../src/speech/output.ts';
import { fakeChild, spawnThen } from './fakes.ts';

/** One listing line in the libavdevice/audiotoolbox.m format `[%d] %30s, %s` behind the log prefix. */
const line = (i: number, name: string, uid: string) => `[AudioToolbox @ 0x7fa1c8f04a00] [${i}] ${name.padStart(30)}, ${uid}`;

const AIOC_IN = 'AppleUSBAudioEngine:AIOC:All-In-One-Cable:1234567:2';
const AIOC_OUT = 'AppleUSBAudioEngine:AIOC:All-In-One-Cable:1234567:1';

/** A listing as `ffmpeg -f audiotoolbox -list_devices true` prints it on stderr. */
const LISTING = [
  'Input #0, lavfi, from \'anullsrc=r=48000:cl=mono\':',
  '[AudioToolbox @ 0x7fa1c8f04a00] CoreAudio devices:',
  line(0, 'AIOC Audio', AIOC_IN),
  line(1, 'AIOC Audio', AIOC_OUT),
  line(2, 'MacBook Pro Microphone', 'BuiltInMicrophoneDevice'),
  line(3, 'MacBook Pro Speakers', 'BuiltInSpeakerDevice'),
  line(4, 'Desk Speakers, Left', '00-11-22-33-44-55:output'),
  line(5, 'A device name longer than thirty columns', 'LongNameUID'),
  'Output #0, audiotoolbox, to \'-\':',
].join('\n');

const ENOENT = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });

beforeEach(() => {
  spawn.mockReset();
});

describe('parseDeviceList', () => {
  it('reads index, trimmed name and the UID after the last comma', () => {
    expect(parseDeviceList(LISTING)).toEqual([
      { index: 0, name: 'AIOC Audio', uid: AIOC_IN },
      { index: 1, name: 'AIOC Audio', uid: AIOC_OUT },
      { index: 2, name: 'MacBook Pro Microphone', uid: 'BuiltInMicrophoneDevice' },
      { index: 3, name: 'MacBook Pro Speakers', uid: 'BuiltInSpeakerDevice' },
      { index: 4, name: 'Desk Speakers, Left', uid: '00-11-22-33-44-55:output' },
      { index: 5, name: 'A device name longer than thirty columns', uid: 'LongNameUID' },
    ]);
  });

  it('reads nothing from stderr without a listing', () => {
    expect(parseDeviceList('ffmpeg version 9.0.2\nOutput #0, audiotoolbox')).toEqual([]);
  });
});

describe('pickOutput', () => {
  const devices = parseDeviceList(LISTING);

  it('takes the AIOC output, whose UID ends in :1, over its input', () => {
    expect(pickOutput(devices, 'AIOC Audio').index).toBe(1);
  });

  it('matches a device by UID and a lone name', () => {
    expect(pickOutput(devices, 'BuiltInSpeakerDevice').index).toBe(3);
    expect(pickOutput(devices, 'MacBook Pro Speakers').index).toBe(3);
  });

  it('follows the index when it moves', () => {
    const moved = parseDeviceList([line(0, 'AirPods', 'aa:output'), line(1, 'AIOC Audio', AIOC_IN), line(2, 'AIOC Audio', AIOC_OUT)].join('\n'));
    expect(pickOutput(moved, 'AIOC Audio').index).toBe(2);
  });

  it('throws audio-device-unavailable naming the listed devices', () => {
    expect(() => pickOutput(devices.slice(2), 'AIOC Audio')).toThrow(expect.objectContaining({ reason: 'audio-device-unavailable', detail: expect.objectContaining({ output: 'AIOC Audio' }) }));
  });
});

describe('listOutputDevices', () => {
  it('runs the listing through ffmpeg and resolves the AIOC output index', async () => {
    spawn.mockImplementation(spawnThen((c) => c.exit(0, { stderr: LISTING })));
    await expect(resolveOutput('AIOC Audio')).resolves.toBe(1);
    expect(spawn.mock.calls[0]![0]).toBe('ffmpeg');
    expect(spawn.mock.calls[0]![1]).toEqual(listArgs());
    expect(spawn.mock.calls[0]![2]).toMatchObject({ detached: true });
    expect(listArgs()).toContain('-list_devices');
  });

  it('keeps a listing printed before a later failure', async () => {
    spawn.mockImplementation(spawnThen((c) => c.exit(1, { stderr: LISTING })));
    await expect(listOutputDevices()).resolves.toHaveLength(6);
  });

  it('maps a missing ffmpeg to dependency-missing and a failure with no listing to audio-process-failed', async () => {
    spawn.mockImplementationOnce(spawnThen((c) => c.fail(ENOENT)));
    await expect(listOutputDevices()).rejects.toMatchObject({ reason: 'dependency-missing' });
    spawn.mockImplementationOnce(spawnThen((c) => c.exit(1, { stderr: 'Unknown output format' })));
    await expect(listOutputDevices()).rejects.toMatchObject({ reason: 'audio-process-failed', message: expect.stringContaining('Unknown output format') });
  });
  it('stops a listing that runs past its timeout and sends SIGKILL after the grace period', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      spawn.mockReturnValue(child);
      const pending = listOutputDevices().catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(child.kills).toEqual(['SIGTERM']);
      await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
      expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
      child.exit(null, { signal: 'SIGKILL' });
      expect(await pending).toMatchObject({ reason: 'audio-process-failed', message: expect.stringContaining('timed out after 10s') });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('playTo', () => {
  it('plays the WAV to the audiotoolbox index in its own process group and resolves on exit 0', async () => {
    spawn.mockImplementation(spawnThen((c) => c.exit(0)));
    await expect(playTo(4, 'tx.wav', new Promise(() => {}))).resolves.toBeUndefined();
    expect(spawn.mock.calls[0]![1]).toEqual(playArgs(4, 'tx.wav'));
    expect(spawn.mock.calls[0]![2]).toMatchObject({ detached: true });
    expect(playArgs(4, 'tx.wav')).toEqual(['-hide_banner', '-nostdin', '-i', 'tx.wav', '-f', 'audiotoolbox', '-audio_device_index', '4', '-']);
  });

  it('sends SIGTERM when stop resolves and rejects once ffmpeg exits', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);
    let stop = () => {};
    const pending = playTo(4, 'tx.wav', new Promise<void>((resolve) => (stop = resolve)));
    stop();
    await vi.waitFor(() => expect(child.kills).toEqual(['SIGTERM']));
    child.exit(null, { signal: 'SIGTERM' });
    await expect(pending).rejects.toMatchObject({ reason: 'audio-process-failed', message: expect.stringContaining('stopped when PTT dropped') });
  });

  it('rejects a non-zero exit with audio-process-failed and the stderr tail', async () => {
    spawn.mockImplementation(spawnThen((c) => c.exit(1, { stderr: 'AudioQueueStart failed' })));
    await expect(playTo(4, 'tx.wav', new Promise(() => {}))).rejects.toMatchObject({ reason: 'audio-process-failed', detail: { output: 4, code: 1 }, message: expect.stringContaining('AudioQueueStart failed') });
  });

  it('maps a missing ffmpeg to dependency-missing', async () => {
    spawn.mockImplementation(spawnThen((c) => c.fail(ENOENT)));
    await expect(playTo(4, 'tx.wav', new Promise(() => {}))).rejects.toMatchObject({ reason: 'dependency-missing' });
  });
});
