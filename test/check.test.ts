import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen, type ListenResult } from '../src/audio.ts';
import { cli, type OpenTransport } from '../src/main.ts';
import { SETTLE_MS } from '../src/protocol.ts';
import { FakeRadio } from './fake.ts';

vi.mock('../src/audio.ts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/audio.ts')>()), listen: vi.fn() }));

const listenMock = vi.mocked(listen);

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
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

/** Build a listen result with the given per-second activity. */
function heard(active: boolean[]): ListenResult {
  return {
    device: 'AIOC Audio',
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
      return heard([false, true, true, false, true]);
    });
    await run(['check', '162.400', '--channel', '0', '--rx-only', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(writesAtListen).toEqual([0x0000, 0x1000]);
    expect(listenAt - lastSerialAt).toBeGreaterThanOrEqual(SETTLE_MS);
    expect(listenMock).toHaveBeenCalledWith('AIOC Audio', 5, -50);
    expect(outJson()).toMatchObject({ channel: 0, rxMhz: '162.4', activeSeconds: 3, active: [false, true, true, false, true] });
  });

  it('passes --seconds, --device and --floor to listen', async () => {
    listenMock.mockResolvedValue(heard([true, true]));
    await run(['check', '162.400', '--channel', '3', '--seconds', '2', '--device', '1', '--floor', '-40', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(listenMock).toHaveBeenCalledWith('1', 2, -40);
    expect(outJson()).toMatchObject({ channel: 3, rxMhz: '162.4', activeSeconds: 2 });
  });

  it('exits 5 with the MR mode message when the channel is silent', async () => {
    listenMock.mockResolvedValue(heard([false, false, false, false, false]));
    await run(['check', '162.400', '--channel', '0', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({
      kind: 'device-state',
      message: 'no audio on channel 0: set MR mode and select 0',
      channel: 0,
      rxMhz: '162.4',
      activeSeconds: 0,
    });
    expect(stdout).toEqual([]);
  });

  it.each([
    [['check', '--channel', '0']],
    [['check', '162.400']],
    [['check', '162.400', '--channel', '0', '--seconds', '2.5']],
  ])('exits 2 on %j before opening the transport', async (argv) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().kind).toBe('usage');
    expect(open.calls).toBe(0);
    expect(listenMock).not.toHaveBeenCalled();
  });

  it('lists check in the help text', async () => {
    await cli(['help']);
    expect(stdout.join('')).toContain('check 162.400 --channel 0');
  });
});
