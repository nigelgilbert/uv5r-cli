import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearInterval as realClearInterval, setInterval as realSetInterval } from 'node:timers';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusyError, encodeChannel, magicByName, REASONS, TransportError, type Transport } from '../../src/core/index.ts';
import { signalExitCode } from '../../src/cli/exit.ts';
import { cli, closeHung, fatal, TRANSMIT_RULE, type OpenTransport } from '../../src/cli/main.ts';
import { SCHEMA_VERSION } from '../../src/cli/help.ts';
import { FakeRadio } from '../core/fake.ts';
import { fakeSpeechDeps } from '../tts/fakes.ts';
import { PRIMARY } from '../core/golden.ts';

/** Temp root for every file these tests write, removed in afterAll. */
const TMP = mkdtempSync(join(tmpdir(), 'uv5r-'));
/** Return a new subdirectory of TMP. */
const tempDir = () => mkdtempSync(join(TMP, 'test-'));
const FIXTURE = join(TMP, 'primary.img');
writeFileSync(FIXTURE, PRIMARY.image);
const README = new URL('../../README.md', import.meta.url).pathname;
const PACKAGE = new URL('../../package.json', import.meta.url).pathname;
const CHANNEL_RULE =
  '`--channel N` writes memory slot N. The radio receives slot N after the reload in MR mode with N selected on the active display line. The CLI cannot read the display.';
const FREQUENCY_RULE =
  'A frequency is MHz when below 1000, else Hz. 144.684, 144684000 and 144.684e6 are the same value. Results are Hz integers.';
const EXAMPLE_PLAN = new URL('../../channels.example.json', import.meta.url).pathname;
/** opensPort, cloneSession, writesToRadio, appliesAfterMs and partialWrite of each verb. */
const DEVICE: Record<string, [boolean, boolean, boolean, number, boolean]> = {
  status: [true, true, false, 0, false],
  identify: [true, true, false, 0, false],
  tune: [true, true, true, 3000, true],
  check: [true, true, true, 0, false],
  load: [true, true, true, 3000, true],
  read: [true, true, false, 0, false],
  erase: [true, true, true, 3000, true],
  key: [true, false, false, 0, false],
  say: [true, false, false, 0, false],
  id: [true, false, false, 0, false],
  dump: [true, true, false, 0, false],
  restore: [true, true, true, 0, true],
  settings: [true, true, true, 0, false],
  listen: [false, false, false, 0, false],
  hear: [false, false, false, 0, false],
  sweep: [true, true, true, 0, false],
  volume: [true, true, true, 0, false],
};

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
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
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

