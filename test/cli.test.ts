import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeChannel } from '../src/codec.ts';
import { BusyError, REASONS, TransportError } from '../src/errors.ts';
import { cli, type OpenTransport } from '../src/main.ts';
import type { Transport } from '../src/transport.ts';
import { FakeRadio } from './fake.ts';

const FIXTURE = new URL('../fixtures/uv5r-hn5rv011-2026-10-12.img', import.meta.url).pathname;
const README = new URL('../README.md', import.meta.url).pathname;
const SKILL = new URL('../.claude/skills/uv5r/SKILL.md', import.meta.url).pathname;
const PACKAGE = new URL('../package.json', import.meta.url).pathname;
const CHANNEL_RULE =
  '`--channel N` writes memory slot N. The radio receives slot N after the reload when it is in MR mode with N selected on the active display line. ' +
  'The display may show a name or a frequency. The CLI cannot read the display, so ask the human when it matters which channel the radio is on.';
const EXAMPLE_PLAN = new URL('../channels.example.json', import.meta.url).pathname;
const REASON_ENUM = [
  'device-unavailable',
  'serial-io-failed',
  'ptt-control-failed',
  'dependency-missing',
  'audio-process-failed',
  'capture-incomplete',
  'file-write-failed',
  'session-unavailable',
  'protocol-reply-invalid',
  'write-unacknowledged',
  'verification-failed',
  'image-incompatible',
  'audio-inactive',
  'squelch-open',
  'invalid-argument',
  'device-busy',
  'serial-timeout',
  'unexpected-error',
];

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
      if (!transport) throw new TransportError('device-unavailable', `no device at ${target}`);
      return transport;
    },
    { calls: 0 },
  );
  return open;
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

const outJson = () => JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
const errJson = () => JSON.parse(stderr.join('').trim()) as Record<string, any>;

