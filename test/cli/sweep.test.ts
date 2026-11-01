import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIP_WARNING, listen, type ListenResult } from '../../src/cli/audio.ts';
import { BusyError, KEY_SIGNALS, magicByName, readPlan, TransportError } from '../../src/core/index.ts';
import { signalExitCode } from '../../src/cli/exit.ts';
import { cli, type OpenTransport } from '../../src/cli/main.ts';
import { captureName, dwell, newProgress, runSweep, slotZero, type SweepSteps } from '../../src/cli/sweep.ts';
import { FakeRadio } from '../core/fake.ts';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('../../src/cli/audio.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/cli/audio.ts')>()), listen: vi.fn() }));

const listenMock = vi.mocked(listen);
const EXAMPLE_PLAN = new URL('../../channels.example.json', import.meta.url).pathname;
const PLAN_CHANNELS = [1, 2, 3, 4, 5, 6, 7];

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

/** Build a listen result with `activeSeconds` active seconds out of `seconds`. */
function heard(seconds: number, activeSeconds: number, warnings: string[] = []): ListenResult {
  const active = Array.from({ length: seconds }, (_, i) => i < activeSeconds);
  return {
    input: 'AIOC Audio',
    seconds,
    rmsDbfs: active.map((on) => (on ? -20 : -66)),
    zeroSeconds: 0,
    meanRmsDbfs: -30,
    peakDbfs: -6,
    active,
    activeSeconds,
    warnings,
  };
}

/** Answer the check listen with activity, then each sweep listen with `activity[i]` active seconds, writing and echoing `out`. */
function listenSequence(activity: number[]): void {
  let call = 0;
  listenMock.mockImplementation(async (_device, seconds, _floor, options) => {
    const i = call++;
    if (i === 0) return heard(seconds, seconds);
    const result = heard(seconds, activity[i - 1] ?? 0);
    if (options?.out === undefined) return result;
    writeFileSync(options.out, 'RIFF');
    return { ...result, out: options.out };
  });
}

/** Run the CLI under fake timers until it finishes. */
async function run(argv: string[], open: OpenTransport): Promise<void> {
  const done = cli(argv, open);
  await vi.runAllTimersAsync();
  await done;
}

const SWEEP = ['sweep', EXAMPLE_PLAN, '--seconds', '2'];

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

/** Replace stdin with a non-TTY stream and return it. */
function stubStdin(): PassThrough {
  const stdin = Object.assign(new PassThrough(), { isTTY: false });
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);
  return stdin;
}

/** Write `plan` to a temp file and return its path. */
function planFile(plan: object): string {
  const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'plan.json');
  writeFileSync(file, JSON.stringify(plan));
  return file;
}