/** Run the CLI under fake timers until it finishes. */
async function run(argv: string[], open: OpenTransport): Promise<void> {
  const done = cli(argv, open);
  await vi.runAllTimersAsync();
  await done;
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
    expect(errJson()).toEqual({ type: 'error', kind: 'unexpected', reason: 'unexpected-error', message: 'boom', remedy: 'report the message to the human', retry: 'no' });
  });

  it('prints the remedy and retry value under the message as text on a terminal', async () => {
    await onTerminal(() => cli(['status'], opener()));
    expect(process.exitCode).toBe(3);
    expect(stderr.join('')).toMatch(/^uv5r: no device at .*\nremedy: ask the human to reseat the AIOC cable, or pass --target PATH \(retry: after-remedy\)\n$/);
  });

  it('sets exitCode 3 on a transport error and leaves process.exit alone', async () => {
    await cli(['status', '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ type: 'error', kind: 'transport', reason: 'device-unavailable' });
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
    expect(tune).toMatchObject({ schemaVersion: 3, verb: 'tune', example: 'uv5r tune 154.680 --channel 5 --tone 82.5' });
    expect(tune.usage).toBe('uv5r tune FREQ --channel N');
    expect(tune.flags).toContainEqual({ flag: '--channel', value: 'N', required: true, default: null, help: expect.any(String) });
    expect(tune.flags).toContainEqual(expect.objectContaining({ flag: '--rx-tone', default: 'none' }));
    expect(tune.flags).toContainEqual(expect.objectContaining({ flag: '--narrow', value: null, default: false }));
    expect(tune.effects.length).toBeGreaterThan(0);
    expect(tune.preconditions).toContain('Follow the channel rule in uv5r help.');
    expect(tune.device).toEqual({ opensPort: true, cloneSession: true, writesToRadio: true, appliesAfterMs: 3000, partialWrite: true, note: expect.any(String) });
    expect(tune).not.toHaveProperty('writesToRadio');
    expect(tune.result).toMatchObject({ channel: 5, rxHz: 154_680_000 });
    expect(tune.exits).toEqual([{ code: 5, when: expect.stringContaining('verification-failed adds failed') }]);
  });

  it('names the byte ranges tune writes and verifies, and tune writes slot 1 at those addresses', async () => {
    const help = await helpJson('tune');
    expect(help.effects).toContain(
      'In one clone session, write the record at 0x0000 + 16N and the name at 0x1000 + 16N and compare each 16-byte read-back.',
    );
    stdout = [];
    const radio = new FakeRadio();
    await cli(['tune', '446.00625', '--channel', '1', '--low-power', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.writes).toEqual([0x0000 + 16, 0x1000 + 16]);
    expect(outJson()).toMatchObject({ channel: 1, rxHz: 446_006_250, power: 'low', name: '446.006' });
  });

  it('lists only the verb-specific exit cases in help VERB --json', async () => {
    const status = await helpJson('status');
    expect(status.exits).toEqual([]);
    expect(status.exitsNote).toBe('adds to exitCodes in uv5r help --json');
    stdout = [];
    const check = await helpJson('check');
    expect(check.exits.map((e: { code: number }) => e.code)).toEqual([3, 5, 5, 5]);
    expect(check.exits[2].when).toContain('audio-inactive under 80% active');
  });

  it('prints help VERB with no exit section when the global table covers the verb', async () => {
    await onTerminal(() => cli(['help', 'status']));
    expect(stdout.join('')).not.toContain('exit codes');
    stdout = [];
    await onTerminal(() => cli(['help', 'listen']));
    expect(stdout.join('')).toContain('exit codes beyond uv5r help:\n  3  a short capture');
  });

  it('prints help --json with the schema version, rules, errors, exit codes and one short entry per verb', async () => {
    const help = await helpJson();
    expect(Object.keys(help)).toEqual(['schemaVersion', 'name', 'version', 'output', 'rules', 'errors', 'exitCodes', 'verbs']);
    expect(help).toMatchObject({ schemaVersion: 3, name: 'uv5r', version: '0.1.0' });
    expect(help.rules).toEqual({
      checkFirst: expect.stringContaining('check 162.400 --channel 0'),
      channel: CHANNEL_RULE,
      frequency: FREQUENCY_RULE,
      oneVerb: 'Run one verb at a time; leave the serial port to uv5r.',
      clone: expect.stringContaining('The receiver is deaf during a clone session'),
      speaker: expect.stringContaining('speaker is silent'),
      transmit: TRANSMIT_RULE,
      hear: expect.stringContaining('operator loop of help hear'),
    });
    expect(Object.keys(help.exitCodes)).toEqual(['0', '1', '2', '3', '4', '5', '6', '128+signal']);
    expect(help.errors.format).toContain('type "error", kind, reason, message, remedy, retry');
    expect(Object.keys(help.errors.retry)).toEqual(['no', 'once', 'after-remedy']);
    for (const text of Object.values(help.exitCodes)) expect(text).not.toMatch(/retry/i);
    expect(Object.keys(help.verbs)).toEqual(['status', 'identify', 'tune', 'check', 'load', 'read', 'erase', 'key', 'say', 'id', 'dump', 'restore', 'settings', 'listen', 'hear', 'sweep', 'volume']);
    expect(help.verbs.check).toEqual({ summary: expect.any(String), usage: 'uv5r check FREQ --channel N', flags: ['--channel', '--input', '--json', '--target'] });
    for (const verb of Object.values(help.verbs) as Array<{ flags: string[] }>) expect(verb.flags).not.toContain('--device');
  });

  it("lists the same flag names in the catalog as in each verb's help", async () => {
    await cli(['help', '--json']);
    const catalog = JSON.parse(stdout.join('')) as { verbs: Record<string, { flags: string[] }> };
    for (const [verb, entry] of Object.entries(catalog.verbs)) {
      stdout = [];
      await cli(['help', verb, '--json']);
      const help = JSON.parse(stdout.join('')) as { flags: Array<{ flag: string }> };
      expect(entry.flags, verb).toEqual(help.flags.map((f) => f.flag));
    }
  });

  it('names UV5R_FAKE_STATE in the --target help', async () => {
    const help = await helpJson('tune');
    const target = (help.flags as Array<{ flag: string; help: string }>).find((f) => f.flag === '--target');
    expect(target?.help).toContain('UV5R_FAKE_STATE');
  });

  it("every verb's help carries the per-verb fields", async () => {
    const keys = ['schemaVersion', 'verb', 'summary', 'usage', 'example', 'args', 'flags', 'effects', 'preconditions', 'device', 'result', 'exits', 'exitsNote'];
    const extra: Record<string, string> = { say: 'fields', id: 'fields', settings: 'fields', hear: 'lines' };
    const catalog = await helpJson();
    for (const [verb, entry] of Object.entries(catalog.verbs)) {
      expect(Object.keys(entry as object).sort(), verb).toEqual(['flags', 'summary', 'usage']);
      stdout = [];
      const help = await helpJson(verb);
      for (const key of keys) expect(help, verb).toHaveProperty(key);
      if (extra[verb]) expect(help, verb).toHaveProperty(extra[verb]!);
    }
  });

  it('gives every verb a device block that matches what the verb does to the port and the radio', async () => {
    for (const [verb, [opensPort, cloneSession, writesToRadio, appliesAfterMs, partialWrite]] of Object.entries(DEVICE)) {
      stdout = [];
      const help = await helpJson(verb);
      expect(help.device, verb).toEqual({ opensPort, cloneSession, writesToRadio, appliesAfterMs, partialWrite, note: expect.any(String) });
      expect(help, verb).not.toHaveProperty('writesToRadio');
    }
    stdout = [];
    expect((await helpJson('settings')).device.note).toBe('the settings block with FIELD VALUE pairs; reads only with none');
    stdout = [];
    await onTerminal(() => cli(['help', 'tune']));
    expect(stdout.join('')).toContain('device:\n  opens port     yes\n  clone session  yes\n  writes radio   yes; record and name of slot N\n  applies after  3000 ms\n  partial write  yes\n');
  });

  it('prints the same entry for help VERB, VERB --help and VERB -h', async () => {
    await onTerminal(() => cli(['help', 'tune']));
    const viaHelp = stdout.join('');
    expect(viaHelp).toContain('usage:   uv5r tune FREQ --channel N\n');
    expect(viaHelp).toContain('--rx-only');
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
    expect(help).toContain(`  - channel: ${CHANNEL_RULE}`);
    expect(help).toContain('exit codes:');
  });

  it('prints the package version for --version, with name and schema version as JSON', async () => {
    const { version } = JSON.parse(readFileSync(PACKAGE, 'utf8')) as { version: string };
    expect(version).toBe('0.1.0');
    await onTerminal(() => cli(['--version']));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toBe(`${version}\n`);
    stdout = [];
    await cli(['--version', '--json']);
    expect(outJson()).toEqual({ name: 'uv5r', version, schemaVersion: 3 });
  });

  it('prints help and help VERB as JSON when stdout is a pipe', async () => {
    await cli(['help']);
    expect(outJson().exitCodes).toMatchObject({ '4': 'timeout' });
    stdout = [];
    await cli(['help', 'tune']);
    expect(outJson()).toMatchObject({ schemaVersion: 3, usage: 'uv5r tune FREQ --channel N' });
  });

  it('answers an unknown verb with no help text', async () => {
    const open = opener(new FakeRadio());
    await cli(['frobnicate', '--json'], open);
    expect(process.exitCode).toBe(2);
    const line = stderr.join('');
    expect(errJson().message).toBe(
      'unknown verb "frobnicate"; verbs: status, identify, tune, check, load, read, erase, key, say, id, dump, restore, settings, listen, hear, sweep, volume; run uv5r help VERB',
    );
    expect(line).not.toContain('usage:');
    expect(line).not.toContain('exit codes');
    expect(open.calls).toBe(0);
  });

  it('exits 2 on an unknown help subject', async () => {
    await cli(['help', 'nonsense', '--json']);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toMatch(/^unknown help subject "nonsense"; verbs: status, identify, tune, .*; run uv5r help VERB$/);
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

  it('states the channel rule in the same words in help and README.md', async () => {
    const help = await helpJson();
    expect(help.rules.channel).toBe(CHANNEL_RULE);
    expect(readFileSync(README, 'utf8')).toContain(CHANNEL_RULE);
  });

  it('states the frequency rule in help and once in README.md', async () => {
    const help = await helpJson();
    expect(help.rules.frequency).toBe(FREQUENCY_RULE);
    expect(readFileSync(README, 'utf8').split(FREQUENCY_RULE)).toHaveLength(2);
  });

  it('gives tune and check the same FREQ help and --offset the FREQ value', async () => {
    const tune = await helpJson('tune');
    stdout = [];
    const check = await helpJson('check');
    const freq = 'MHz below 1000, else Hz; 136-174 or 400-520 MHz, 10 Hz steps';
    expect(tune.args).toEqual([{ name: 'FREQ', optional: false, help: freq }]);
    expect(check.args).toEqual([{ name: 'FREQ', optional: false, help: freq }]);
    expect(tune.flags.find((f: { flag: string }) => f.flag === '--offset')).toMatchObject({ value: 'FREQ', help: 'signed repeater offset, as in -0.6' });
  });
});

describe('status output', () => {
  const STATUS = {
    firmware: 'HN5RV011',
    firmwareHex: '48 4e 35 52 56 30 31 31 ff ff ff ff ff ff',
    family: 'uv5r',
    magic: '291',
    ident: 'aa 30 76 04 00 05 20 dd',
    workmode: 'vfo',
    squelch: 3,
    voice: 'eng',
    beep: 'on',
    abr: 5,
  };

  it('prints firmware, family, magic, ident, work mode and the audio settings as JSON', async () => {
    await cli(['status', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toEqual(STATUS);
  });

  it('prints the magic, ident, family and version bytes as text on a terminal', async () => {
    await onTerminal(() => cli(['status'], opener(new FakeRadio())));
    expect(process.exitCode).toBe(0);
    const text = stdout.join('');
    expect(text).toContain('family       uv5r\n');
    expect(text).toContain('magic        291\n');
    expect(text).toContain('ident        aa 30 76 04 00 05 20 dd\n');
    expect(text).toContain('firmwareHex  48 4e 35 52 56 30 31 31 ff ff ff ff ff ff\n');
  });

  it('exits 5 with radio-unsupported and retry no on a 14-byte ident', async () => {
    const radio = new FakeRadio();
    radio.identReply = Uint8Array.from([0xaa, ...new Array(12).fill(0x30), 0xdd]);
    await cli(['status', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(stdout).toEqual([]);
    expect(errJson()).toMatchObject({ reason: 'radio-unsupported', retry: 'no', radio: 'UV-5X3-type radio', message: expect.stringContaining('UV-5X3-type radio') });
  });

  it('exits 5 with protocol-reply-invalid and the bytes in got on a 9-byte ident', async () => {
    const radio = new FakeRadio();
    radio.identReply = new Uint8Array(9).fill(0xaa);
    await cli(['status', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'protocol-reply-invalid', got: 'aa aa aa aa aa aa aa aa aa' });
  });

  it('exits 5 with session-unavailable and the remedy naming uv5r identify and UV5R_MAGIC when the handshake gets no ack', async () => {
    vi.useFakeTimers();
    try {
      const radio = new FakeRadio();
      radio.handshakesIgnored = 2;
      await run(['status', '--json'], opener(radio));
    } finally {
      vi.useRealTimers();
    }
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({
      reason: 'session-unavailable',
      remedy: 'ask the human to check the radio is on and the cable is seated; if both hold, run uv5r identify with no UV5R_MAGIC prefix and put the pin line it prints before every later uv5r command, as in UV5R_MAGIC=ORIG uv5r status; when pin is null, run later commands with no prefix',
      retry: 'after-remedy',
    });
  });

  it('lists the same keys in the help result', async () => {
    await cli(['help', 'status', '--json']);
    const { result } = JSON.parse(stdout.join('')) as { result: Record<string, unknown> };
    expect(Object.keys(result)).toEqual(Object.keys(STATUS));
    for (const key of ['channelA', 'channelB', 'channel', 'empty', 'rxHz', 'name', 'note']) expect(result).not.toHaveProperty(key);
  });
});

describe('UV5R_MAGIC', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const UV82 = '50 bb ff 20 13 01 05';

  /** Return a fake radio that acks only the UV82 magic. */
  function uv82Radio(): FakeRadio {
    const radio = new FakeRadio();
    radio.magics = [magicByName('UV82').bytes];
    return radio;
  }

  it('sends the UV82 bytes on the settings write session and on its verification session', async () => {
    vi.stubEnv('UV5R_MAGIC', 'UV82');
    const radio = uv82Radio();
    await run(['settings', 'voice', 'off', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ voice: 'off' });
    expect(radio.handshakes).toEqual([UV82, UV82]);
  });

  it('sends the UV82 bytes on the restore write session and on its verification session', async () => {
    vi.stubEnv('UV5R_MAGIC', 'UV82');
    const radio = uv82Radio();
    await run(['restore', FIXTURE, '--force', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.handshakes).toEqual([UV82, UV82]);
  });

  it('reports the magic that opened the session in status and dump', async () => {
    vi.stubEnv('UV5R_MAGIC', 'UV82');
    await run(['status', '--json'], opener(uv82Radio()));
    expect(outJson()).toMatchObject({ magic: 'UV82', family: 'uv-82x3' });
    stdout = [];
    const out = join(tempDir(), 'radio.img');
    await run(['dump', '--out', out, '--json'], opener(uv82Radio()));
    expect(outJson()).toMatchObject({ magic: 'UV82', family: 'uv-82x3' });
  });

  it.each([
    ['tune', ['tune', '146.82', '--channel', '5']],
    ['read', ['read', '5']],
    ['erase', ['erase', '5']],
    ['load', ['load', EXAMPLE_PLAN]],
    ['settings', ['settings']],
  ])('opens the %s session with the magic it names', async (_verb, argv) => {
    vi.stubEnv('UV5R_MAGIC', 'UV82');
    const radio = uv82Radio();
    await run([...argv, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(radio.handshakes).toEqual([UV82]);
  });

  it('opens with 291 when UV5R_MAGIC is empty', async () => {
    vi.stubEnv('UV5R_MAGIC', '');
    await run(['status', '--json'], opener(new FakeRadio()));
    expect(outJson()).toMatchObject({ magic: '291' });
  });

  it.each([
    ['BOGUS', ['status']],
    ['UV6', ['status']],
    ['BOGUS', ['settings', 'voice', 'off']],
    ['UV6', ['read', '5']],
    ['BOGUS', ['restore', FIXTURE, '--force']],
    ['BOGUS', ['check', '162.400', '--channel', '0']],
    ['UV6', ['sweep', EXAMPLE_PLAN]],
  ])('exits 2 on UV5R_MAGIC=%s for %j, lists the supported names and never opens the port', async (name, argv) => {
    vi.stubEnv('UV5R_MAGIC', name);
    const open = opener(new FakeRadio());
    await run([...argv, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', message: expect.stringContaining(`"${name}"`), supported: ['291', 'ORIG', 'UV82', 'A58', 'UV5G'] });
    expect(errJson().message).toContain('supported: 291, ORIG, UV82, A58, UV5G');
    expect(open.calls).toBe(0);
    expect(stdout).toEqual([]);
  });

  it('exits 2 on UV5R_MAGIC=BOGUS for dump before creating FILE', async () => {
    vi.stubEnv('UV5R_MAGIC', 'BOGUS');
    const out = join(tempDir(), 'radio.img');
    const open = opener(new FakeRadio());
    await run(['dump', '--out', out, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(open.calls).toBe(0);
    expect(existsSync(out)).toBe(false);
  });

  it('ignores UV5R_MAGIC for key', async () => {
    vi.useRealTimers();
    vi.stubEnv('UV5R_MAGIC', 'BOGUS');
    await cli(['key', '--seconds', '0.1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
  });
});

describe('identify', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the bench radio at the first magic with pin null and the keys of the help result', async () => {
    await run(['identify', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const result = outJson();
    expect(result).toMatchObject({ magic: '291', ident: 'aa 30 76 04 00 05 20 dd', firmware: 'HN5RV011', family: 'uv5r', droppedByte: true, pin: null });
    expect(stderr).toEqual([]);
    stdout = [];
    await cli(['help', 'identify', '--json']);
    const help = outJson() as { result: Record<string, unknown> };
    expect(Object.keys(result)).toEqual(Object.keys(help.result));
    expect(Object.keys(result)).toEqual(['magic', 'ident', 'firmware', 'firmwareHex', 'family', 'flags', 'droppedByte', 'pin']);
  });

  it('reports pin UV5R_MAGIC=291 for a stale UV5R_MAGIC=ORIG when only 291 acks', async () => {
    vi.stubEnv('UV5R_MAGIC', 'ORIG');
    const radio = new FakeRadio();
    await run(['identify', '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ magic: '291', pin: 'UV5R_MAGIC=291' });
    expect(radio.handshakes).toEqual(['50 bb ff 20 12 07 25']);
  });

  it('prints one stderr line per attempt and the pin line on a terminal', async () => {
    const radio = new FakeRadio();
    radio.magics = [magicByName('ORIG').bytes];
    await onTerminal(() => run(['identify'], opener(radio)));
    expect(process.exitCode).toBe(0);
    expect(stderr.join('')).toBe('291 at 9600: silent\n291 at 9600: silent\nORIG at 9600: ident\n');
    expect(stdout.join('')).toContain('pin          UV5R_MAGIC=ORIG\n');
    expect(stdout.join('')).toContain('flags        basetype=N5RV orig=false');
  });

  it('exits 5 with session-unavailable, retry after-remedy and empty answers on a silent cable', async () => {
    const radio = new FakeRadio();
    radio.magics = [];
    await run(['identify', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(stdout).toEqual([]);
    const err = errJson();
    expect(err).toMatchObject({ reason: 'session-unavailable', retry: 'after-remedy', answers: [] });
    expect(err.remedy).not.toContain('identify');
  });

  it('exits 5 with radio-unsupported naming the UV-6 on a UV6 ack', async () => {
    const radio = new FakeRadio();
    radio.magics = [Uint8Array.from([0x50, 0xbb, 0xff, 0x20, 0x12, 0x08, 0x23])];
    await run(['identify', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'radio-unsupported', retry: 'no', radio: 'Baofeng UV-6', magic: 'UV6' });
  });

  it('exits 5 with radio-unsupported naming the BTECH UV-5X3 on a foreign magic ident', async () => {
    const radio = new FakeRadio();
    radio.magics = [];
    radio.foreignMagic = Uint8Array.from([0x50, 0x0d, 0x0c, 0x20, 0x16, 0x03, 0x28]);
    await run(['identify', '--json'], opener(radio));
    expect(process.exitCode).toBe(5);
    expect(errJson()).toMatchObject({ reason: 'radio-unsupported', retry: 'no', radio: 'BTECH UV-5X3' });
  });

  it('prints the 115200 attempts with the baud and exits 5 with powerCycle and the power-cycle remedy on a program magic ack', async () => {
    const radio = new FakeRadio();
    radio.magics = [];
    radio.programMagic = Uint8Array.from(Buffer.from('PROGRAMCOLORPROU', 'latin1'));
    await onTerminal(() => run(['identify'], opener(radio)));
    expect(process.exitCode).toBe(5);
    expect(stderr.join('')).toContain('Baojie BJ-UV55 at 9600: silent\nPROGRAMBFNORMALU at 115200: silent\nPROGRAMCOLORPROU at 115200: ack\n');
    expect(stderr.join('')).toContain('ask the human to power-cycle the radio and report the radio name; this CLI speaks the classic UV-5R protocol');
    expect(radio.rate).toBe(9600);
    stderr = [];
    const json = new FakeRadio();
    json.magics = [];
    json.programMagic = radio.programMagic;
    await run(['identify', '--json'], opener(json));
    expect(errJson()).toMatchObject({ reason: 'radio-unsupported', retry: 'no', magic: 'PROGRAMCOLORPROU', powerCycle: true, radio: expect.stringContaining('UV-5R Mini') });
  });

  it('exits 2 on UV5R_MAGIC=UV6 before opening the port', async () => {
    vi.stubEnv('UV5R_MAGIC', 'UV6');
    const open = opener(new FakeRadio());
    await run(['identify', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(open.calls).toBe(0);
  });

  it('has a help entry that states the 29 s budget, a help --json entry and a README verb table row', async () => {
    await onTerminal(() => cli(['help', 'identify']));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toContain('A silent radio takes about 29 s');
    expect(readFileSync(README, 'utf8')).toContain('A silent radio takes about 29 s');
    stdout = [];
    await cli(['help', '--json']);
    expect((outJson() as { verbs: Record<string, unknown> }).verbs).toHaveProperty('identify');
    expect(readFileSync(README, 'utf8')).toMatch(/^\| `identify` \|/m);
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

  it('prints a channel record in MHz on a terminal', async () => {
    const radio = new FakeRadio();
    radio.eeprom.set(encodeChannel({ rxHz: 446_006_250 }), 5 * 16);
    await onTerminal(() => cli(['read', '5'], opener(radio)));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toContain('ch 5: rx 446.00625 tx 446.00625 ');
  });

  it('prints the tuned record in MHz on a terminal', async () => {
    await onTerminal(() => cli(['tune', '446.00625', '--channel', '5'], opener(new FakeRadio())));
    expect(process.exitCode).toBe(0);
    expect(stdout.join('')).toContain('ch 5: rx 446.00625 tx 446.00625 ');
  });

  it('reports an erased slot as empty', async () => {
    await cli(['read', '5', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toEqual({ channel: 5, empty: true });
  });

  it('names the malformed shape in help read', async () => {
    await cli(['help', 'read', '--json']);
    expect(stdout.join('')).toContain('\\"malformed\\": true, \\"raw\\": HEX');
    const { result } = outJson() as { result: Record<string, unknown> };
    expect(result).toMatchObject({ rxHz: expect.any(Number), txHz: expect.any(Number) });
    expect(result).not.toHaveProperty('rxMhz');
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
    expect(outJson()).toMatchObject({ channel: 5, rxHz: 146_820_000, txHz: 146_220_000 });
  });

  it.each(['-600000', '-600e3', '-0.6e6'])('reads --offset %s as Hz by the frequency rule', async (offset) => {
    await cli(['tune', '146.82', '--channel', '5', '--offset', offset, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ channel: 5, rxHz: 146_820_000, txHz: 146_220_000 });
  });

  it('reads a positive Hz offset the same as its MHz form', async () => {
    await cli(['tune', '146.52', '--channel', '1', '--offset', '600000', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(outJson()).toMatchObject({ rxHz: 146_520_000, txHz: 147_120_000 });
  });

  it('names the frequency rule when FREQ is 0', async () => {
    const open = opener(new FakeRadio());
    await cli(['tune', '0', '--channel', '1', '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson().message).toBe('bad frequency "0"; a frequency is MHz when below 1000, else Hz');
    expect(open.calls).toBe(0);
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
    expect(outJson()).toMatchObject({ channel: 5, rxHz: 155_475_000, txHz: null });
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
    await onTerminal(() => cli(['help', 'listen']));
    const help = stdout.join('');
    for (const word of ['--floor DBFS', 'active,', 'activeSeconds', 'warnings']) expect(help).toContain(word);
  });
});

describe('restore input checks', () => {
  it('rejects a short image before opening the transport', async () => {
    const file = join(tempDir(), 'short.img');
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

  it.each([
    ['a missing directory', (dir: string) => join(dir, 'missing', 'radio.img')],
    ['a directory path', (dir: string) => dir],
  ])('exits 2 on %s before opening the transport', async (_what, path) => {
    const out = path(tempDir());
    const open = opener(new FakeRadio());
    await run(['dump', '--out', out, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(errJson()).toMatchObject({ reason: 'invalid-argument', out, remedy: 'pass --out with a writable path' });
    expect(open.calls).toBe(0);
  });

  it('replaces the bytes of an existing FILE with the image', async () => {
    const out = join(tempDir(), 'radio.img');
    writeFileSync(out, 'old bytes');
    await run(['dump', '--out', out, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const bytes = readFileSync(out);
    expect(bytes.length).toBe(outJson().bytes);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from(new FakeRadio().ident));
  });

  it('removes a new FILE when the port does not open', async () => {
    const out = join(tempDir(), 'radio.img');
    await run(['dump', '--out', out, '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(existsSync(out)).toBe(false);
  });

  it('removes a new FILE when a block read times out', async () => {
    const out = join(tempDir(), 'radio.img');
    const radio = new FakeRadio();
    radio.silentReadAt = 0x0100;
    await run(['dump', '--out', out, '--json'], opener(radio));
    expect(process.exitCode).toBe(4);
    expect(errJson()).toMatchObject({ reason: 'serial-timeout' });
    expect(existsSync(out)).toBe(false);
  });

  it('exits 3 with file-write-failed and removes a new FILE when the image write fails', async () => {
    const out = join(tempDir(), 'radio.img');
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

  it('exits 3 with ptt-control-failed and keeps a new FILE that holds the image when the port close hangs', async () => {
    const out = join(tempDir(), 'radio.img');
    const radio = FakeRadio.fromImage(PRIMARY.image);
    radio.close = () => new Promise<void>(() => {});
    await run(['dump', '--out', out, '--json'], opener(radio));
    expect(process.exitCode).toBe(3);
    expect(errJson()).toMatchObject({ reason: 'ptt-control-failed', message: 'the port did not close within 3 s; PTT may be high' });
    expect([...readFileSync(out)]).toEqual([...PRIMARY.image]);
  });

  it('leaves an existing FILE in place when the port does not open', async () => {
    const out = join(tempDir(), 'radio.img');
    writeFileSync(out, 'old bytes');
    await run(['dump', '--out', out, '--json'], opener());
    expect(process.exitCode).toBe(3);
    expect(readFileSync(out, 'utf8')).toBe('old bytes');
  });

  it('exits 2 on a dangling FILE symlink and creates no target', async () => {
    const dir = tempDir();
    const out = join(dir, 'radio.img');
    symlinkSync(join(dir, 'target.img'), out);
    const open = opener(new FakeRadio());
    await run(['dump', '--out', out, '--json'], open);
    expect(process.exitCode).toBe(2);
    expect(open.calls).toBe(0);
    expect(lstatSync(out).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, 'target.img'))).toBe(false);
  });

  it('prints out, bytes, firmware, family and magic, the keys of the help result', async () => {
    const out = join(tempDir(), 'radio.img');
    await run(['dump', '--out', out, '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const result = outJson();
    expect(result).toEqual({ out, bytes: 6472, firmware: 'HN5RV011', family: 'uv5r', magic: '291' });
    stdout = [];
    await cli(['help', 'dump', '--json']);
    expect(Object.keys((JSON.parse(stdout.join('')) as { result: object }).result)).toEqual(Object.keys(result));
  });

  it('names the probe exit, the post-read write exit and the hung close exit in help dump', async () => {
    await cli(['help', 'dump', '--json']);
    const help = JSON.parse(stdout.join('')) as { exits: Array<{ code: number; when: string }> };
    expect(help.exits).toEqual([
      { code: 2, when: 'FILE not writable, before the port opens' },
      { code: 3, when: 'a failed image write, such as a full disk; an existing FILE may be partial' },
      { code: 3, when: 'ptt-control-failed when the port close hangs; FILE holds the full image' },
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

  it('prints pttAsserted, seconds, released and the PTT edge stamps, the keys of the help result', async () => {
    await cli(['key', '--seconds', '0.1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    const out = outJson();
    expect(Object.keys(out)).toEqual(['pttAsserted', 'seconds', 'released', 'assertedAtMs', 'releasedAtMs']);
    expect(out).toMatchObject({ pttAsserted: true, released: true });
    expect(out.seconds).toBeGreaterThanOrEqual(0.1);
    stdout.length = 0;
    await cli(['help', 'key', '--json']);
    const help = JSON.parse(stdout.join('')) as { result: object; effects: string[] };
    expect(Object.keys(help.result)).toEqual(Object.keys(out));
    expect(help.effects.filter((e) => e.includes('assertedAtMs') && e.includes('releasedAtMs'))).toHaveLength(1);
    expect(help.effects.filter((e) => e.includes('no ID') && e.includes('`uv5r id`'))).toHaveLength(1);
  });

  it('stamps assertedAtMs and releasedAtMs about 1000 ms apart for --seconds 1', async () => {
    const before = Date.now();
    await cli(['key', '--seconds', '1', '--json'], opener(new FakeRadio()));
    const after = Date.now();
    expect(process.exitCode).toBe(0);
    const { assertedAtMs, releasedAtMs } = outJson() as { assertedAtMs: number; releasedAtMs: number };
    expect(Number.isInteger(assertedAtMs)).toBe(true);
    expect(Number.isInteger(releasedAtMs)).toBe(true);
    expect(assertedAtMs).toBeGreaterThanOrEqual(before);
    expect(releasedAtMs).toBeGreaterThan(assertedAtMs);
    expect(releasedAtMs).toBeLessThanOrEqual(after);
    expect(Math.abs(releasedAtMs - assertedAtMs - 1000)).toBeLessThanOrEqual(50);
  });

  it('prints both stamps with interrupted on SIGINT', async () => {
    const radio = new FakeRadio();
    const done = cli(['key', '--seconds', '5', '--json'], opener(radio));
    setTimeout(() => process.emit('SIGINT'), 30);
    await done;
    expect(process.exitCode).toBe(signalExitCode('SIGINT'));
    const out = outJson() as { assertedAtMs: number; releasedAtMs: number };
    expect(out).toMatchObject({ pttAsserted: true, released: true, interrupted: 'SIGINT' });
    expect(Number.isInteger(out.assertedAtMs)).toBe(true);
    expect(Number.isInteger(out.releasedAtMs)).toBe(true);
    expect(out.releasedAtMs).toBeGreaterThanOrEqual(out.assertedAtMs);
    expect(out.releasedAtMs - out.assertedAtMs).toBeLessThan(1000);
  });

  it.each([
    ['completes', [], /^PTT asserted for [\d.]+ s; PTT released; assertedAtMs (\d+), releasedAtMs (\d+)$/],
    ['is interrupted', ['SIGINT'], /^PTT asserted for 0 s; interrupted by SIGINT; PTT released; assertedAtMs (\d+), releasedAtMs (\d+)$/],
  ] as const)('prints both stamps in the text line when the key %s', async (_how, signals, pattern) => {
    const radio = new FakeRadio();
    const setPtt = radio.setPtt.bind(radio);
    radio.setPtt = async (on: boolean) => {
      await setPtt(on);
      for (const signal of signals) if (on) process.emit(signal);
    };
    await onTerminal(() => cli(['key', '--seconds', '0.1'], opener(radio)));
    const line = stdout.join('').trim();
    expect(line).toMatch(pattern);
    const [, asserted, released] = pattern.exec(line)!;
    expect(Number(released)).toBeGreaterThanOrEqual(Number(asserted));
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
    expect(err).toMatchObject({ type: 'error', kind: 'transport', reason: 'device-unavailable', remedy: REASONS['device-unavailable'].remedy, retry: 'after-remedy' });
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

  it('exits 3 with the unplug remedy when the port close hangs after a key', async () => {
    vi.useFakeTimers();
    try {
      const radio = new FakeRadio();
      radio.close = () => new Promise<void>(() => {});
      await run(['key', '--seconds', '0.1', '--json'], opener(radio));
      expect(process.exitCode).toBe(3);
      expect(stdout).toEqual([]);
      expect(errJson()).toMatchObject({
        reason: 'ptt-control-failed',
        message: 'the port did not close within 3 s; PTT may be high',
        remedy: 'ask the human to unplug the AIOC to drop PTT',
        retry: 'no',
      });
      expect(closeHung).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves closeHung unset when the port closes in time', async () => {
    await cli(['key', '--seconds', '0.1', '--json'], opener(new FakeRadio()));
    expect(process.exitCode).toBe(0);
    expect(closeHung).toBe(false);
  });

  it('returns with closeHung set while a hung close holds a live handle', async () => {
    vi.useFakeTimers();
    let handle: NodeJS.Timeout | undefined;
    try {
      const radio = new FakeRadio();
      radio.close = () => new Promise<void>(() => (handle = realSetInterval(() => {}, 1000)));
      await run(['key', '--seconds', '0.1', '--json'], opener(radio));
      expect(process.exitCode).toBe(3);
      expect(closeHung).toBe(true);
    } finally {
      realClearInterval(handle);
      vi.useRealTimers();
    }
  });

  it('keeps the original error when the port close hangs after a failed key', async () => {
    vi.useFakeTimers();
    try {
      const radio = new FakeRadio();
      radio.setPtt = async () => {
        throw new TransportError('ptt-control-failed', 'port gone', { target: 'fake' });
      };
      radio.close = () => new Promise<void>(() => {});
      await run(['key', '--seconds', '0.1', '--json'], opener(radio));
      expect(process.exitCode).toBe(3);
      expect(errJson()).toMatchObject({ reason: 'ptt-control-failed', message: 'PTT assertion and release unconfirmed: port gone; ask the human to unplug the AIOC to drop PTT', target: 'fake' });
      expect(closeHung).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases PTT on SIGTSTP and exits 128 plus the platform number', async () => {
    const radio = new FakeRadio();
    const done = cli(['key', '--seconds', '5', '--json'], opener(radio));
    setTimeout(() => process.emit('SIGTSTP'), 30);
    await done;
    expect(process.exitCode).toBe(signalExitCode('SIGTSTP'));
    expect(outJson()).toMatchObject({ pttAsserted: true, released: true, interrupted: 'SIGTSTP' });
    expect(radio.pttLog.at(-1)).toBe(false);
    expect(process.listenerCount('SIGTSTP')).toBe(0);
  });

  it('lowers PTT on the open transport and exits 1 on a fatal error', async () => {
    const radio = new FakeRadio();
    const done = cli(['key', '--seconds', '5', '--json'], opener(radio));
    await vi.waitFor(() => expect(radio.ptt).toBe(true));
    await expect(fatal(new Error('boom'))).rejects.toThrow('process.exit called');
    expect(radio.ptt).toBe(false);
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(stderr.join('').trim())).toMatchObject({ reason: 'unexpected-error', message: 'boom' });
    process.emit('SIGINT');
    await done;
  });

  it('prints a fatal error as text on a terminal when --json follows --', async () => {
    const argv = process.argv;
    process.argv = [...argv.slice(0, 2), 'say', '--', '--json'];
    vi.stubEnv('UV5R_CONFIG', '');
    try {
      await onTerminal(async () => {
        await cli(['say', '--', '--json'], opener(new FakeRadio()), fakeSpeechDeps({ defaultConfig: join(tempDir(), 'uv5r.json') }));
        stderr.length = 0;
        await expect(fatal(new Error('boom'))).rejects.toThrow('process.exit called');
      });
    } finally {
      process.argv = argv;
    }
    expect(stderr.join('').startsWith('uv5r: boom')).toBe(true);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('cannot lower DTR'))],
    ['hangs', () => new Promise<void>(() => {})],
  ] as const)('tells the human to unplug when the fatal-error release %s', async (_how, release) => {
    const radio = new FakeRadio();
    const done = cli(['key', '--seconds', '5', '--json'], opener(radio));
    await vi.waitFor(() => expect(radio.ptt).toBe(true));
    const setPtt = radio.setPtt.bind(radio);
    let first = true;
    radio.setPtt = (on: boolean) => {
      if (on || !first) return setPtt(on);
      first = false;
      return release();
    };
    vi.useFakeTimers();
    try {
      const pending = expect(fatal(new Error('boom'))).rejects.toThrow('process.exit called');
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
    } finally {
      vi.useRealTimers();
    }
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(stderr.join('').trim())).toMatchObject({
      reason: 'unexpected-error',
      message: 'boom; PTT release unconfirmed; ask the human to unplug the AIOC',
      remedy: 'ask the human to unplug the AIOC to drop PTT',
      retry: 'no',
    });
    process.emit('SIGINT');
    await done;
  });

  it('describes the displayed channel and receive-only slots in help', async () => {
    await onTerminal(() => cli(['help', 'key']));
    const help = stdout.join('');
    expect(help).toContain('Raise PTT for S seconds on the displayed channel');
    expect(help).toContain('Ask the human what the display shows.');
    expect(help).toContain('Transmit on the channel the display shows. A receive-only slot radiates nothing.');
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

  /** Write `plan` to a temp file and return its path. */
  function planFile(plan: object): string {
    const file = join(tempDir(), 'plan.json');
    writeFileSync(file, JSON.stringify(plan));
    return file;
  }

  it('writes the example plan and each slot reads back the returned record', async () => {
    const radio = FakeRadio.fromImage(PRIMARY.image);
    await run(['load', EXAMPLE_PLAN, '--json'], opener(radio));
    expect(process.exitCode).toBe(0);
    const records = JSON.parse(stdout.join('').trim()) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(7);
    expect(records.map((r) => r.channel)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const r of records.slice(0, 3)) {
      expect(r).toMatchObject({ txHz: null });
      expect(Math.floor((r.rxHz as number) / 1_000_000)).toBe(162);
    }
    expect(records[3]).toMatchObject({ channel: 4, rxHz: 146_820_000, txHz: 146_220_000, txTone: '82.5', name: 'BIG SKY' });
    expect(records[6]).toMatchObject({ channel: 7, rxHz: 154_695_000, txHz: null, bandwidth: 'narrow', name: 'SHERIFF' });
    for (const record of records) {
      stdout = [];
      radio.dropSession();
      await run(['read', String(record.channel), '--json'], opener(radio));
      expect(process.exitCode).toBe(0);
      expect(outJson()).toEqual(record);
    }
  });

  it('leaves slots outside the plan byte-identical', async () => {
    const radio = FakeRadio.fromImage(PRIMARY.image);
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
      failed: expect.any(Array),
      settings: expect.any(Object),
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
      failed: ['name'],
      settings: { name: { desired: 'NOAA 3', observed: '' } },
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
    expect(lines[3]).toBe('ch 4: rx 146.820 tx 146.220 tone 82.5 rx-tone none wide high BIG SKY');
  });
});
