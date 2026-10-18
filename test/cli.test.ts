import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportError } from '../src/errors.ts';
import { cli, type OpenTransport } from '../src/main.ts';
import type { Transport } from '../src/transport.ts';
import { FakeRadio } from './fake.ts';

const FIXTURE = new URL('../fixtures/uv5r-hn5rv011-2026-10-12.img', import.meta.url).pathname;
const EXAMPLE_PLAN = new URL('../channels.example.json', import.meta.url).pathname;

let stdout: string[];
let stderr: string[];
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => stdout.push(String(chunk)) > 0);
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => stderr.push(String(chunk)) > 0);
  exit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

/** Record each open and hand back the given transport, or fail as a missing device. */
function opener(transport?: Transport): OpenTransport & { calls: number } {
  const open = Object.assign(
    async (target: string | undefined) => {
      open.calls++;
      if (!transport) throw new TransportError(`no device at ${target}`);
      return transport;
    },
    { calls: 0 },
  );
  return open;
}

const outJson = () => JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
const errJson = () => JSON.parse(stderr.join('').trim()) as { kind: string; message: string };

describe('cli exit status', () => {
  it('sets exitCode 0 on success and leaves process.exit alone', async () => {
    await cli(['help']);
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toContain('exit codes:');
    expect(exit).not.toHaveBeenCalled();
  });

  it('sets exitCode 2 on a usage error and leaves process.exit alone', async () => {
    await cli(['read', '5', '6', '--json'], opener());
    expect(process.exitCode).toBe(2);
    expect(errJson().kind).toBe('usage');
    expect(exit).not.toHaveBeenCalled();
  });

  it('sets exitCode 3 on a transport error and leaves process.exit alone', async () => {
    await cli(['status', '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(errJson().kind).toBe('transport');
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('extra positionals', () => {
  it.each([
    ['dump', 'radio.img'],
    ['tune', '146.82', '5', '--channel', '7'],
    ['read', '5', '6'],
    ['erase', '5', '6'],
    ['status', 'now'],
    ['key', '2', '--seconds', '1'],
    ['restore', 'a.img', 'b.img', '--force'],
    ['load', 'a.json', 'b.json'],
    ['listen', '5', '--seconds', '5'],
  ])('rejects %s with exit 2 before opening the transport', async (...argv) => {
    const open = opener(new FakeRadio());
    await cli([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toContain('unexpected argument');
    expect(open.calls).toBe(0);
  });
});

describe('tune input checks', () => {
  it('accepts a negative offset and writes the TX frequency', async () => {
    await cli(['tune', '146.82', '--channel', '5', '--offset', '-0.6', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ channel: 5, rxMhz: '146.82', txMhz: '146.22' });
  });

  it('rejects an offset finer than 10 Hz before opening the transport', async () => {
    const open = opener(new FakeRadio());
    await cli(['tune', '146.82', '--channel', '5', '--offset', '-0.6000049', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toBe('--offset -0.6000049 is finer than 10 Hz');
    expect(open.calls).toBe(0);
  });

  it('writes a receive-only channel with --rx-only', async () => {
    await cli(['tune', '155.475', '--channel', '5', '--rx-only', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ channel: 5, rxMhz: '155.475', txMhz: null });
  });

  it('rejects --rx-only with --offset before opening the transport', async () => {
    const open = opener(new FakeRadio());
    await cli(['tune', '146.82', '--channel', '5', '--rx-only', '--offset', '-0.6', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toContain('--rx-only');
    expect(errJson().message).toContain('--offset');
    expect(open.calls).toBe(0);
  });

  it('rejects a non-ASCII name before opening the transport', async () => {
    const open = opener(new FakeRadio());
    await cli(['tune', '146.82', '--channel', '5', '--name', 'CAFÉ', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().kind).toBe('usage');
    expect(open.calls).toBe(0);
  });
});

describe('restore input checks', () => {
  it('rejects a short image before opening the transport', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'short.img');
    writeFileSync(file, new Uint8Array(100));
    const open = opener(new FakeRadio());
    await cli(['restore', file, '--force', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toContain('image too short');
    expect(open.calls).toBe(0);
  });
});

describe('restore verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run the CLI under fake timers until it finishes. */
  async function run(argv: string[], open: OpenTransport): Promise<void> {
    const done = cli(argv, open);
    await vi.runAllTimersAsync();
    await done;
  }

  it('reports the channel and name blocks it read back', async () => {
    await run(['restore', FIXTURE, '--force', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ file: FIXTURE, blocks: 382, verifiedBlocks: 64 });
  });

  it('exits 5 naming the address when the radio drops name writes', async () => {
    const radio = new FakeRadio();
    radio.eeprom.fill(0, 0x1000, 0x1800);
    radio.writesIgnoredBelow = 0x1000;
    radio.writesIgnoredAbove = 0x1800;
    await run(['restore', FIXTURE, '--force', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ kind: 'device-state', message: 'restore did not take 128 blocks; first at 0x1000' });
    expect(stdout).toEqual([]);
  });
});

describe('key output', () => {
  it('reports the measured hold when the timer fires late', async () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, (ms ?? 0) + 400)) as typeof setTimeout);
    await cli(['key', '--seconds', '0.1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const out = outJson();
    expect(out.keyed).toBe(true);
    expect(out.seconds).toBeGreaterThanOrEqual(0.5);
  });
});

describe('load', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Run the CLI under fake timers until it finishes. */
  async function run(argv: string[], open: OpenTransport): Promise<void> {
    const done = cli(argv, open);
    await vi.runAllTimersAsync();
    await done;
  }

  /** Write `plan` to a temp file and return its path. */
  function planFile(plan: object): string {
    const file = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'plan.json');
    writeFileSync(file, JSON.stringify(plan));
    return file;
  }

  /** Return a fake radio holding the channel records and names of the bench fixture. */
  function fixtureRadio(): FakeRadio {
    const radio = new FakeRadio();
    const image = readFileSync(FIXTURE);
    radio.eeprom.set(image.subarray(8, 8 + 0x0800), 0x0000);
    radio.eeprom.set(image.subarray(8 + 0x1000, 8 + 0x1800), 0x1000);
    return radio;
  }

  it('writes the example plan and each slot reads back the returned record', async () => {
    const radio = fixtureRadio();
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    const records = JSON.parse(stdout.join('').trim()) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(7);
    expect(records.map((r) => r.channel)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(records.every((r) => r.appliesAfterSeconds === 3)).toBe(true);
    expect(records[3]).toMatchObject({ channel: 4, rxMhz: '146.82', txMhz: '146.22', txTone: '82.5', name: 'BIG SKY' });
    expect(records[6]).toMatchObject({ channel: 7, rxMhz: '154.695', txMhz: null, bandwidth: 'narrow', name: 'SHERIFF' });
    for (const { appliesAfterSeconds: _, ...record } of records) {
      stdout = [];
      radio.dropSession();
      await run(['read', String(record.channel), '--json'], opener(radio));
      expect(process.exitCode).toBe(0);
      expect(outJson()).toEqual(record);
    }
  });

  it('leaves slots outside the plan byte-identical', async () => {
    const radio = fixtureRadio();
    const before = Uint8Array.from(radio.eeprom);
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    const planned = new Set([1, 2, 3, 4, 5, 6, 7]);
    for (let n = 0; n < 128; n++) {
      if (planned.has(n)) continue;
      for (const base of [0x0000, 0x1000]) {
        const at = base + n * 16;
        expect(radio.eeprom.subarray(at, at + 16), `slot ${n} at 0x${at.toString(16)}`).toEqual(before.subarray(at, at + 16));
      }
    }
  });

  it.each([
    [{ channel: 4, rxMhz: 146.82, tone: '82.6' }, 'plan channel 4, tone', 'tone'],
    [{ channel: 200, rxMhz: 146.82 }, 'plan channel 200, channel', 'channel'],
  ])('rejects %j with exit 2 before opening the transport', async (entry, prefix, field) => {
    const open = opener(new FakeRadio());
    await run(['load', planFile({ channels: [{ channel: 1, rxMhz: 162.4 }, entry] }), '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ kind: 'usage', channel: entry.channel, field });
    expect(errJson().message).toContain(prefix);
    expect(open.calls).toBe(0);
  });

  it('exits 5 naming the channel whose write the radio corrupts', async () => {
    const radio = new FakeRadio();
    radio.corruptWriteAt = 0x0000 + 5 * 16;
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ kind: 'device-state', message: 'channel 5 did not take the write' });
    expect(stdout).toEqual([]);
  });

  it('prints one channel line per entry as text', async () => {
    await run(['load', EXAMPLE_PLAN, '--text'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const lines = stdout.join('').trim().split('\n');
    expect(lines).toHaveLength(7);
    expect(lines[3]).toBe('ch 4: rx 146.82 tx 146.22 tone 82.5 rx-tone none wide high BIG SKY');
  });
});
