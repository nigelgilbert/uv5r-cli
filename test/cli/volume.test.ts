import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIP_WARNING, listen, type ListenResult } from '../../src/cli/audio.ts';
import { KEY_SIGNALS, REASONS, TransportError } from '../../src/core/index.ts';
import { cli, type OpenTransport } from '../../src/cli/main.ts';
import { judgeVolume, readVolume, TARGET_HIGH_DBFS, TARGET_LOW_DBFS, VOLUME_SECONDS, type WithPort } from '../../src/cli/volume.ts';
import { FakeRadio } from '../core/fake.ts';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('../../src/cli/audio.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/cli/audio.ts')>()), listen: vi.fn() }));

const listenMock = vi.mocked(listen);

/** Address of the settings block; its first byte is squelch. */
const SQUELCH_AT = 0x0e20;
/** Writes of one settings commit: both halves, then the 0x0E40 record. */
const SETTINGS_WRITES = [0x0e20, 0x0e30, 0x0e40];

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  execFile.mockReset();
  execFile.mockImplementation((_file, _args, _opts, cb) => cb(null, '', ''));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => stdout.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => stderr.push(String(chunk)) > 0);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  listenMock.mockReset();
  process.exitCode = undefined;
});

const outJson = () => JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
const errJson = () => JSON.parse(stderr.join('').trim()) as Record<string, unknown>;

/** Count opens and hand back the fake radio. */
function opener(radio: FakeRadio): OpenTransport & { calls: number } {
  const open = Object.assign(
    async () => {
      open.calls++;
      return radio;
    },
    { calls: 0 },
  );
  return open;
}

/** Build a 2 s listen result with mean RMS `rms` and the given warnings. */
function heard(rms: number | null, warnings: string[] = []): ListenResult {
  return {
    input: 'AIOC Audio',
    seconds: VOLUME_SECONDS,
    rmsDbfs: [rms, rms],
    zeroSeconds: rms === null ? 2 : 0,
    meanRmsDbfs: rms,
    peakDbfs: rms === null ? null : rms + 12,
    active: [rms !== null && rms > -50, rms !== null && rms > -50],
    activeSeconds: rms !== null && rms > -50 ? 2 : 0,
    warnings,
  };
}

/** Run the CLI under fake timers until it finishes. */
async function run(argv: string[], open: OpenTransport): Promise<void> {
  const done = cli(argv, open);
  await vi.runAllTimersAsync();
  await done;
}

/** Run `fn` with stdout set as a terminal. */
async function onTerminal(fn: () => Promise<void>): Promise<void> {
  const tty = process.stdout.isTTY;
  process.stdout.isTTY = true;
  try {
    await fn();
  } finally {
    process.stdout.isTTY = tty;
  }
}

/** A fake radio that stores squelch 5 in place of the first committed settings block, to fail its read-back. */
class DriftingRadio extends FakeRadio {
  private commits = 0;
  protected override stored(addr: number): void {
    if (addr === 0x0e40 && this.commits++ === 0) this.eeprom[SQUELCH_AT] = 5;
  }
}

/** A fake radio that acks writes again from its second handshake on and keeps the squelch it held then. */
class RecoveringRadio extends FakeRadio {
  private handshakeCount = 0;
  squelchAtSecondHandshake: number | undefined;
  protected override acked(): void {
    if (this.handshakeCount++ !== 1) return;
    this.squelchAtSecondHandshake = this.eeprom[SQUELCH_AT];
    this.unackedWriteAt = undefined;
  }
}

