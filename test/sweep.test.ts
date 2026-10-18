import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen, type ListenResult } from '../src/audio.ts';
import { TransportError } from '../src/errors.ts';
import { cli, type OpenTransport } from '../src/main.ts';
import { readPlan } from '../src/plan.ts';
import { KEY_SIGNALS } from '../src/radio.ts';
import { captureName, runSweep, type DwellRecord } from '../src/sweep.ts';
import { FakeRadio } from './fake.ts';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('../src/audio.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/audio.ts')>()), listen: vi.fn() }));

const listenMock = vi.mocked(listen);
const EXAMPLE_PLAN = new URL('../channels.example.json', import.meta.url).pathname;
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
    device: 'AIOC Audio',
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

/** Answer the check listen with activity, then each sweep listen with `activity[i]` active seconds, echoing `out`. */
function listenSequence(activity: number[]): void {
  let call = 0;
  listenMock.mockImplementation(async (_device, seconds, _floor, options) => {
    const i = call++;
    if (i === 0) return heard(seconds, seconds);
    const result = heard(seconds, activity[i - 1] ?? 0);
    return options?.out === undefined ? result : { ...result, out: options.out };
  });
}

/** Run the CLI under fake timers until it finishes. */
async function run(argv: string[], open: OpenTransport): Promise<void> {
  const done = cli(argv, open);
  await vi.runAllTimersAsync();
  await done;
}

const SWEEP = ['sweep', EXAMPLE_PLAN, '--scratch', '0', '--check', '162.400', '--seconds', '2'];