describe('sweep', () => {
  it('opens the check session and every slot 0 session with the magic UV5R_MAGIC names', async () => {
    vi.stubEnv('UV5R_MAGIC', 'UV82');
    const radio = new FakeRadio();
    radio.magics = [magicByName('UV82').bytes];
    listenMock.mockImplementation(async (_device, seconds) => heard(seconds, seconds));
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.handshakes).toEqual(new Array(1 + PLAN_CHANNELS.length).fill('50 bb ff 20 13 01 05'));
  });

  it('runs a 5 s check, then writes each entry into slot 0 and dwells 30 s, with no flags and piped stdin', async () => {
    const stdin = stubStdin();
    const radio = new FakeRadio();
    const writesAtListen: number[][] = [];
    let checkTxBytes: number[] = [];
    listenSequence([2, 0, 1, 0, 0, 0, 0]);
    const answer = listenMock.getMockImplementation()!;
    listenMock.mockImplementation(async (...args) => {
      if (writesAtListen.length === 0) checkTxBytes = [...radio.eeprom.subarray(4, 8)];
      writesAtListen.push([...radio.writes]);
      return answer(...args);
    });
    await run(['sweep', EXAMPLE_PLAN], opener(radio));
    expect(process.exitCode).toBe(0);
    // The check and each of the seven entries write the slot 0 record and name.
    expect(radio.writes).toEqual(Array.from({ length: 8 }, () => [0x0000, 0x1000]).flat());
    expect(writesAtListen.map((w) => w.length)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(checkTxBytes).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(listenMock.mock.calls[0]).toEqual(['AIOC Audio', 5, -50, { stop: expect.any(Promise) }]);
    for (const call of listenMock.mock.calls.slice(1)) expect(call).toEqual(['AIOC Audio', 30, -50, { out: undefined, stop: expect.any(Promise) }]);
    expect(stdin.listenerCount('data') + stdin.listenerCount('readable')).toBe(0);
    expect(stdin.readableFlowing).toBeNull();
    expect(stdout).toHaveLength(1);
    expect(outJson()).toEqual({
      swept: 7,
      seconds: 30,
      input: 'AIOC Audio',
      active: [
        { channel: 1, slot: 0, name: 'NOAA 1', requestedHz: 162_400_000, activeSeconds: 2 },
        { channel: 3, slot: 0, name: 'NOAA 3', requestedHz: 162_550_000, activeSeconds: 1 },
      ],
      warnings: [],
      slot0: { channel: 7, name: 'SHERIFF' },
    });
    stdout = [];
    radio.dropSession();
    await run(['read', '0', '--json'], opener(radio));
    expect(outJson()).toMatchObject({ channel: 0, rxHz: 154_695_000, txHz: null, rxTone: '156.7', bandwidth: 'narrow', name: 'SHERIFF' });
  });

  it('writes each entry with its own TX setting', async () => {
    const radio = new FakeRadio();
    const txAtDwell: string[] = [];
    listenMock.mockImplementation(async (_device, seconds, _floor, options) => {
      if (options !== undefined && 'out' in options) txAtDwell.push(Buffer.from(radio.eeprom.subarray(4, 8)).toString('hex'));
      return heard(seconds, seconds);
    });
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    // Channel 4 is the 146.820 repeater with a 146.220 input; channel 7 is receive only.
    expect(txAtDwell[3]).toBe('00206214');
    expect(txAtDwell[6]).toBe('ffffffff');
  });

  it('sets the dwell with --seconds and keeps the check at 5 s', async () => {
    listenMock.mockImplementation(async (_device, seconds) => heard(seconds, seconds));
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(listenMock.mock.calls.map((c) => c[1])).toEqual([5, ...Array(7).fill(2)]);
    expect(outJson()).toMatchObject({ seconds: 2 });
  });

  it.each([
    ['3 of 5', 3, 5],
    ['0 of 5', 0, 5],
  ])('exits 5 on a check with %s active seconds and writes no plan entry', async (_what, active, exit) => {
    const radio = new FakeRadio();
    listenMock.mockResolvedValue(heard(5, active));
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(exit);
    expect(radio.writes).toEqual([0x0000, 0x1000]);
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(errJson()).toMatchObject({
      reason: 'audio-inactive',
      remedy: 'ask the human to set MR mode and select slot 0',
      retry: 'after-remedy',
      phase: 'check',
      slot: 0,
      channel: null,
      requestedHz: 162_400_000,
      activeSeconds: active,
      summary: { swept: 0, seconds: 2, input: 'AIOC Audio', active: [], warnings: [], slot0: { channel: null, name: '162.4' } },
    });
    expect(errJson()).not.toHaveProperty('written');
    expect(errJson().summary).toEqual({ swept: 0, seconds: 2, input: 'AIOC Audio', active: [], warnings: [], slot0: { channel: null, name: '162.4' } });
    expect(errJson().message).toContain('VFO mode, another slot selected, volume knob down, plug unseated, quiet frequency');
    expect(stdout).toEqual([]);
  });

  it.each([
    ['--scratch', ['sweep', EXAMPLE_PLAN, '--scratch', '0'], '--scratch'],
    ['--check', ['sweep', EXAMPLE_PLAN, '--check', '162.400'], '--check'],
    ['--no-check', ['sweep', EXAMPLE_PLAN, '--no-check'], '--no-check'],
    ['--play', ['sweep', EXAMPLE_PLAN, '--out-dir', 'rx', '--play'], 'unknown option --play'],
    ['--floor', ['sweep', EXAMPLE_PLAN, '--floor', '-40'], 'unknown option --floor'],
    ['a fractional --seconds', ['sweep', EXAMPLE_PLAN, '--seconds', '2.5'], '--seconds'],
    ['--verbose', ['sweep', EXAMPLE_PLAN, '--verbose'], 'unknown option --verbose'],
    ['a plan without checkMhz', ['sweep', planFile({ channels: [{ channel: 1, rxMhz: 162.4 }] })], 'checkMhz'],
    ['a checkMhz outside the band', ['sweep', planFile({ checkMhz: 300, channels: [{ channel: 1, rxMhz: 162.4 }] })], 'checkMhz'],
  ])('exits 2 on %s before opening the transport', async (_what, argv, text) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(text) });
    expect(open.calls).toBe(0);
    expect(listenMock).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
  });

  it('loads a plan without checkMhz', async () => {
    await run(['load', planFile({ channels: [{ channel: 1, rxMhz: 162.4 }] }), '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
  });

  it('keeps one WAV per entry named by channel with --out-dir and creates the directory', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'rx');
    listenSequence([2, 0, 0, 0, 0, 0, 1]);
    await run([...SWEEP, '--out-dir', dir, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(existsSync(dir)).toBe(true);
    const parts = listenMock.mock.calls.slice(1).map((c) => c[3]?.out);
    expect(parts).toHaveLength(7);
    parts.forEach((part, i) => expect(part).toMatch(new RegExp(`^${dir}/ch0${PLAN_CHANNELS[i]}-\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d\\.wav\\.part$`)));
    const outs = parts.map((part) => part!.replace(/\.part$/, ''));
    expect(readdirSync(dir).sort()).toEqual(outs.map((out) => out.slice(dir.length + 1)).sort());
    expect(outJson()).toMatchObject({
      active: [
        { channel: 1, activeSeconds: 2, out: outs[0] },
        { channel: 7, activeSeconds: 1, out: outs[6] },
      ],
    });
    // Run only the ffmpeg -version check through execFile; sweep plays nothing.
    expect(execFile.mock.calls.map((c) => [c[0], c[1]])).toEqual([['ffmpeg', ['-version']]]);
  });

  it('exits 3 with file-write-failed and the summary when a capture cannot be renamed into --out-dir', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'rx');
    let part = '';
    listenMock.mockImplementation(async (_device, seconds, _floor, opts) => {
      if (opts?.out !== undefined) {
        part = opts.out;
        writeFileSync(part, 'RIFF');
        // Put a directory at the WAV path so the rename fails.
        mkdirSync(part.replace(/\.part$/, ''));
      }
      return heard(seconds, seconds);
    });
    await run([...SWEEP, '--out-dir', dir, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    expect(errJson()).toMatchObject({
      reason: 'file-write-failed',
      retry: 'after-remedy',
      remedy: 'pass --out-dir with a writable directory that has free space',
      part,
      out: part.replace(/\.part$/, ''),
      code: 'EISDIR',
      summary: { swept: 0 },
    });
    expect(existsSync(part)).toBe(true);
  });

  it.each([
    ['a missing plan file', ['sweep', 'missing.json']],
    ['no plan file', ['sweep']],
    ['a plan without checkMhz', ['sweep', planFile({ channels: [{ channel: 1, rxMhz: 162.4 }] })]],
  ])('carries no summary and no written on %s', async (_what, argv) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument' });
    expect(errJson()).not.toHaveProperty('summary');
    expect(errJson()).not.toHaveProperty('written');
    expect(stdout).toEqual([]);
    expect(open.calls).toBe(0);
  });

  it('prints nothing on stdout and an empty summary on stderr when the port is busy', async () => {
    const open: OpenTransport = async () => {
      throw new BusyError('cannot open fake: Resource temporarily unavailable', { target: 'fake' });
    };
    await run([...SWEEP, '--json'], open);
    expect(process.exitCode).toBe(6);
    expect(stdout).toEqual([]);
    expect(errJson()).toMatchObject({ reason: 'device-busy', summary: { swept: 0, seconds: 2, active: [], warnings: [], slot0: null } });
  });

  it('tags each warning with its plan channel', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => (call++ === 4 ? heard(seconds, 2, ['input clips: turn the volume knob down']) : heard(seconds, seconds)));
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(outJson()).toMatchObject({ warnings: ['channel 4: input clips: turn the volume knob down'] });
  });

  it('prints the summary with slot0 for the entry whose dwell a SIGINT cut short and exits 130', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 3) {
        process.emit('SIGINT');
        throw new TransportError('audio-process-failed', 'ffmpeg stopped on SIGINT capturing from "AIOC Audio"');
      }
      return heard(seconds, seconds);
    });
    const before = process.listenerCount('SIGINT');
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(130);
    expect(stdout).toHaveLength(1);
    expect(outJson()).toMatchObject({ swept: 2, interrupted: 'SIGINT', active: [{ channel: 1 }, { channel: 2 }], slot0: { channel: 3, name: 'NOAA 3' } });
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('prints the summary and exits 128 plus the platform number on SIGTSTP', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 3) {
        process.emit('SIGTSTP');
        throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
      }
      return heard(seconds, seconds);
    });
    const before = process.listenerCount('SIGTSTP');
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(signalExitCode('SIGTSTP'));
    expect(outJson()).toMatchObject({ swept: 2, interrupted: 'SIGTSTP', slot0: { channel: 3, name: 'NOAA 3' } });
    expect(process.listenerCount('SIGTSTP')).toBe(before);
  });

  it('prints slot0 for the check record on a SIGINT during the check', async () => {
    const radio = new FakeRadio();
    listenMock.mockImplementation(async () => {
      process.emit('SIGINT');
      throw new TransportError('audio-process-failed', 'ffmpeg stopped on SIGINT capturing from "AIOC Audio"');
    });
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(130);
    expect(radio.writes).toEqual([0x0000, 0x1000]);
    expect(outJson()).toEqual({ swept: 0, seconds: 2, input: 'AIOC Audio', active: [], warnings: [], slot0: { channel: null, name: '162.4' }, interrupted: 'SIGINT' });
  });

  it('prints nothing on stdout and the error with the summary and slot0 on stderr when a dwell fails', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 3) throw new TransportError('audio-process-failed', 'ffmpeg exited 1 capturing from "AIOC Audio"');
      return heard(seconds, seconds);
    });
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    expect(errJson()).toMatchObject({ reason: 'audio-process-failed', message: 'ffmpeg exited 1 capturing from "AIOC Audio"', summary: { swept: 2, slot0: { channel: 3, name: 'NOAA 3' } } });
    expect(errJson().summary).not.toHaveProperty('interrupted');
  });

  it('prints the error and the summary so far on stderr as text on a terminal when a dwell fails', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 3) throw new TransportError('audio-process-failed', 'ffmpeg exited 1 capturing from "AIOC Audio"');
      return heard(seconds, seconds);
    });
    await onTerminal(() => run(SWEEP, opener(new FakeRadio())));
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    const text = stderr.join('');
    expect(text).toContain('uv5r: ffmpeg exited 1 capturing from "AIOC Audio"');
    expect(text).toContain('remedy: ');
    expect(text).toContain('swept      2 entries, 2 s each');
    expect(text).toContain('slot 0     ');
  });

  it('puts one finished dwell in the error summary when the second dwell fails', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 2) throw new TransportError('audio-process-failed', 'ffmpeg exited 1 capturing from "AIOC Audio"');
      return heard(seconds, seconds);
    });
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    expect(errJson()).toEqual({
      type: 'error',
      kind: 'transport',
      reason: 'audio-process-failed',
      message: 'ffmpeg exited 1 capturing from "AIOC Audio"',
      remedy: 'check that --input names the AIOC input and the terminal has microphone access',
      retry: 'after-remedy',
      phase: 'dwell',
      slot: 0,
      channel: 2,
      requestedHz: 162_475_000,
      summary: {
        swept: 1,
        seconds: 2,
        input: 'AIOC Audio',
        active: [{ channel: 1, slot: 0, name: 'NOAA 1', requestedHz: 162_400_000, activeSeconds: 2 }],
        warnings: [],
        slot0: { channel: 2, name: 'NOAA 2' },
      },
    });
  });

  it('reports slot0 null in the error summary when an entry write fails', async () => {
    const radio = new FakeRadio();
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      // Corrupt every later slot 0 record write once the second entry's dwell starts.
      if (call++ === 2) radio.corruptWriteAt = 0x0000;
      return heard(seconds, seconds);
    });
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(stdout).toEqual([]);
    expect(errJson()).toMatchObject({
      reason: 'verification-failed',
      message: 'channel 0 did not take the write',
      phase: 'entry',
      slot: 0,
      channel: 3,
      requestedHz: 162_550_000,
      summary: { swept: 2, slot0: null },
    });
    expect(errJson()).not.toHaveProperty('written');
    expect(errJson()).not.toHaveProperty('recordWritten');
  });

  it('checks with the plan checkMhz', async () => {
    const radio = new FakeRadio();
    let checkRx = '';
    listenMock.mockImplementation(async (_device, seconds) => {
      if (checkRx === '') checkRx = Buffer.from(radio.eeprom.subarray(0, 4)).toString('hex');
      return heard(seconds, seconds);
    });
    await run(['sweep', planFile({ checkMhz: 162.55, channels: [{ channel: 9, rxMhz: 162.4, name: 'WX' }] }), '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(checkRx).toBe('00502516');
    expect(outJson()).toMatchObject({ swept: 1, slot0: { channel: 9, name: 'WX' } });
  });

  it('exits 5 with squelch-open before the check write when squelch is 0', async () => {
    const radio = new FakeRadio();
    radio.eeprom[0x0e20] = 0;
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(radio.writes).toEqual([]);
    expect(listenMock).not.toHaveBeenCalled();
    expect(errJson()).toMatchObject({
      reason: 'squelch-open',
      remedy: 'run uv5r settings squelch 3',
      phase: 'check',
      slot: 0,
      channel: null,
      requestedHz: 162_400_000,
      summary: { swept: 0, active: [], slot0: null },
    });
    expect(stdout).toEqual([]);
  });

  it('carries the checkMhz frequency in requestedHz when the check capture fails', async () => {
    listenMock.mockRejectedValue(new TransportError('audio-process-failed', 'ffmpeg exited 1 capturing from "AIOC Audio"'));
    await run(['sweep', planFile({ checkMhz: 162.55, channels: [{ channel: 9, rxMhz: 162.4, name: 'WX' }] }), '--seconds', '2', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'audio-process-failed', phase: 'check', slot: 0, channel: null, requestedHz: 162_550_000 });
  });

  it.each([
    ['a missing ffmpeg', { code: 'ENOENT' }, 'dependency-missing'],
    ['a failing ffmpeg', { code: 1 }, 'audio-process-failed'],
  ])('exits 3 on %s before opening the transport', async (_what, err, reason) => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(Object.assign(new Error('ffmpeg failed'), err), '', ''));
    const open = opener(new FakeRadio());
    await run([...SWEEP, '--json'], open);
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason });
    expect(errJson()).not.toHaveProperty('summary');
    expect(open.calls).toBe(0);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('leaves no --out-dir behind when ffmpeg is missing', async () => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(Object.assign(new Error('ffmpeg failed'), { code: 'ENOENT' }), '', ''));
    const parent = mkdtempSync(join(tmpdir(), 'uv5r-'));
    const dir = join(parent, 'new', 'wavs');
    await run([...SWEEP, '--out-dir', dir, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'dependency-missing' });
    expect(existsSync(join(parent, 'new'))).toBe(false);
    expect(existsSync(parent)).toBe(true);
  });

  it('exits 2 on an --out-dir it cannot write before opening the transport', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    chmodSync(dir, 0o555);
    try {
      const open = opener(new FakeRadio());
      await run([...SWEEP, '--out-dir', dir, '--json'], open);
      expect(process.exitCode).toBe(2);
      expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(`cannot write to ${dir}`), outDir: dir });
      expect(open.calls).toBe(0);
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it('keeps the check warnings in the summary with a check: prefix', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => (call++ === 0 ? heard(seconds, seconds, [CLIP_WARNING]) : heard(seconds, 0)));
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ swept: 7, active: [], warnings: [`check: ${CLIP_WARNING}`] });
  });

  it('keeps the check warnings in the error summary of a failed check', async () => {
    listenMock.mockResolvedValue(heard(5, 3, [CLIP_WARNING]));
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'audio-inactive', summary: { warnings: [`check: ${CLIP_WARNING}`] } });
  });

  it('reports --device in the summary', async () => {
    listenMock.mockImplementation(async (_device, seconds) => heard(seconds, seconds));
    await run([...SWEEP, '--input', '1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(listenMock.mock.calls.every((c) => c[0] === '1')).toBe(true);
    expect(outJson()).toMatchObject({ input: '1' });
  });

  it('names the AIOC input, squelch above 0 and the two channel names in help sweep', async () => {
    await cli(['help', 'sweep', '--json']);
    const help = JSON.parse(stdout.join('')) as { preconditions: string[]; effects: string[]; flags: { flag: string; help: string }[]; result: object };
    expect(help.preconditions).toEqual(expect.arrayContaining(['--input names the AIOC input.', 'Squelch is above 0.']));
    expect(help.flags.find((f) => f.flag === '--input')!.help).toContain('name the AIOC input');
    expect(help.effects).toContain('active[].name is the plan name. slot0.name is the name the radio holds, uppercased and cut to 7 characters. Match the two on channel.');
    expect(help.result).toMatchObject({ input: 'AIOC Audio' });
  });

  it('describes the one sweep mode in help sweep', async () => {
    await onTerminal(() => cli(['help', 'sweep']));
    const help = stdout.join('');
    expect(help).toContain('sweep channels.json --seconds 30');
    expect(help).toContain('checkMhz');
    expect(help).toMatch(/--out-dir DIR +keep each capture/);
    for (const word of ['knob', '--scratch', '--check', '--no-check']) expect(help).not.toContain(word);
  });

  it('leaves knob mode and its flags out of the overview', async () => {
    await cli(['help']);
    const help = stdout.join('');
    for (const word of ['--scratch', '--check', '--no-check']) expect(help).not.toContain(word);
    expect(help).not.toMatch(/(?<!volume |a )knob/);
  });
});