describe('judgeVolume', () => {
  const quarterDown = 'Turn the volume knob down about a quarter turn, then say done.';
  const littleDown = 'Turn the volume knob down a little, then say done.';
  const quarterUp = 'Turn the volume knob up about a quarter turn, then say done.';
  const littleUp = 'Turn the volume knob up a little, then say done.';
  const halfDown = 'Turn the volume knob down about a half turn, then say done.';
  const zero =
    'The Mac is sending the radio tool silence. In System Settings, Privacy & Security, Microphone, allow the terminal, and check that AIOC Audio is not muted. Then say done.';
  const underFloor = 'Turn the volume knob up a little. If it is already up, push the plug all the way in. Then say done.';
  const ok = 'The volume knob is set. Leave it there.';

  it('sets the band to -28..-22 dBFS', () => {
    expect([TARGET_LOW_DBFS, TARGET_HIGH_DBFS]).toEqual([-28, -22]);
  });

  it.each([
    ['a clip warning at a high RMS', -8, [CLIP_WARNING], 'too-loud', halfDown],
    ['a clip warning at a low RMS', -60, [CLIP_WARNING], 'too-loud', halfDown],
    ['a clip warning at an in-band RMS', -25, [CLIP_WARNING], 'too-loud', halfDown],
    ['a clip warning with a digital zero mean', null, [CLIP_WARNING], 'too-loud', halfDown],
    ['a digital zero mean', null, [], 'silent', zero],
    ['a mean at the floor', -50, [], 'silent', underFloor],
    ['a mean under the floor', -70, [], 'silent', underFloor],
    ['a mean more than 6 dB above the band', -15.9, [], 'too-loud', quarterDown],
    ['a mean 6 dB above the band', -16, [], 'too-loud', littleDown],
    ['a mean just above the band', -21.9, [], 'too-loud', littleDown],
    ['a mean at the high edge', -22, [], 'ok', ok],
    ['a mean inside the band', -25, [], 'ok', ok],
    ['a mean at the low edge', -28, [], 'ok', ok],
    ['a mean just below the band', -28.1, [], 'too-quiet', littleUp],
    ['a mean 6 dB below the band', -34, [], 'too-quiet', littleUp],
    ['a mean more than 6 dB below the band', -34.1, [], 'too-quiet', quarterUp],
    ['a mean just over the floor', -49.9, [], 'too-quiet', quarterUp],
  ] as const)('reads %s as %s', (_what, rms, warnings, state, instruction) => {
    expect(judgeVolume(heard(rms, [...warnings]))).toEqual({ state, rmsDbfs: rms, instruction });
  });
});