describe('sweep --scratch', () => {
  it('writes each entry to the scratch slot in turn and prints one summary object', async () => {
    const radio = new FakeRadio();
    const writesAtListen: number[][] = [];
    listenSequence([2, 0, 1, 0, 0, 0, 0]);
    const answer = listenMock.getMockImplementation()!;
    listenMock.mockImplementation(async (...args) => {
      writesAtListen.push([...radio.writes]);
      return answer(...args);
    });
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    // The check and each of the seven entries write the slot 0 record and name.
    expect(radio.writes).toEqual(Array.from({ length: 8 }, () => [0x0000, 0x1000]).flat());
    expect(writesAtListen.map((w) => w.length)).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(listenMock.mock.calls[0]).toEqual(['AIOC Audio', 5, -50]);
    for (const call of listenMock.mock.calls.slice(1)) expect(call).toEqual(['AIOC Audio', 2, -50, { out: undefined, play: false }]);
    expect(stdout).toHaveLength(1);
    expect(outJson()).toEqual({
      swept: 7,
      seconds: 2,
      active: [
        { channel: 1, name: 'NOAA 1', rxMhz: '162.4', activeSeconds: 2 },
        { channel: 3, name: 'NOAA 3', rxMhz: '162.55', activeSeconds: 1 },
      ],
      warnings: [],
    });
    stdout = [];
    radio.dropSession();
    await run(['read', '0', '--json'], opener(radio));
    expect(outJson()).toMatchObject({ channel: 0, rxMhz: '154.695', txMhz: null, rxTone: '156.7', bandwidth: 'narrow', name: 'SHERIFF' });
  });

  it('skips the check with --no-check', async () => {
    const radio = new FakeRadio();
    listenMock.mockResolvedValue(heard(2, 0));
    await run(['sweep', EXAMPLE_PLAN, '--scratch', '0', '--no-check', '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(listenMock).toHaveBeenCalledTimes(7);
    expect(radio.writes).toHaveLength(14);
    expect(outJson()).toEqual({ swept: 7, seconds: 2, active: [], warnings: [] });
  });

  it('dwells 30 s by default', async () => {
    listenMock.mockResolvedValue(heard(30, 0));
    await run(['sweep', EXAMPLE_PLAN, '--scratch', '0', '--no-check', '--json'], opener(new FakeRadio()));
    expect(listenMock.mock.calls.map((c) => c[1])).toEqual(Array(7).fill(30));
    expect(outJson()).toMatchObject({ seconds: 30 });
  });

  it('exits 5 on a silent check before writing any entry', async () => {
    const radio = new FakeRadio();
    listenMock.mockResolvedValue(heard(5, 0));
    await run([...SWEEP, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ kind: 'device-state', message: 'no audio on channel 0: set MR mode and select 0' });
    expect(radio.writes).toEqual([0x0000, 0x1000]);
    expect(stdout).toEqual([]);
  });

  it.each([
    ['neither --check nor --no-check', ['sweep', EXAMPLE_PLAN, '--scratch', '0'], '--no-check'],
    ['both --check and --no-check', ['sweep', EXAMPLE_PLAN, '--scratch', '0', '--check', '162.400', '--no-check'], 'conflict'],
    ['--no-check without --scratch', ['sweep', EXAMPLE_PLAN, '--no-check'], '--check and --no-check need --scratch N'],
    ['--check without --scratch', ['sweep', EXAMPLE_PLAN, '--check', '162.400'], '--check and --no-check need --scratch N'],
    ['--play without --out-dir', ['sweep', EXAMPLE_PLAN, '--scratch', '0', '--no-check', '--play'], '--out-dir'],
    ['a fractional --seconds', ['sweep', EXAMPLE_PLAN, '--scratch', '0', '--no-check', '--seconds', '2.5'], '--seconds'],
    ['a scratch slot past 127', ['sweep', EXAMPLE_PLAN, '--scratch', '128', '--no-check'], '128'],
  ])('exits 2 on %s before opening the transport', async (_what, argv, text) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ kind: 'usage', message: expect.stringContaining(text) });
    expect(open.calls).toBe(0);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('writes one stderr line per entry with --verbose and leaves stdout as one object', async () => {
    listenSequence([2, 0, 0, 0, 0, 0, 0]);
    await run([...SWEEP, '--verbose', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const lines = stderr.join('').trim().split('\n');
    expect(lines).toHaveLength(7);
    const records = lines.map((line) => JSON.parse(line) as DwellRecord);
    expect(records.map((r) => r.channel)).toEqual(PLAN_CHANNELS);
    expect(records[0]).toMatchObject({ channel: 1, name: 'NOAA 1', rxMhz: '162.4', activeSeconds: 2, active: [true, true], warnings: [] });
    expect(stdout).toHaveLength(1);
    expect(outJson()).toMatchObject({ swept: 7 });
  });

  it('keeps one WAV per entry named by channel with --out-dir and creates the directory', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'rx');
    listenSequence([2, 0, 0, 0, 0, 0, 1]);
    await run([...SWEEP, '--out-dir', dir, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(existsSync(dir)).toBe(true);
    const outs = listenMock.mock.calls.slice(1).map((c) => c[3]?.out);
    expect(outs).toHaveLength(7);
    outs.forEach((out, i) => expect(out).toMatch(new RegExp(`^${dir}/ch0${PLAN_CHANNELS[i]}-\\d{4}-\\d\\d-\\d\\dT\\d\\d-\\d\\d-\\d\\d\\.wav$`)));
    expect(outJson()).toMatchObject({
      active: [
        { channel: 1, activeSeconds: 2, out: outs[0] },
        { channel: 7, activeSeconds: 1, out: outs[6] },
      ],
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it('plays only the active captures through afplay with --play', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    listenSequence([0, 2, 0, 1, 0, 0, 0]);
    await run([...SWEEP, '--out-dir', dir, '--play', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const outs = listenMock.mock.calls.slice(1).map((c) => c[3]?.out);
    expect(listenMock.mock.calls.slice(1).every((c) => c[3]?.play === false)).toBe(true);
    expect(execFile.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['afplay', [outs[1]]],
      ['afplay', [outs[3]]],
    ]);
  });

  it('tags each warning with its plan channel', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => (call++ === 4 ? heard(seconds, 2, ['input clips: turn the volume knob down']) : heard(seconds, 1)));
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(outJson()).toMatchObject({ warnings: ['channel 4: input clips: turn the volume knob down'] });
  });

  it('prints the summary for the finished entries and exits 130 on SIGINT', async () => {
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 3) {
        process.emit('SIGINT');
        throw new TransportError('ffmpeg stopped on SIGINT capturing from "AIOC Audio"');
      }
      return heard(seconds, 1);
    });
    const before = process.listenerCount('SIGINT');
    await run([...SWEEP, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(130);
    expect(stdout).toHaveLength(1);
    expect(outJson()).toMatchObject({ swept: 2, interrupted: 'SIGINT', active: [{ channel: 1 }, { channel: 2 }] });
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('lists sweep in the help text', async () => {
    await cli(['help']);
    const help = stdout.join('');
    expect(help).toContain('sweep channels.json --seconds 30');
    expect(help).toContain('sweep channels.json --scratch 0 --check 162.400');
    expect(help).toContain('knob mode');
    expect(help).toMatch(/--out-dir DIR .*sweep/);
  });
});

const KNOB_PROMPT = /^turn the knob to channel (\d+) \((.+)\) and press Enter\n$/;

/** Replace stdin with a stream; a TTY one answers each knob prompt on stderr with a line. */
function stubStdin(isTTY: boolean): PassThrough {
  const stdin = Object.assign(new PassThrough(), { isTTY });
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);
  vi.mocked(process.stderr.write).mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    if (isTTY && KNOB_PROMPT.test(String(chunk))) setImmediate(() => stdin.write('\n'));
    return true;
  });
  return stdin;
}

/** Return a fake with the example plan loaded through the CLI and its session dropped. */
async function loadedRadio(): Promise<FakeRadio> {
  const radio = new FakeRadio();
  await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
  expect(process.exitCode).toBe(0);
  radio.dropSession();
  stdout = [];
  stderr = [];
  process.exitCode = undefined;
  return radio;
}

const prompts = () => stderr.filter((line) => KNOB_PROMPT.test(line));

describe('sweep in knob mode', () => {
  it('prompts once per entry, dwells after each Enter and prints one summary object', async () => {
    const radio = await loadedRadio();
    stubStdin(true);
    const promptsAtListen: number[] = [];
    listenMock.mockImplementation(async (_device, seconds) => {
      promptsAtListen.push(prompts().length);
      return heard(seconds, promptsAtListen.length === 2 ? 1 : 0);
    });
    await run(['sweep', EXAMPLE_PLAN, '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(prompts().map((line) => line.match(KNOB_PROMPT)!.slice(1))).toEqual([
      ['1', 'NOAA 1'],
      ['2', 'NOAA 2'],
      ['3', 'NOAA 3'],
      ['4', 'BIG SKY'],
      ['5', '2M CALL'],
      ['6', 'GMRS 20'],
      ['7', 'SHERIFF'],
    ]);
    expect(promptsAtListen).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const call of listenMock.mock.calls) expect(call).toEqual(['AIOC Audio', 2, -50, { out: undefined, play: false }]);
    expect(stdout).toHaveLength(1);
    expect(outJson()).toEqual({ swept: 7, seconds: 2, active: [{ channel: 2, name: 'NOAA 2', rxMhz: '162.475', activeSeconds: 1 }], warnings: [] });
  });

  it('leaves the radio memory byte-identical', async () => {
    const radio = await loadedRadio();
    const before = Uint8Array.from(radio.eeprom);
    const writes = radio.writes.length;
    stubStdin(true);
    listenMock.mockResolvedValue(heard(2, 1));
    await run(['sweep', EXAMPLE_PLAN, '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.writes).toHaveLength(writes);
    expect(Buffer.from(radio.eeprom).equals(Buffer.from(before))).toBe(true);
  });

  it('exits 5 before any prompt when a slot differs from the plan, naming the channel, both records and load', async () => {
    const radio = await loadedRadio();
    await run(['tune', '146.550', '--channel', '5', '--name', '2M CALL', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    radio.dropSession();
    stdout = [];
    process.exitCode = undefined;
    stubStdin(true);
    await run(['sweep', EXAMPLE_PLAN, '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(prompts()).toEqual([]);
    expect(listenMock).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    const plan = { channel: 5, rxMhz: '146.52', txMhz: '146.52', txTone: 'none', rxTone: 'none', bandwidth: 'wide', power: 'high', name: '2M CALL' };
    const body = errJson();
    expect(body).toMatchObject({ kind: 'device-state', channel: 5, plan, radio: { ...plan, rxMhz: '146.55', txMhz: '146.55' }, differ: [5] });
    expect(body.message).toMatch(/^channel 5 differs from the plan: plan \{.*"rxMhz":"146.52".*\}, radio \{.*"rxMhz":"146.55".*\}; run uv5r load .*channels.example.json to write the plan$/);
  });

  it('exits 5 on an empty slot', async () => {
    const radio = new FakeRadio();
    stubStdin(true);
    await run(['sweep', EXAMPLE_PLAN, '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ channel: 1, radio: { channel: 1, empty: true }, differ: PLAN_CHANNELS });
    expect(prompts()).toEqual([]);
  });

  it('exits 2 naming --scratch on piped stdin before opening the transport', async () => {
    stubStdin(false);
    const open = opener(new FakeRadio());
    await run(['sweep', EXAMPLE_PLAN, '--seconds', '2', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ kind: 'usage', message: expect.stringContaining('--scratch N') });
    expect(open.calls).toBe(0);
  });

  it('ends the wait at a prompt on SIGINT and prints the summary so far', async () => {
    const radio = await loadedRadio();
    const stdin = stubStdin(true);
    vi.mocked(process.stderr.write).mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      if (KNOB_PROMPT.test(String(chunk))) setImmediate(() => (prompts().length < 3 ? stdin.write('\n') : process.emit('SIGINT')));
      return true;
    });
    listenMock.mockImplementation(async (_device, seconds) => heard(seconds, 1));
    await run(['sweep', EXAMPLE_PLAN, '--seconds', '2', '--json'], opener(radio));
    expect(process.exitCode).toBe(130);
    expect(outJson()).toMatchObject({ swept: 2, interrupted: 'SIGINT' });
  });
});

describe('runSweep', () => {
  const entries = readPlan(EXAMPLE_PLAN).entries;
  const options = { device: 'AIOC Audio', seconds: 2, floorDbfs: -50, play: false };

  it('stops after the dwell in progress when a signal arrives and removes its handlers', async () => {
    const signals = new EventEmitter();
    let call = 0;
    listenMock.mockImplementation(async (_device, seconds) => {
      if (call++ === 1) signals.emit('SIGTERM');
      return heard(seconds, 1);
    });
    const records: DwellRecord[] = [];
    const summary = await runSweep(entries, async () => {}, options, (r) => records.push(r), signals);
    expect(summary).toMatchObject({ swept: 2, interrupted: 'SIGTERM' });
    expect(records.map((r) => r.channel)).toEqual([1, 2]);
    expect(KEY_SIGNALS.reduce((n, s) => n + signals.listenerCount(s), 0)).toBe(0);
  });

  it('ends the wait in prepare when a signal arrives', async () => {
    const signals = new EventEmitter();
    listenMock.mockResolvedValue(heard(2, 0));
    const summary = await runSweep(
      entries,
      async (_entry, stop) => {
        signals.emit('SIGHUP');
        await stop.stopped;
      },
      options,
      () => {},
      signals,
    );
    expect(summary).toEqual({ swept: 0, seconds: 2, active: [], warnings: [], interrupted: 'SIGHUP' });
    expect(listenMock).not.toHaveBeenCalled();
  });
});

describe('captureName', () => {
  it('names a capture by channel and local start time', () => {
    expect(captureName(7, new Date(2026, 9, 18, 0, 15, 0))).toBe('ch07-2026-10-18T00-15-00.wav');
    expect(captureName(127, new Date(2026, 9, 18, 13, 5, 9))).toBe('ch127-2026-10-18T13-05-09.wav');
  });
});