describe('runSweep', () => {
  const entries = readPlan(EXAMPLE_PLAN).entries;
  const options = { input: 'AIOC Audio', seconds: 2 };
  const idle: SweepSteps = { check: async () => {}, prepare: async () => {} };

  it('stops after the dwell in progress when a signal arrives and removes its handlers', async () => {
    const signals = new EventEmitter();
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 1) signals.emit('SIGTERM');
      return heard(seconds, 1);
    });
    const progress = newProgress();
    const summary = await runSweep(entries, idle, options, progress, signals);
    expect(summary).toMatchObject({ swept: 2, interrupted: 'SIGTERM' });
    expect(progress.dwells.map((r) => r.channel)).toEqual([1, 2]);
    expect(KEY_SIGNALS.reduce((n, s) => n + signals.listenerCount(s), 0)).toBe(0);
  });

  it('ends the wait in prepare when a signal arrives', async () => {
    const signals = new EventEmitter();
    listenMock.mockResolvedValue(heard(2, 0));
    const steps: SweepSteps = {
      check: async () => {},
      prepare: async (_entry, _progress, stop) => {
        signals.emit('SIGHUP');
        await stop.stopped;
      },
    };
    const summary = await runSweep(entries, steps, options, newProgress(), signals);
    expect(summary).toEqual({ swept: 0, seconds: 2, input: 'AIOC Audio', active: [], warnings: [], slot0: null, interrupted: 'SIGHUP' });
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('kills the dwell capture when a signal arrives instead of waiting out the dwell', async () => {
    const signals = new EventEmitter();
    listenMock.mockImplementation(async (_device, _seconds, _floor, opts) => {
      signals.emit('SIGTERM');
      await opts!.stop;
      throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
    });
    const summary = await runSweep(entries, idle, options, newProgress(), signals);
    expect(summary).toEqual({ swept: 0, seconds: 2, input: 'AIOC Audio', active: [], warnings: [], slot0: null, interrupted: 'SIGTERM' });
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock.mock.calls[0]![3]).toMatchObject({ stop: expect.any(Promise) });
  });

  it('kills the check capture when a signal arrives and keeps slot0 for the check record', async () => {
    const signals = new EventEmitter();
    listenMock.mockImplementation(async (_device, _seconds, _floor, opts) => {
      signals.emit('SIGTERM');
      await opts!.stop;
      throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
    });
    const done = runSweep(entries, slotZero(new FakeRadio(), { rxHz: 162_400_000 }, { input: 'AIOC Audio' }), options, newProgress(), signals);
    await vi.runAllTimersAsync();
    expect(await done).toEqual({ swept: 0, seconds: 2, input: 'AIOC Audio', active: [], warnings: [], slot0: { channel: null, name: '162.4' }, interrupted: 'SIGTERM' });
    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock.mock.calls[0]![3]).toMatchObject({ stop: expect.any(Promise) });
  });

  it('ends the entry settle at once on a signal and leaves no timer pending', async () => {
    const signals = new EventEmitter();
    listenMock.mockImplementation(async (_device, seconds) => heard(seconds, seconds));
    const progress = newProgress();
    const done = runSweep(entries, slotZero(new FakeRadio(), { rxHz: 162_400_000 }, { input: 'AIOC Audio' }), options, progress, signals);
    for (let i = 0; i < 1000 && progress.slot0?.channel !== entries[0]!.channel; i++) await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(1);
    const signalAt = Date.now();
    signals.emit('SIGINT');
    expect(await done).toMatchObject({ swept: 0, slot0: { channel: entries[0]!.channel }, interrupted: 'SIGINT' });
    expect(Date.now()).toBe(signalAt);
    expect(vi.getTimerCount()).toBe(0);
    expect(listenMock).toHaveBeenCalledTimes(1);
  });

  it('removes the part file of a dwell a signal cut short and keeps the finished WAVs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    const signals = new EventEmitter();
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds, _floor, opts) => {
      writeFileSync(opts!.out!, 'RIFF');
      if (call++ === 0) return heard(seconds, 1);
      signals.emit('SIGINT');
      await opts!.stop;
      throw new TransportError('audio-process-failed', 'ffmpeg killed after a signal to uv5r capturing from "AIOC Audio"');
    });
    const summary = await runSweep(entries, idle, { ...options, outDir: dir }, newProgress(), signals);
    expect(summary).toMatchObject({ swept: 1, interrupted: 'SIGINT', active: [{ channel: 1, out: expect.stringMatching(/\.wav$/) }] });
    expect(readdirSync(dir).map((f) => join(dir, f))).toEqual([summary.active[0]!.out]);
  });

  it('runs no entry when the check throws and leaves the dwells in progress', async () => {
    const prepare = vi.fn(async () => {});
    const progress = newProgress();
    const steps: SweepSteps = {
      check: async (p) => {
        p.slot0 = { channel: null, name: '162.4' };
        throw new TransportError('audio-process-failed', 'ffmpeg exited 1', { requestedHz: 162_400_000 });
      },
      prepare,
    };
    await expect(runSweep(entries, steps, options, progress, new EventEmitter())).rejects.toMatchObject({
      message: 'ffmpeg exited 1',
      detail: { phase: 'check', slot: 0, channel: null, requestedHz: 162_400_000 },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(progress).toEqual({ dwells: [], checkWarnings: [], slot0: { channel: null, name: '162.4' } });
  });
});