describe('volume', () => {
  it('writes squelch 0, verifies it, captures 2 s, restores squelch and prints the result', async () => {
    const radio = new FakeRadio();
    radio.eeprom[SQUELCH_AT] = 7;
    let squelchAtListen: number | undefined;
    let writesAtListen: number[] = [];
    listenMock.mockImplementation(async () => {
      squelchAtListen = radio.eeprom[SQUELCH_AT];
      writesAtListen = [...radio.writes];
      return heard(-10.4);
    });
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(squelchAtListen).toBe(0);
    expect(writesAtListen).toEqual(SETTINGS_WRITES);
    expect(listenMock).toHaveBeenCalledWith('AIOC Audio', 2, -50, { stop: expect.any(Promise) });
    expect(radio.writes).toEqual([...SETTINGS_WRITES, ...SETTINGS_WRITES]);
    // Open the write session, its verification, the restore and its verification.
    expect(radio.handshakes).toHaveLength(4);
    expect(radio.eeprom[SQUELCH_AT]).toBe(7);
    expect(outJson()).toEqual({ state: 'too-loud', rmsDbfs: -10.4, instruction: 'Turn the volume knob down about a quarter turn, then say done.' });
  });

  it('passes --device to listen', async () => {
    listenMock.mockResolvedValue(heard(-25));
    await run(['volume', '--input', '1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(listenMock.mock.calls[0]![0]).toBe('1');
    expect(outJson()).toMatchObject({ state: 'ok' });
  });

  it('writes nothing and opens one session when squelch is already 0', async () => {
    const radio = new FakeRadio();
    radio.eeprom[SQUELCH_AT] = 0;
    listenMock.mockResolvedValue(heard(-40));
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.writes).toEqual([]);
    expect(radio.handshakes).toHaveLength(1);
    expect(outJson()).toEqual({ state: 'too-quiet', rmsDbfs: -40, instruction: 'Turn the volume knob up about a quarter turn, then say done.' });
  });

  it('exits 3 with the capture error and no squelch when squelch is already 0', async () => {
    const radio = new FakeRadio();
    radio.eeprom[SQUELCH_AT] = 0;
    listenMock.mockRejectedValue(new TransportError('capture-incomplete', 'ffmpeg captured 1 of 3 seconds from "AIOC Audio"'));
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(radio.writes).toEqual([]);
    expect(errJson()).not.toHaveProperty('squelch');
    expect(errJson()).toMatchObject({ reason: 'capture-incomplete', remedy: REASONS['capture-incomplete'].remedy });
  });

  it('prints state, rms and instruction on three lines on a terminal', async () => {
    listenMock.mockResolvedValue(heard(null));
    await onTerminal(() => run(['volume'], opener(new FakeRadio())));
    expect(stdout.join('')).toBe(
      'state       silent\n' +
        'rms         zero\n' +
        'instruction The Mac is sending the radio tool silence. In System Settings, Privacy & Security, Microphone, allow the terminal, and check that AIOC Audio is not muted. Then say done.\n',
    );
  });

  it('prints the rms in dBFS on a terminal', async () => {
    listenMock.mockResolvedValue(heard(-25));
    await onTerminal(() => run(['volume'], opener(new FakeRadio())));
    expect(stdout.join('')).toBe('state       ok\nrms         -25 dBFS\ninstruction The volume knob is set. Leave it there.\n');
  });

  it('restores squelch after a capture error and adds squelch and the remedy to the error', async () => {
    const radio = new FakeRadio();
    listenMock.mockRejectedValue(new TransportError('capture-incomplete', 'ffmpeg captured 1 of 3 seconds from "AIOC Audio"', { input: 'AIOC Audio', captured: 1, requested: 3 }));
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'capture-incomplete', squelch: 3, remedy: 'run uv5r settings squelch 3', retry: 'after-remedy', captured: 1 });
    expect(radio.writes).toEqual([...SETTINGS_WRITES, ...SETTINGS_WRITES]);
    expect(radio.eeprom[SQUELCH_AT]).toBe(3);
    expect(stdout).toEqual([]);
  });

  it('restores squelch after a failed verification of the squelch 0 write and skips the capture', async () => {
    const radio = new DriftingRadio();
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'verification-failed', squelch: 3, remedy: 'run uv5r settings squelch 3' });
    expect(listenMock).not.toHaveBeenCalled();
    expect(radio.writes).toEqual([...SETTINGS_WRITES, ...SETTINGS_WRITES]);
    expect(radio.eeprom[SQUELCH_AT]).toBe(3);
  });

  it('restores squelch after the squelch 0 write loses its ack', async () => {
    const radio = new RecoveringRadio();
    radio.unackedWriteAt = 0x0e40;
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'write-unacknowledged', squelch: 3, remedy: 'run uv5r settings squelch 3' });
    expect(listenMock).not.toHaveBeenCalled();
    expect(radio.writes).toEqual([...SETTINGS_WRITES, ...SETTINGS_WRITES]);
    expect(radio.squelchAtSecondHandshake).toBe(0);
    expect(radio.eeprom[SQUELCH_AT]).toBe(3);
  });

  it('restores squelch after SIGINT during the capture, prints no result and exits 130', async () => {
    const radio = new FakeRadio();
    listenMock.mockImplementation(async () => {
      process.emit('SIGINT');
      throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
    });
    const before = process.listenerCount('SIGINT');
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(130);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(radio.writes).toEqual([...SETTINGS_WRITES, ...SETTINGS_WRITES]);
    expect(radio.eeprom[SQUELCH_AT]).toBe(3);
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('exits 5 with squelch and the remedy when the restore loses its ack', async () => {
    const radio = new FakeRadio();
    radio.eeprom[SQUELCH_AT] = 7;
    listenMock.mockImplementation(async () => {
      radio.refuseWriteAt = SQUELCH_AT;
      return heard(-25);
    });
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'write-unacknowledged', squelch: 7, remedy: 'run uv5r settings squelch 7', retry: 'after-remedy' });
    expect(radio.eeprom[SQUELCH_AT]).toBe(0);
    expect(stdout).toEqual([]);
  });

  it('keeps the capture error with squelch and the remedy when the restore fails after it', async () => {
    const radio = new FakeRadio();
    listenMock.mockImplementation(async () => {
      radio.refuseWriteAt = SQUELCH_AT;
      throw new TransportError('capture-incomplete', 'ffmpeg captured 1 of 3 seconds from "AIOC Audio"');
    });
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'capture-incomplete', squelch: 3, remedy: 'run uv5r settings squelch 3' });
  });

  it('exits with the restore error after a signal when the restore fails', async () => {
    const radio = new FakeRadio();
    listenMock.mockImplementation(async () => {
      radio.refuseWriteAt = SQUELCH_AT;
      process.emit('SIGTERM');
      throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
    });
    await run(['volume', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'write-unacknowledged', squelch: 3, remedy: 'run uv5r settings squelch 3' });
  });

  it.each([
    ['a missing ffmpeg', { code: 'ENOENT' }, 'dependency-missing'],
    ['a failing ffmpeg', { code: 1 }, 'audio-process-failed'],
  ])('exits 3 on %s before opening the transport', async (_what, err, reason) => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(Object.assign(new Error('ffmpeg failed'), err), '', ''));
    const open = opener(new FakeRadio());
    await run(['volume', '--json'], open);
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason });
    expect(errJson()).not.toHaveProperty('squelch');
    expect(open.calls).toBe(0);
  });

  it.each([
    [['volume', '--seconds', '5'], 'unknown option --seconds'],
    [['volume', '--floor', '-40'], 'unknown option --floor'],
  ])('exits 2 on %j before opening the transport', async (argv, text) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(text) });
    expect(open.calls).toBe(0);
  });

  it('lists the band as provisional and the squelch write in help volume', async () => {
    await cli(['help', 'volume', '--json']);
    const help = JSON.parse(stdout.join('')) as { effects: string[]; preconditions: string[]; device: { writesToRadio: boolean }; result: unknown };
    expect(help.effects).toContain('The band is provisional until a bench pass with live speech sets it.');
    expect(help.preconditions.join(' ')).toContain('AIOC Audio is at 100 percent');
    expect(help.device.writesToRadio).toBe(true);
    expect(help.result).toEqual({ state: 'too-loud', rmsDbfs: -10.4, instruction: 'Turn the volume knob down about a quarter turn, then say done.' });
  });
});

