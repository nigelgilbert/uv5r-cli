import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen, type ListenResult } from '../../src/cli/audio.ts';
import { SETTLE_MS, TransportError, magicByName } from '../../src/core/index.ts';
import { cli, type OpenTransport } from '../../src/cli/main.ts';
import { FakeRadio } from '../core/fake.ts';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
vi.mock('../../src/cli/audio.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/cli/audio.ts')>()), listen: vi.fn() }));

const listenMock = vi.mocked(listen);

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

/** Build a listen result with the given per-second activity. */
function heard(active: boolean[]): ListenResult {
  return {
    input: 'AIOC Audio',
    seconds: active.length,
    rmsDbfs: active.map((on) => (on ? -20 : -66)),
    zeroSeconds: 0,
    meanRmsDbfs: -30,
    peakDbfs: -6,
    active,
    activeSeconds: active.filter(Boolean).length,
    warnings: [],
  };
}

/** Run the CLI under fake timers until it finishes. */
async function run(argv: string[], open: OpenTransport): Promise<void> {
  const done = cli(argv, open);
  await vi.runAllTimersAsync();
  await done;
}

describe('check', () => {
  it('opens the check session with the magic UV5R_MAGIC names', async () => {
    vi.stubEnv('UV5R_MAGIC', 'UV82');
    const radio = new FakeRadio();
    radio.magics = [magicByName('UV82').bytes];
    listenMock.mockResolvedValue(heard([true, true, true, true, true]));
    await run(['check', '162.400', '--channel', '0', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.handshakes).toEqual(['50 bb ff 20 13 01 05']);
  });

  it('writes the slot, waits the settle, then listens', async () => {
    const radio = new FakeRadio();
    let lastSerialAt = 0;
    const write = radio.write.bind(radio);
    vi.spyOn(radio, 'write').mockImplementation((bytes) => {
      lastSerialAt = Date.now();
      write(bytes);
    });
    let writesAtListen: number[] = [];
    let listenAt = 0;
    listenMock.mockImplementation(async () => {
      writesAtListen = [...radio.writes];
      listenAt = Date.now();
      return heard([true, true, false, true, true]);
    });
    await run(['check', '162.400', '--channel', '0', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(writesAtListen).toEqual([0x0000, 0x1000]);
    expect(listenAt - lastSerialAt).toBeGreaterThanOrEqual(SETTLE_MS);
    expect(listenMock).toHaveBeenCalledWith('AIOC Audio', 5, -50);
    const out = outJson();
    expect(out).toMatchObject({ slot: 0, requestedHz: 162_400_000, activeSeconds: 4, active: [true, true, false, true, true] });
    expect(out).not.toHaveProperty('channel');
    expect(out).not.toHaveProperty('rxHz');
  });

  it.each([
    [[true, true, true, true, false], 0],
    [[true, false, true, false, true], 5],
  ])('needs 80%% of the seconds active: %j exits %i', async (active, exit) => {
    listenMock.mockResolvedValue(heard(active));
    await run(['check', '162.400', '--channel', '0', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(exit);
  });

  it('passes --input to listen with 5 s at -50 dBFS', async () => {
    listenMock.mockResolvedValue(heard([true, true, true, true, true]));
    await run(['check', '162.400', '--channel', '3', '--input', '1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(listenMock).toHaveBeenCalledWith('1', 5, -50);
    expect(outJson()).toMatchObject({ slot: 3, requestedHz: 162_400_000, activeSeconds: 5 });
  });

  it('writes a receive-only wide record with no RX tone, named by the frequency', async () => {
    const radio = new FakeRadio();
    listenMock.mockResolvedValue(heard([true, true, true, true, true]));
    await run(['check', '162.400', '--channel', '0', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    stdout = [];
    radio.dropSession();
    await run(['read', '0', '--json'], opener(radio));
    expect(outJson()).toMatchObject({ channel: 0, rxHz: 162_400_000, txHz: null, rxTone: 'none', bandwidth: 'wide', power: 'high', name: '162.4' });
  });

  it('exits 5 listing the causes when too few seconds are active', async () => {
    listenMock.mockResolvedValue(heard([true, false, true, false, true]));
    await run(['check', '162.400', '--channel', '0', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({
      reason: 'audio-inactive',
      remedy: 'ask the human to set MR mode and select slot 0',
      retry: 'after-remedy',
      message:
        'slot 0: 3 of 5 s active after writing 162.400 MHz, check needs 4; causes: VFO mode, another slot selected, volume knob down, plug unseated, quiet frequency; ask the human to set MR mode and select slot 0',
      slot: 0,
      requestedHz: 162_400_000,
      activeSeconds: 3,
    });
    expect(stdout).toEqual([]);
  });

  it.each([
    [['check', '--channel', '0'], 'frequency'],
    [['check', '162.400'], '--channel'],
    [['check', '162.400', '--channel', '0', '--floor', '-40'], 'unknown option --floor'],
    [['check', '162.400', '--channel', '0', '--rx-tone', '100.0'], 'unknown option --rx-tone'],
    [['check', '162.400', '--channel', '0', '--seconds', '5'], 'unknown option --seconds'],
    [['check', '162.400', '--channel', '0', '--narrow'], 'unknown option --narrow'],
    [['check', '162.400', '--channel', '0', '--low-power'], 'unknown option --low-power'],
    [['check', '162.400', '--channel', '0', '--name', 'WX'], 'unknown option --name'],
    [['check', '162.400', '--channel', '0', '--rx-only'], 'unknown option --rx-only'],
    [['check', '162.400', '--channel', '0', '--offset', '0.6'], '--offset'],
    [['check', '162.400', '--channel', '0', '--tone', '82.5'], '--tone'],
  ])('exits 2 on %j before opening the transport', async (argv, text) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(text) });
    expect(open.calls).toBe(0);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('exits 5 with squelch-open before the write when squelch is 0', async () => {
    const radio = new FakeRadio();
    radio.eeprom[0x0e20] = 0;
    await run(['check', '162.400', '--channel', '0', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'squelch-open', remedy: 'run uv5r settings squelch 3', retry: 'after-remedy', slot: 0, squelch: 0 });
    expect(radio.writes).toEqual([]);
    expect(listenMock).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
  });

  it.each([
    ['a missing ffmpeg', { code: 'ENOENT' }, 3, 'dependency-missing'],
    ['a failing ffmpeg', { code: 1 }, 3, 'audio-process-failed'],
  ])('exits 3 on %s before opening the transport', async (_what, err, exit, reason) => {
    execFile.mockImplementation((_file, _args, _opts, cb) => cb(Object.assign(new Error('ffmpeg failed'), err), '', ''));
    const open = opener(new FakeRadio());
    await run(['check', '162.400', '--channel', '0', '--json'], open);
    expect(process.exitCode).toBe(exit);
    expect(errJson()).toMatchObject({ reason });
    expect(execFile.mock.calls[0]!.slice(0, 2)).toEqual(['ffmpeg', ['-version']]);
    expect(open.calls).toBe(0);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('adds slot and requestedHz to a capture error after the write', async () => {
    const radio = new FakeRadio();
    listenMock.mockRejectedValue(new TransportError('capture-incomplete', 'ffmpeg captured 3 of 6 seconds from "AIOC Audio"', { input: 'AIOC Audio', captured: 3, requested: 6 }));
    await run(['check', '162.400', '--channel', '4', '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'capture-incomplete', slot: 4, requestedHz: 162_400_000, captured: 3, requested: 6 });
    expect(radio.writes).toEqual([0x0040, 0x1040]);
  });

  it('names the AIOC input and squelch above 0 in help check', async () => {
    await cli(['help', 'check', '--json']);
    const help = JSON.parse(stdout.join('')) as { preconditions: string[]; flags: { flag: string; help: string }[] };
    expect(help.preconditions).toEqual(expect.arrayContaining(['--input names the AIOC input.', 'Squelch is above 0.']));
    expect(help.flags.find((f) => f.flag === '--input')!.help).toContain('name the AIOC input');
  });

  it('prints the check example in help check', async () => {
    await cli(['help', 'check']);
    expect(stdout.join('')).toContain('check 162.400 --channel 0');
  });
});