describe('cli exit status', () => {
  it('sets exitCode 0 on success and leaves process.exit alone', async () => {
    await onTerminal(() => cli(['help']));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toContain('exit codes:');
    expect(exit).not.toHaveBeenCalled();
  });

  it('sets exitCode 2 on a usage error and leaves process.exit alone', async () => {
    await cli(['read', '5', '6', '--json'], opener());
    expect(process.exitCode).toBe(2);
    expect(errJson().reason).toBe('invalid-argument');
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints reason unexpected-error and exits 1 on an error the CLI has no reason for', async () => {
    const open: OpenTransport = async () => {
      throw new RangeError('boom');
    };
    await cli(['status', '--json'], open);
    expect(process.exitCode).toBe(1);
    expect(errJson()).toEqual({ reason: 'unexpected-error', message: 'boom', remedy: 'report the message to the human', retry: 'no' });
  });

  it('prints the remedy and retry value under the message as text on a terminal', async () => {
    await onTerminal(() => cli(['status'], opener()));
    expect(process.exitCode).toBe(3);
    expect(stderr.join('')).toMatch(/^uv5r: no device at .*\nremedy: ask the human to reseat the AIOC cable, or pass --target PATH \(retry: after-remedy\)\n$/);
  });

  it('sets exitCode 3 on a transport error and leaves process.exit alone', async () => {
    await cli(['status', '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(errJson().reason).toBe('device-unavailable');
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('help', () => {
  /** Run `help` with `argv` and parse its one-line JSON. */
  async function helpJson(...argv: string[]): Promise<Record<string, any>> {
    await cli(['help', ...argv, '--json']);
    expect(process.exitCode).toBe(0);
    const out = stdout.join('');
    expect(out.trim().split('\n')).toHaveLength(1);
    return JSON.parse(out) as Record<string, any>;
  }

  it('prints help tune --json with usage, flags, effects, preconditions, writes, result and exits', async () => {
    const tune = await helpJson('tune');
    expect(tune).toMatchObject({ schemaVersion: 2, verb: 'tune', example: 'uv5r tune 154.680 --channel 5 --tone 82.5' });
    expect(tune.usage).toMatch(/^uv5r tune FREQ --channel N \[--offset MHZ\]/);
    expect(tune.flags).toContainEqual({ flag: '--channel', value: 'N', required: true, default: null, help: expect.any(String) });
    expect(tune.flags).toContainEqual(expect.objectContaining({ flag: '--rx-tone', default: 'none' }));
    expect(tune.flags).toContainEqual(expect.objectContaining({ flag: '--narrow', value: null, default: false }));
    expect(tune.effects.length).toBeGreaterThan(0);
    expect(tune.preconditions).toContain(CHANNEL_RULE);
    expect(tune.writesToRadio).toEqual({ writes: true, note: expect.any(String) });
    expect(tune.result).toMatchObject({ channel: 5, rxMhz: '154.68', appliesAfterSeconds: 3 });
    expect(tune.exits).toEqual([]);
  });

  it('lists only the verb-specific exit cases in help VERB --json', async () => {
    const status = await helpJson('status');
    expect(status.exits).toEqual([]);
    expect(status.exitsNote).toBe('exits lists verb-specific notes on the codes in exitCodes in uv5r help --json; empty means none');
    stdout = [];
    const check = await helpJson('check');
    expect(check.exits.map((e: { code: number }) => e.code)).toEqual([3, 5]);
    expect(check.exits[1].when).toContain('fewer than 80% of the seconds active');
  });

  it('prints help VERB with no exit section when the global table covers the verb', async () => {
    await onTerminal(() => cli(['help', 'status']));
    expect(stdout.join('')).not.toContain('exit codes');
    stdout = [];
    await onTerminal(() => cli(['help', 'check']));
    expect(stdout.join('')).toContain('exit codes beyond uv5r help:\n  3  a short capture\n');
  });

  it('prints help --json with the schema version, rules, exit-code guidance and flag defaults', async () => {
    const help = await helpJson();
    expect(help.schemaVersion).toBe(2);
    expect(help.version).toBe('0.1.0');
    expect(help.rules).toEqual({
      checkFirst: expect.stringContaining('check 162.400 --channel 0'),
      scratchSlot: expect.stringContaining('Slot 0'),
      channel: CHANNEL_RULE,
      oneVerb: 'Run one verb at a time. Do not open, cat, screen or stty the serial port.',
      clone: 'The receiver is deaf during a clone session. Back-to-back verbs take about 3 s longer for the handshake retry.',
      speaker:
        'The radio speaker is silent while the AIOC is plugged in. The human hears receive audio only through listen --seconds 5 --out FILE --play or by playing the WAVs in sweep --out-dir DIR after the run.',
    });
    expect(Object.keys(help.exitCodes)).toEqual(['0', '1', '2', '3', '4', '5', '6', '128+signal']);
    expect(help.errors.format).toContain('reason');
    expect(help.errors.format).toContain('remedy');
    expect(help.errors.format).toContain('when output is JSON, piped or with --json');
    expect(help.errors.format).toContain('On a terminal it prints the message and a remedy line as text.');
    expect(help.errors.format).toContain(
      'On SIGINT, SIGTERM or SIGHUP once key or sweep has opened the port, the verb prints its result on stdout with interrupted and no error, and exits 128 plus the signal number.',
    );
    expect(help.errors.format).toContain('A failed PTT release after the signal exits 3 with interrupted in the error.');
    expect(help.errors.format).toContain('An error inside the sweep loop adds phase (check, entry or dwell), slot (0) and channel (the plan channel, null during the check).');
    expect(Object.keys(help.errors.reasons)).toEqual(REASON_ENUM);
    for (const line of Object.values(help.errors.reasons)) expect(line).toMatch(/^exit \d: /);
    expect(Object.keys(help.errors.retry)).toEqual(['no', 'once', 'after-remedy']);
    for (const text of Object.values(help.exitCodes)) expect(text).not.toMatch(/retry/i);
    expect(Object.keys(help.verbs)).toEqual(['status', 'tune', 'check', 'load', 'read', 'erase', 'key', 'dump', 'restore', 'settings', 'listen', 'sweep']);
    const flag = (verb: string, name: string) => help.verbs[verb].flags.find((f: { flag: string }) => f.flag === name);
    expect(help.verbs.check.flags.map((f: { flag: string }) => f.flag)).toEqual(['--channel', '--device', '--json', '--target']);
    expect(flag('sweep', '--seconds').default).toBe(30);
    expect(flag('listen', '--floor').default).toBe(-50);
    expect(flag('listen', '--device').default).toBe('AIOC Audio');
    for (const verb of Object.values(help.verbs) as Array<Record<string, unknown>>) {
      for (const key of ['usage', 'flags', 'effects', 'preconditions', 'writesToRadio', 'result', 'exits', 'exitsNote']) expect(verb).toHaveProperty(key);
    }
  });

  it('prints the same entry for help VERB, VERB --help and VERB -h', async () => {
    await onTerminal(() => cli(['help', 'tune']));
    const viaHelp = stdout.join('');
    expect(viaHelp).toContain('usage:   uv5r tune FREQ --channel N');
    expect(viaHelp).toContain(CHANNEL_RULE);
    for (const argv of [['tune', '--help'], ['tune', '-h'], ['tune', '-h', '--help']]) {
      stdout = [];
      await onTerminal(() => cli(argv, opener()));
      expect(process.exitCode).toBe(0);
      expect(stdout.join('')).toBe(viaHelp);
    }
  });

  it('prints the overview for -h', async () => {
    await onTerminal(() => cli(['-h']));
    expect(process.exitCode).toBe(0);
    const help = stdout.join('');
    expect(help).toContain('run uv5r help VERB');
    expect(help).toContain('exit codes:');
  });

  it('prints the package version for --version', async () => {
    const { version } = JSON.parse(readFileSync(PACKAGE, 'utf8')) as { version: string };
    expect(version).toBe('0.1.0');
    await onTerminal(() => cli(['--version']));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${version}\n`);
    stdout = [];
    await cli(['--version']);
    expect(outJson()).toEqual({ version });
  });

  it('prints help and help VERB as JSON when stdout is a pipe', async () => {
    await cli(['help']);
    expect(outJson().exitCodes).toMatchObject({ '4': 'timeout: no ack before a block read, or a short block payload' });
    stdout = [];
    await cli(['help', 'tune']);
    expect(outJson()).toMatchObject({ schemaVersion: 2, usage: expect.stringContaining('uv5r tune FREQ --channel N') });
  });

  it('answers an unknown verb in under 300 bytes with no help text', async () => {
    const open = opener(new FakeRadio());
    await cli(['frobnicate', '--json'], open);
    expect(process.exitCode).toBe(2);
    const line = stderr.join('');
    expect(Buffer.byteLength(line)).toBeLessThan(300);
    expect(errJson().message).toBe(
      'unknown verb "frobnicate"; verbs: status, tune, check, load, read, erase, key, dump, restore, settings, listen, sweep; run uv5r help VERB',
    );
    expect(line).not.toContain('usage:');
    expect(line).not.toContain('exit codes');
    expect(open.calls).toBe(0);
  });

  it('exits 2 on an unknown help subject', async () => {
    await cli(['help', 'nonsense', '--json']);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toMatch(/^unknown help subject "nonsense"; verbs: status, tune, .*; run uv5r help VERB$/);
    expect(stdout).toEqual([]);
  });

  it.each([[['--bogus']], [['--bogus', 'value']], [['help', '--bogus']], [['status', '--bogus']]])('exits 2 on the unknown flag in %j', async (argv) => {
    const open = opener(new FakeRadio());
    await cli([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toContain('--bogus');
    expect(stdout).toEqual([]);
    expect(open.calls).toBe(0);
  });

  it.each([
    [['status', '--bogus', '--help']],
    [['status', 'extra', '--help']],
    [['status', '--seconds', '2', '-h']],
    [['check', '162.400', '--offset', '0.6', '--help']],
  ])('exits 2 on %j before printing help or opening the transport', async (argv) => {
    const open = opener(new FakeRadio());
    await cli([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().reason).toBe('invalid-argument');
    expect(stdout).toEqual([]);
    expect(open.calls).toBe(0);
  });

  it('prints help for VERB --help with flags the verb takes', async () => {
    await cli(['check', '162.400', '--channel', '0', '--help', '--json'], opener());
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ verb: 'check' });
  });

  it('states the channel rule in the same words in help, README.md and SKILL.md', async () => {
    const help = await helpJson();
    expect(help.rules.channel).toBe(CHANNEL_RULE);
    expect(readFileSync(README, 'utf8')).toContain(CHANNEL_RULE);
    expect(readFileSync(SKILL, 'utf8')).toContain(CHANNEL_RULE);
  });

  it('keeps SKILL.md at most 60 lines', () => {
    expect(readFileSync(SKILL, 'utf8').trimEnd().split('\n').length).toBeLessThanOrEqual(60);
  });
});

describe('status output', () => {
  const STATUS = { firmware: 'HN5RV011', workmode: 'vfo', squelch: 3, voice: 'eng', beep: 'on', abr: 5 };

  it('prints firmware, work mode and the audio settings as JSON', async () => {
    await cli(['status', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toEqual(STATUS);
  });

  it('lists the same keys in the help result', async () => {
    await cli(['help', 'status', '--json']);
    const { result } = JSON.parse(stdout.join('')) as { result: Record<string, unknown> };
    expect(Object.keys(result)).toEqual(Object.keys(STATUS));
    for (const key of ['channelA', 'channelB', 'channel', 'empty', 'rxMhz', 'name', 'note']) expect(result).not.toHaveProperty(key);
  });
});

describe('read output', () => {
  it('reports a record with malformed TX BCD as malformed with its raw bytes', async () => {
    const radio = new FakeRadio();
    const mem = encodeChannel({ rxHz: 162_550_000 });
    mem.set([0xff, 0x00, 0x00, 0x00], 4);
    radio.eeprom.set(mem, 5 * 16);
    await cli(['read', '5', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toEqual({ channel: 5, malformed: true, raw: [...mem].map((b) => b.toString(16).padStart(2, '0')).join(' ') });
  });

  it('prints a malformed record as text with its raw bytes on a terminal', async () => {
    const radio = new FakeRadio();
    const mem = encodeChannel({ rxHz: 162_550_000 });
    mem.set([0xff, 0x00, 0x00, 0x00], 4);
    radio.eeprom.set(mem, 5 * 16);
    await onTerminal(() => cli(['read', '5'], opener(radio)));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`ch 5: malformed record ${[...mem].map((b) => b.toString(16).padStart(2, '0')).join(' ')}\n`);
  });

  it('reports an erased slot as empty', async () => {
    await cli(['read', '5', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toEqual({ channel: 5, empty: true });
  });

  it('names the malformed shape in help read', async () => {
    await cli(['help', 'read', '--json']);
    expect(stdout.join('')).toContain('\\"malformed\\": true, \\"raw\\": HEX');
  });
});

describe('repeated flags', () => {
  it('prints the duplicate-flag error as JSON on a terminal when --json was given', async () => {
    await onTerminal(() => cli(['status', '--json', '--json'], opener(new FakeRadio())));
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: '--json given twice; pass it once' });
  });

  it('prints a parse error as text on a terminal', async () => {
    await onTerminal(() => cli(['status', '--target', 'a', '--target', 'b'], opener(new FakeRadio())));
    expect(process.exitCode).toBe(2);
    expect(stderr.join('')).toMatch(/^uv5r: --target given twice; pass it once\nremedy: /);
  });

  it('exits 2 on --text before opening the transport', async () => {
    const open = opener(new FakeRadio());
    await cli(['status', '--text', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining('unknown option --text') });
    expect(open.calls).toBe(0);
  });

  it('exits 2 naming the flag before opening the transport', async () => {
    const open = opener(new FakeRadio());
    await cli(['tune', '154.68', '--channel', '1', '--channel', '2', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: '--channel given twice; pass it once', flag: 'channel' });
    expect(open.calls).toBe(0);
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
    expect(errJson().reason).toBe('invalid-argument');
    expect(open.calls).toBe(0);
  });
});

describe('listen input checks', () => {
  it('rejects a non-numeric --floor with exit 2', async () => {
    await cli(['listen', '--seconds', '5', '--floor', 'loud', '--json']);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toBe('--floor needs a number; got "loud"');
  });

  it.each([
    [['listen', '--seconds', '5', '--floor', '100']],
    [['listen', '--seconds', '5', '--floor', '-101']],
  ])('exits 2 on %j naming the -100..0 range before opening the transport', async (argv) => {
    const open = opener(new FakeRadio());
    await cli([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', flag: 'floor', message: expect.stringContaining('--floor takes -100..0 dBFS') });
    expect(open.calls).toBe(0);
  });

  it('names --floor and the activity fields in help listen', async () => {
    await cli(['help', 'listen']);
    const help = stdout.join('');
    for (const word of ['--floor DBFS', 'active,', 'activeSeconds', 'warnings']) expect(help).toContain(word);
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

  it('exits 5 with the restore remedy when the radio does not ack a write', async () => {
    const radio = new FakeRadio();
    radio.refuseWriteAt = 0x0100;
    await run(['restore', FIXTURE, '--force', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'write-unacknowledged', remedy: 'rerun the restore', retry: 'once' });
    expect(stdout).toEqual([]);
  });

  it('exits 5 naming the address when the radio drops name writes', async () => {
    const radio = new FakeRadio();
    radio.eeprom.fill(0, 0x1000, 0x1800);
    radio.writesIgnoredBelow = 0x1000;
    radio.writesIgnoredAbove = 0x1800;
    await run(['restore', FIXTURE, '--force', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'verification-failed', message: 'restore did not take 128 blocks; first at 0x1000' });
    expect(stdout).toEqual([]);
  });
});

describe('settings write errors', () => {
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

  it('exits 5 with the settings remedy when the radio does not ack a settings write', async () => {
    const radio = new FakeRadio();
    radio.refuseWriteAt = 0x0e20;
    await run(['settings', 'squelch', '3', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'write-unacknowledged', remedy: 'run uv5r settings to read the block, then rerun', retry: 'after-remedy' });
    expect(stdout).toEqual([]);
  });
});

describe('dump output file', () => {
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

  it.each([
    ['a missing directory', (dir: string) => join(dir, 'missing', 'radio.img')],
    ['a directory path', (dir: string) => dir],
  ])('exits 2 on %s before opening the transport', async (_what, path) => {
    const out = path(mkdtempSync(join(tmpdir(), 'uv5r-')));
    const open = opener(new FakeRadio());
    await run(['dump', '--out', out, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', out, remedy: 'pass --out with a writable path' });
    expect(open.calls).toBe(0);
  });

  it('replaces the bytes of an existing FILE with the image', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'radio.img');
    writeFileSync(out, 'old bytes');
    await run(['dump', '--out', out, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const bytes = readFileSync(out);
    expect(bytes.length).toBe(outJson().bytes);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from(new FakeRadio().ident));
  });

  it('removes a new FILE when the port does not open', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'radio.img');
    await run(['dump', '--out', out, '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(existsSync(out)).toBe(false);
  });

  it('removes a new FILE when a block read times out', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'radio.img');
    const radio = new FakeRadio();
    radio.silentReadAt = 0x0100;
    await run(['dump', '--out', out, '--json'], opener(radio));
    expect(process.exitCode).toBe(4);
    expect(errJson()).toMatchObject({ reason: 'serial-timeout' });
    expect(existsSync(out)).toBe(false);
  });

  it('exits 3 with file-write-failed and removes a new FILE when the image write fails', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'radio.img');
    const radio = new FakeRadio();
    // Make the probed file read-only once the port opens so the image write fails.
    const open: OpenTransport = async () => {
      chmodSync(out, 0o444);
      return radio;
    };
    await run(['dump', '--out', out, '--json'], open);
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'file-write-failed', retry: 'after-remedy', remedy: 'pass --out with a writable path that has free space', out, code: 'EACCES' });
    expect(existsSync(out)).toBe(false);
  });

  it('leaves an existing FILE in place when the port does not open', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'uv5r-')), 'radio.img');
    writeFileSync(out, 'old bytes');
    await run(['dump', '--out', out, '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(readFileSync(out, 'utf8')).toBe('old bytes');
  });

  it('exits 2 on a dangling FILE symlink and creates no target', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uv5r-'));
    const out = join(dir, 'radio.img');
    symlinkSync(join(dir, 'target.img'), out);
    const open = opener(new FakeRadio());
    await run(['dump', '--out', out, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(open.calls).toBe(0);
    expect(lstatSync(out).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'target.img'))).toBe(false);
  });

  it('names the check before the port opens in help dump', async () => {
    await cli(['help', 'dump', '--json']);
    const help = JSON.parse(stdout.join('')) as { exits: Array<{ code: number; when: string }> };
    expect(help.exits).toEqual([
      { code: 2, when: 'FILE not writable, found before the port opens' },
      { code: 3, when: 'a write that fails after the read, such as a full disk' },
    ]);
  });
});

describe('key output', () => {
  it('reports the measured hold when the timer fires late', async () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => realSetTimeout(fn, (ms ?? 0) + 400)) as typeof setTimeout);
    await cli(['key', '--seconds', '0.1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const out = outJson();
    expect(out).toMatchObject({ pttAsserted: true, released: true });
    expect(out.seconds).toBeGreaterThanOrEqual(0.5);
  });

  it('prints pttAsserted, seconds and released on success', async () => {
    await cli(['key', '--seconds', '0.1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const out = outJson();
    expect(Object.keys(out)).toEqual(['pttAsserted', 'seconds', 'released']);
    expect(out).toMatchObject({ pttAsserted: true, released: true });
    expect(out.seconds).toBeGreaterThanOrEqual(0.1);
  });

  it('exits 3 with the unplug remedy when the release fails after the assertion', async () => {
    const radio = new FakeRadio();
    let releases = 0;
    radio.setPtt = async (on: boolean) => {
      if (!on && releases++ === 0) throw new TransportError('ptt-control-failed', 'release failed', { target: 'fake' });
      radio.ptt = on;
    };
    await cli(['key', '--seconds', '0.1', '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'ptt-control-failed', retry: 'no' });
    expect(err).not.toHaveProperty('phase');
    expect(err).not.toHaveProperty('pttAsserted');
    expect(err).not.toHaveProperty('released');
    expect(err.message).toContain('unplug the AIOC');
    expect(err.remedy).toBe('ask the human to unplug the AIOC to drop PTT');
  });

  it('exits 3 with the unplug remedy when both steps fail', async () => {
    const radio = new FakeRadio();
    radio.setPtt = async () => {
      throw new TransportError('ptt-control-failed', 'port gone', { target: 'fake' });
    };
    await cli(['key', '--seconds', '0.1', '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'ptt-control-failed', retry: 'no', remedy: 'ask the human to unplug the AIOC to drop PTT' });
    expect(errJson()).not.toHaveProperty('pttAsserted');
    expect(errJson()).not.toHaveProperty('released');
  });

  it('exits 3 with the device-unavailable remedy and retry when the device is missing', async () => {
    await cli(['key', '--seconds', '0.1', '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(stdout).toEqual([]);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'device-unavailable', remedy: REASONS['device-unavailable'].remedy, retry: 'after-remedy' });
    expect(err).not.toHaveProperty('pttAsserted');
    expect(err).not.toHaveProperty('released');
    expect(err).not.toHaveProperty('phase');
  });

  it('exits 6 with the device-busy retry when another process holds the port', async () => {
    const open: OpenTransport = async () => {
      throw new BusyError('cannot open fake: Resource temporarily unavailable', { target: 'fake' });
    };
    await cli(['key', '--seconds', '0.1', '--json'], open);
    expect(process.exitCode).toBe(6);
    expect(stdout).toEqual([]);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'device-busy', retry: 'after-remedy' });
    expect(err).not.toHaveProperty('released');
  });

  it('tells the human to unplug with retry no when the PTT release fails while the port opens', async () => {
    const open: OpenTransport = async () => {
      throw new TransportError('ptt-control-failed', 'cannot lower DTR', { target: 'fake' });
    };
    await cli(['key', '--seconds', '0.1', '--json'], open);
    expect(process.exitCode).toBe(3);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'ptt-control-failed', remedy: 'ask the human to unplug the AIOC to drop PTT', retry: 'no', target: 'fake' });
    expect(err).not.toHaveProperty('phase');
  });

  it('describes the displayed channel and receive-only slots in help', async () => {
    await cli(['help', 'key']);
    const help = stdout.join('');
    expect(help).toContain('Raise PTT for S seconds on the channel the radio display shows');
    expect(help).toContain('ask the human what the display shows before keying');
    expect(help).toContain('The CLI cannot read the displayed channel; a receive-only slot radiates nothing');
    for (const line of help.split('\n').filter((l) => /\bkey\b/.test(l))) expect(line).not.toMatch(/retry/i);
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
    for (const r of records.slice(0, 3)) expect(r).toMatchObject({ rxMhz: expect.stringMatching(/^162\./), txMhz: null });
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
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', channel: entry.channel, field });
    expect(errJson().message).toContain(prefix);
    expect(open.calls).toBe(0);
  });

  it('exits 5 naming the channel whose write the radio corrupts', async () => {
    const radio = new FakeRadio();
    radio.corruptWriteAt = 0x0000 + 5 * 16;
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({
      reason: 'verification-failed',
      message: 'channel 5 did not take the write',
      remedy: 'read channel 5, then rerun the write',
      retry: 'after-remedy',
      slot: 5,
    });
    expect(errJson()).not.toHaveProperty('written');
    expect(errJson()).not.toHaveProperty('recordWritten');
    expect(stdout).toEqual([]);
  });

  it('names slot 3 when the third record write gets no ack', async () => {
    const radio = new FakeRadio();
    radio.refuseWriteAt = 0x0000 + 3 * 16;
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(radio.writes).toEqual([0x0010, 0x1010, 0x0020, 0x1020, 0x0030]);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'write-unacknowledged', message: 'radio refused write at 0x30', retry: 'once', slot: 3 });
    expect(err).not.toHaveProperty('written');
    expect(stdout).toEqual([]);
  });

  it('names slot 3 and the name in the message when the third channel name does not take the write', async () => {
    const radio = new FakeRadio();
    radio.writesIgnoredBelow = 0x1000 + 3 * 16;
    radio.writesIgnoredAbove = 0x1000 + 4 * 16;
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    const err = errJson();
    expect(err).toMatchObject({
      reason: 'verification-failed',
      message: 'channel 3 record written; name did not take the write',
      remedy: 'read channel 3; rerun the write to fix the name',
      slot: 3,
    });
    expect(err).not.toHaveProperty('recordWritten');
    expect(err).not.toHaveProperty('written');
  });

  it('rejects a top-level rxOnly with exit 2 before opening the transport', async () => {
    const open = opener(new FakeRadio());
    await run(['load', planFile({ rxOnly: true, channels: [{ channel: 1, rxMhz: 162.4 }] }), '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', field: 'rxOnly', message: expect.stringContaining('top-level fields: name, notes, checkMhz, channels') });
    expect(open.calls).toBe(0);
  });

  it.each([
    ['a missing plan file', ['load', 'missing.json']],
    ['no plan file', ['load']],
    ['a bad plan entry', ['load', planFile({ channels: [{ channel: 200, rxMhz: 146.82 }] })]],
  ])('carries no slot and no written on %s', async (_what, argv) => {
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument' });
    expect(errJson()).not.toHaveProperty('slot');
    expect(errJson()).not.toHaveProperty('written');
    expect(open.calls).toBe(0);
    expect(stdout).toEqual([]);
  });

  it('reports the slot when the third channel name read times out', async () => {
    const radio = new FakeRadio();
    radio.silentReadAt = 0x1000 + 3 * 16;
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(4);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'serial-timeout', slot: 3 });
    expect(err).not.toHaveProperty('recordWritten');
    expect(err).not.toHaveProperty('written');
  });

  it('carries no slot and no written when the port does not open', async () => {
    await run(['load', EXAMPLE_PLAN, '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'device-unavailable' });
    expect(errJson()).not.toHaveProperty('slot');
    expect(errJson()).not.toHaveProperty('written');
  });

  it('prints one channel line per entry as text on a terminal', async () => {
    await onTerminal(() => run(['load', EXAMPLE_PLAN], opener(new FakeRadio())));
    expect(process.exitCode).toBe(0);
    const lines = stdout.join('').trim().split('\n');
    expect(lines).toHaveLength(7);
    expect(lines[3]).toBe('ch 4: rx 146.82 tx 146.22 tone 82.5 rx-tone none wide high BIG SKY');
  });
});