describe('readVolume', () => {
  const direct = (radio: FakeRadio): WithPort => (fn) => fn(radio);

  it('kills the capture on a signal, restores squelch and removes its handlers', async () => {
    const radio = new FakeRadio();
    const signals = new EventEmitter();
    listenMock.mockImplementation(async (_device, _seconds, _floor, options) => {
      signals.emit('SIGTERM');
      await options!.stop;
      throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
    });
    const done = readVolume(direct(radio), { input: 'AIOC Audio', signals });
    await vi.runAllTimersAsync();
    expect(await done).toEqual({ interrupted: 'SIGTERM' });
    expect(radio.eeprom[SQUELCH_AT]).toBe(3);
    expect(KEY_SIGNALS.reduce((n, s) => n + signals.listenerCount(s), 0)).toBe(0);
  });

  it('installs its handlers before the port opens and skips the radio on a signal during the open', async () => {
    const radio = new FakeRadio();
    const signals = new EventEmitter();
    const withPort: WithPort = async (fn) => {
      expect(KEY_SIGNALS.every((s) => signals.listenerCount(s) === 1)).toBe(true);
      signals.emit('SIGHUP');
      await fn(radio);
    };
    expect(await readVolume(withPort, { input: 'AIOC Audio', signals })).toEqual({ interrupted: 'SIGHUP' });
    expect(radio.handshakes).toEqual([]);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('skips the verification and capture after a signal during the squelch write and restores squelch', async () => {
    const radio = new FakeRadio();
    const signals = new EventEmitter();
    const write = radio.write.bind(radio);
    let sent = false;
    vi.spyOn(radio, 'write').mockImplementation((bytes) => {
      if (!sent && bytes[0] === 0x58) {
        sent = true;
        signals.emit('SIGINT');
      }
      write(bytes);
    });
    const done = readVolume(direct(radio), { input: 'AIOC Audio', signals });
    await vi.runAllTimersAsync();
    expect(await done).toEqual({ interrupted: 'SIGINT' });
    expect(listenMock).not.toHaveBeenCalled();
    // Open the write session and the restore session with its verification.
    expect(radio.handshakes).toHaveLength(3);
    expect(radio.eeprom[SQUELCH_AT]).toBe(3);
  });
});