describe('dwell', () => {
  const entry = readPlan(EXAMPLE_PLAN).entries[0]!;
  const options = { input: 'AIOC Audio', seconds: 2 };

  it('captures to a part file and renames it to the captureName', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    listenMock.mockImplementation(async (_device, seconds, _floor, opts) => {
      writeFileSync(opts!.out!, 'RIFF');
      return { ...heard(seconds, 0), out: opts!.out! };
    });
    const record = await dwell(entry, { ...options, outDir: dir });
    expect(listenMock.mock.calls[0]![3]?.out).toBe(`${record.out}.part`);
    expect(record.out).toBe(join(dir, captureName(entry.channel, new Date())));
    expect(readdirSync(dir).map((f) => join(dir, f))).toEqual([record.out]);
  });

  it('removes the part file when the capture fails and rethrows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    listenMock.mockImplementation(async (_device, _seconds, _floor, opts) => {
      writeFileSync(opts!.out!, 'RIFF');
      throw new TransportError('capture-incomplete', 'ffmpeg captured 1 of 3 seconds from "AIOC Audio"');
    });
    await expect(dwell(entry, { ...options, outDir: dir })).rejects.toMatchObject({ reason: 'capture-incomplete' });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('rethrows the capture error when the part file cannot be removed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    listenMock.mockImplementation(async (_device, _seconds, _floor, opts) => {
      mkdirSync(opts!.out!);
      throw new TransportError('capture-incomplete', 'ffmpeg captured 1 of 3 seconds from "AIOC Audio"');
    });
    await expect(dwell(entry, { ...options, outDir: dir })).rejects.toMatchObject({ reason: 'capture-incomplete' });
  });

  it('keeps the part file and names it when the rename fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    let part = '';
    listenMock.mockImplementation(async (_device, seconds, _floor, opts) => {
      part = opts!.out!;
      writeFileSync(part, 'RIFF');
      mkdirSync(part.replace(/\.part$/, ''));
      return { ...heard(seconds, 0), out: part };
    });
    const err = await dwell(entry, { ...options, outDir: dir }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'transport', reason: 'file-write-failed', retry: 'after-remedy', detail: { part, out: part.replace(/\.part$/, ''), code: 'EISDIR' } });
    expect(existsSync(part)).toBe(true);
  });

  it('rethrows the capture error when ffmpeg wrote no part file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    listenMock.mockRejectedValue(new TransportError('audio-process-failed', 'ffmpeg exited with code 1 capturing from "AIOC Audio"'));
    await expect(dwell(entry, { ...options, outDir: dir })).rejects.toMatchObject({ reason: 'audio-process-failed' });
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('captureName', () => {
  it('names a capture by channel and local start time', () => {
    expect(captureName(7, new Date(2026, 9, 18, 0, 15, 0))).toBe('ch07-2026-10-18T00-15-00.wav');
    expect(captureName(127, new Date(2026, 9, 18, 13, 5, 9))).toBe('ch127-2026-10-18T13-05-09.wav');
  });
});
