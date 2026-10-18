#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { checkFlags, checkPositionals, numberFlag, parseArgs, parseDecimal, stringFlag, type ParsedArgs } from './args.ts';
import { DEFAULT_FLOOR_DBFS, listen } from './audio.ts';
import { CHECK_SECONDS, checkChannel } from './check.ts';
import {
  SETTING_NAMES,
  checkBand,
  checkChannelNumber,
  checkTenHz,
  encodeName,
  isSettingName,
  parseFrequency,
  parseSettingValue,
  parseTone,
  settingValues,
  type ChannelSpec,
  type SettingName,
  type Settings,
} from './codec.ts';
import { BaofengError, EXIT, UsageError, errorKind, exitCodeFor, signalExitCode } from './errors.ts';
import { readPlan } from './plan.ts';
import { SETTLE_MS } from './protocol.ts';
import {
  channelPayload,
  dumpImage,
  eraseChannel,
  IMAGE_HEADER,
  RESTORE_RANGES,
  holdPtt,
  imageSettingsBlock,
  readChannel,
  readSettings,
  readStatus,
  restoreImage,
  startFreshSession,
  verifyRestoredRanges,
  verifySettingsBlock,
  verifySettingsInFreshSession,
  withSession,
  writeChannel,
  writeSettings,
  type ChannelResult,
  type RadioStatus,
} from './radio.ts';
import { SerialTransport, resolveTarget, type Transport } from './transport.ts';

/** Open the transport for a target path, or for the discovered AIOC when the path is undefined. */
export type OpenTransport = (target: string | undefined) => Promise<Transport>;

/** Parsed arguments plus the transport opener the verb uses. */
interface Invocation extends ParsedArgs {
  open: OpenTransport;
}

interface Verb {
  summary: string;
  usage: string;
  /** Most positionals the verb takes after its name. */
  positionals: number;
  run: (args: Invocation) => Promise<number>;
}

const BOOLEAN_FLAGS = new Set(['json', 'text', 'help', 'narrow', 'low-power', 'rx-only', 'force', 'play']);
const COMMON = ['json', 'text', 'target'];
const TUNE_FLAGS = ['channel', 'offset', 'tone', 'rx-tone', 'narrow', 'low-power', 'rx-only', 'name'];
const MAX_KEY_SECONDS = 60;
const MAX_LISTEN_SECONDS = 600;
const DEFAULT_AUDIO_DEVICE = 'AIOC Audio';
/** Seconds after the command ends until the radio reloads and applies a write. */
const APPLIES_AFTER_SECONDS = SETTLE_MS / 1000;
/** Bytes a restore image needs to cover its header and every restore range. */
const MIN_IMAGE_BYTES = IMAGE_HEADER + Math.max(...RESTORE_RANGES.map(([, end]) => end));

const verbs: Record<string, Verb> = {
  status: { summary: 'Print firmware, work mode, stored channel numbers, squelch, voice, beep, abr and the active record', usage: 'status', positionals: 0, run: statusVerb },
  tune: { summary: 'Write a frequency into the channel the radio shows', usage: 'tune 154.680 --channel 5 --tone 82.5', positionals: 1, run: tuneVerb },
  check: {
    summary: 'Write a live frequency into channel N, wait for the reload and listen; exit 5 on silence',
    usage: 'check 162.400 --channel 0',
    positionals: 1,
    run: checkVerb,
  },
  load: { summary: 'Write every channel of a plan file and read each back', usage: 'load channels.json', positionals: 1, run: loadVerb },
  read: { summary: 'Print one channel record', usage: 'read 5', positionals: 1, run: readVerb },
  erase: { summary: 'Clear one channel record and its name', usage: 'erase 127', positionals: 1, run: eraseVerb },
  key: { summary: 'Key the transmitter for S seconds', usage: 'key --seconds 2', positionals: 0, run: keyVerb },
  dump: { summary: 'Save the full memory image', usage: 'dump --out radio.img', positionals: 0, run: dumpVerb },
  restore: { summary: 'Write the main memory of an image back', usage: 'restore radio.img --force', positionals: 1, run: restoreVerb },
  settings: { summary: 'Print the menu settings, or set fields', usage: 'settings voice eng beep on', positionals: Infinity, run: settingsVerb },
  listen: {
    summary: 'Capture receive audio from the AIOC and report dBFS, active, activeSeconds and warnings',
    usage: 'listen --seconds 5 --out rx.wav --play',
    positionals: 0,
    run: listenVerb,
  },
};

function helpText(): string {
  const width = Math.max(...Object.keys(verbs).map((v) => v.length));
  const rows = Object.entries(verbs).map(([name, v]) => `  ${name.padEnd(width)}  ${v.summary}: ${v.usage}`);
  return [
    'usage: uv5r <verb> [options]',
    '',
    'verbs:',
    ...rows,
    '',
    'options:',
    '  --json             print JSON (default when stdout is not a terminal)',
    '  --text             print text',
    '  --target PATH      serial device (default: UV5R_TARGET, else the AIOC found by USB id)',
    '  --channel N        tune, check: channel to write, 0..127, as shown on the radio display (required)',
    '  --offset MHZ       tune: repeater offset, signed: --offset -0.6',
    '  --tone HZ          tune: TX CTCSS in Hz (82.5), DCS (D023, D023I) or none',
    '  --rx-tone HZ       tune: RX tone; default none (carrier squelch)',
    '  --narrow           tune: 12.5 kHz bandwidth (default wide)',
    '  --low-power        tune: low TX power',
    '  --rx-only          tune: receive only, TX inhibited; conflicts with --offset',
    '  --name TEXT        tune: channel name, 7 chars (default the frequency)',
    `  check              takes the tune flags, --device and --floor; --seconds S sets the listen time (default ${CHECK_SECONDS})`,
    `  --seconds S        key: hold time, 0 < S <= ${MAX_KEY_SECONDS}; listen: capture time, whole number 1..${MAX_LISTEN_SECONDS} (required)`,
    '  --out FILE         dump: output path (default uv5r-YYYY-MM-DDTHH-MM-SS.img); listen: write the capture as a 48 kHz mono WAV and report out',
    '  --force            restore: confirm a bulk write',
    `  --device NAME      listen: avfoundation audio device (default ${DEFAULT_AUDIO_DEVICE})`,
    `  --floor DBFS       listen: a second is active when its RMS is above DBFS (default ${DEFAULT_FLOOR_DBFS}); sets active and activeSeconds`,
    '  --play             listen: play the --out file through afplay after the capture; needs --out',
    '',
    'settings fields, set by radio menu index or by name:',
    ...SETTING_NAMES.map((name) => `  ${name.padEnd(8)} ${settingValues(name)}`),
    '',
    'exit codes: 0 ok, 1 unexpected, 2 usage, 3 transport, 4 timeout, 5 device-state, 6 busy, 128+signal key interrupted',
  ].join('\n');
}

/** Pick JSON for --json or a non-terminal stdout, and text for --text or a terminal. */
function wantsJson(flags: Map<string, string | true>): boolean {
  if (flags.get('json')) return true;
  if (flags.get('text')) return false;
  return !process.stdout.isTTY;
}

/** Open the serial port at the given path, or at the AIOC found by USB id. */
async function openSerial(target: string | undefined): Promise<Transport> {
  return SerialTransport.open(await resolveTarget(target));
}

async function withTransport<T>(args: Invocation, fn: (t: Transport) => Promise<T>): Promise<T> {
  const transport = await args.open(stringFlag(args.flags, 'target') ?? process.env.UV5R_TARGET);
  try {
    return await fn(transport);
  } finally {
    await transport.close();
  }
}

function print(args: ParsedArgs, json: object, text: () => string): void {
  if (wantsJson(args.flags)) process.stdout.write(`${JSON.stringify(json)}\n`);
  else process.stdout.write(`${text()}\n`);
}

function channelSpec(freqText: string, flags: Map<string, string | true>): ChannelSpec {
  const rxHz = parseFrequency(freqText);
  const rxOnly = Boolean(flags.get('rx-only'));
  const offsetText = stringFlag(flags, 'offset');
  if (rxOnly && offsetText !== undefined) throw new UsageError('--rx-only and --offset conflict; a receive-only channel has no TX frequency');
  const offsetHz = offsetText === undefined ? 0 : checkTenHz(parseDecimal(offsetText, '--offset') * 1_000_000, `--offset ${offsetText}`);
  const txHz = rxOnly ? undefined : rxHz + offsetHz;
  checkBand(rxHz);
  if (txHz !== undefined) checkBand(txHz);
  const name = stringFlag(flags, 'name');
  // Encode the name here so a bad character fails before the port opens.
  if (name !== undefined) encodeName(name);
  return {
    rxHz,
    txHz,
    rxOnly,
    txTone: parseTone(stringFlag(flags, 'tone') ?? 'none'),
    rxTone: parseTone(stringFlag(flags, 'rx-tone') ?? 'none'),
    wide: !flags.get('narrow'),
    lowPower: Boolean(flags.get('low-power')),
    name,
  };
}

function channelText(c: ChannelResult): string {
  if ('empty' in c) return `ch ${c.channel}: empty`;
  return `ch ${c.channel}: rx ${c.rxMhz} tx ${c.txMhz ?? 'off'} tone ${c.txTone} rx-tone ${c.rxTone} ${c.bandwidth} ${c.power} ${c.name}`;
}

function statusText(s: RadioStatus): string {
  return [
    `firmware   ${s.firmware}`,
    `workmode   ${s.workmode}`,
    `channel A  ${s.channelA}`,
    `channel B  ${s.channelB}`,
    `squelch    ${s.squelch}`,
    `voice      ${s.voice}`,
    `beep       ${s.beep}`,
    `abr        ${s.abr}`,
    channelText(s),
    `note       ${s.note}`,
  ].join('\n');
}

function settingsText(s: Settings): string {
  return SETTING_NAMES.map((name) => `${name.padEnd(8)} ${s[name]}`).join('\n');
}

/** Parse `field value` pairs from the settings positionals. */
function settingsPatch(positionals: string[]): Partial<Record<SettingName, number>> {
  if (positionals.length % 2 !== 0) throw new UsageError('settings takes field value pairs, as in: settings voice eng beep on');
  const patch: Partial<Record<SettingName, number>> = {};
  for (let i = 0; i < positionals.length; i += 2) {
    const name = positionals[i]!;
    if (!isSettingName(name)) throw new UsageError(`unknown setting ${JSON.stringify(name)}; fields: ${SETTING_NAMES.join(', ')}`);
    patch[name] = parseSettingValue(name, positionals[i + 1]!);
  }
  return patch;
}

async function statusVerb(args: Invocation): Promise<number> {
  checkFlags('status', args.flags, COMMON);
  const status = await withTransport(args, (t) => withSession(t, readStatus));
  print(args, status, () => statusText(status));
  return EXIT.ok;
}

async function tuneVerb(args: Invocation): Promise<number> {
  checkFlags('tune', args.flags, [...COMMON, ...TUNE_FLAGS]);
  const freq = args.positionals[0];
  if (!freq) throw new UsageError('tune needs a frequency in MHz, as in: tune 154.680 --channel 5');
  if (!args.flags.has('channel')) throw new UsageError('tune needs --channel N: read the channel number off the radio display, as in: tune 154.680 --channel 5');
  const n = numberFlag(args.flags, 'channel')!;
  checkChannelNumber(n);
  const spec = channelSpec(freq, args.flags);
  const written = await withTransport(args, (t) => withSession(t, (s) => writeChannel(s, n, spec)));
  const result = { ...channelPayload(n, written), appliesAfterSeconds: APPLIES_AFTER_SECONDS };
  print(args, result, () => `${channelText(result)}\nwritten; the radio applies it about ${APPLIES_AFTER_SECONDS} s after this command ends`);
  return EXIT.ok;
}

async function checkVerb(args: Invocation): Promise<number> {
  checkFlags('check', args.flags, [...COMMON, ...TUNE_FLAGS, 'seconds', 'device', 'floor']);
  const freq = args.positionals[0];
  if (!freq) throw new UsageError('check needs a frequency in MHz, as in: check 162.400 --channel 0');
  if (!args.flags.has('channel')) throw new UsageError('check needs --channel N: read the channel number off the radio display, as in: check 162.400 --channel 0');
  const n = numberFlag(args.flags, 'channel')!;
  checkChannelNumber(n);
  const spec = channelSpec(freq, args.flags);
  const seconds = numberFlag(args.flags, 'seconds') ?? CHECK_SECONDS;
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_LISTEN_SECONDS) {
    throw new UsageError(`--seconds takes a whole number 1..${MAX_LISTEN_SECONDS}; got ${seconds}`);
  }
  const device = stringFlag(args.flags, 'device') ?? DEFAULT_AUDIO_DEVICE;
  const floorDbfs = numberFlag(args.flags, 'floor') ?? DEFAULT_FLOOR_DBFS;
  const result = await withTransport(args, (t) => checkChannel(t, n, spec, { device, seconds, floorDbfs }));
  print(args, result, () =>
    [
      `ch ${result.channel}: rx ${result.rxMhz}`,
      `active     ${result.activeSeconds} of ${result.active.length} s above ${floorDbfs} dBFS`,
      `timeline   ${result.active.map((on) => (on ? '#' : '.')).join('')}`,
      ...result.warnings.map((w) => `warning    ${w}`),
    ].join('\n'),
  );
  return EXIT.ok;
}

async function loadVerb(args: Invocation): Promise<number> {
  checkFlags('load', args.flags, COMMON);
  const file = args.positionals[0];
  if (!file) throw new UsageError('load needs a plan file, as in: load channels.json');
  const plan = readPlan(file);
  const written = await withTransport(args, (t) =>
    withSession(t, async (s) => {
      const records: ChannelResult[] = [];
      for (const { channel, spec } of plan.entries) records.push(channelPayload(channel, await writeChannel(s, channel, spec)));
      return records;
    }),
  );
  const result = written.map((record) => ({ ...record, appliesAfterSeconds: APPLIES_AFTER_SECONDS }));
  print(args, result, () => result.map(channelText).join('\n'));
  return EXIT.ok;
}

async function readVerb(args: Invocation): Promise<number> {
  checkFlags('read', args.flags, COMMON);
  const numText = args.positionals[0];
  if (numText === undefined) throw new UsageError('read needs a channel number 0..127, as in: read 5');
  const n = parseDecimal(numText, 'channel');
  checkChannelNumber(n);
  const ch = await withTransport(args, (t) => withSession(t, (s) => readChannel(s, n)));
  const result = channelPayload(n, ch);
  print(args, result, () => channelText(result));
  return EXIT.ok;
}

async function eraseVerb(args: Invocation): Promise<number> {
  checkFlags('erase', args.flags, COMMON);
  const numText = args.positionals[0];
  if (numText === undefined) throw new UsageError('erase needs a channel number 0..127, as in: erase 127');
  const n = parseDecimal(numText, 'channel');
  checkChannelNumber(n);
  await withTransport(args, (t) => withSession(t, (s) => eraseChannel(s, n)));
  const result = { channel: n, empty: true, appliesAfterSeconds: APPLIES_AFTER_SECONDS };
  print(args, result, () => `channel ${n} erased; the radio applies it about ${APPLIES_AFTER_SECONDS} s after this command ends`);
  return EXIT.ok;
}

async function keyVerb(args: Invocation): Promise<number> {
  checkFlags('key', args.flags, [...COMMON, 'seconds']);
  if (!args.flags.has('seconds')) throw new UsageError(`key needs --seconds S (max ${MAX_KEY_SECONDS}), as in: key --seconds 2`);
  const seconds = numberFlag(args.flags, 'seconds')!;
  if (seconds <= 0 || seconds > MAX_KEY_SECONDS) throw new UsageError(`--seconds takes 0 < S <= ${MAX_KEY_SECONDS}; got ${seconds}`);
  const held = await withTransport(args, (t) => holdPtt(t, seconds));
  const signal = held.interrupted;
  if (signal) {
    print(args, { keyed: true, seconds: held.seconds, interrupted: signal, released: true }, () => `keyed for ${held.seconds} s; interrupted by ${signal}; PTT released`);
    return signalExitCode(signal);
  }
  print(args, { keyed: true, seconds: held.seconds }, () => `keyed for ${held.seconds} s`);
  return EXIT.ok;
}

/** Name a dump file from the local time, as in uv5r-2026-10-12T14-03-09.img. */
function defaultDumpName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `uv5r-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}.img`;
}

async function dumpVerb(args: Invocation): Promise<number> {
  checkFlags('dump', args.flags, [...COMMON, 'out']);
  const out = stringFlag(args.flags, 'out') ?? defaultDumpName();
  const json = wantsJson(args.flags);
  const result = await withTransport(args, (t) =>
    withSession(t, async (s) => {
      const image = await dumpImage(s, (addr) => {
        if (!json && addr % 0x400 === 0) process.stderr.write(`read 0x${addr.toString(16).padStart(4, '0')}\n`);
      });
      try {
        writeFileSync(out, image);
      } catch (err) {
        throw new UsageError(`cannot write ${out}: ${(err as NodeJS.ErrnoException).message}`, { out });
      }
      return { out, bytes: image.length, firmware: s.startedIdent.firmware };
    }),
  );
  print(args, result, () => `wrote ${result.bytes} bytes to ${result.out} (${result.firmware})`);
  return EXIT.ok;
}

async function restoreVerb(args: Invocation): Promise<number> {
  checkFlags('restore', args.flags, [...COMMON, 'force']);
  const file = args.positionals[0];
  if (!file) throw new UsageError('restore needs an image file');
  if (!args.flags.get('force')) throw new UsageError('restore rewrites channels and settings; pass --force to confirm');
  let image: Uint8Array;
  try {
    image = new Uint8Array(readFileSync(file));
  } catch (err) {
    throw new UsageError(`cannot read ${file}: ${(err as NodeJS.ErrnoException).message}`, { file });
  }
  if (image.length < MIN_IMAGE_BYTES) {
    throw new UsageError(`image too short: ${file} has ${image.length} bytes, restore needs ${MIN_IMAGE_BYTES}`, { file, bytes: image.length });
  }
  const json = wantsJson(args.flags);
  const result = await withTransport(args, async (t) => {
    const blocks = await withSession(t, (s) =>
      restoreImage(s, image, (addr) => {
        if (!json && addr % 0x400 === 0) process.stderr.write(`write 0x${addr.toString(16).padStart(4, '0')}\n`);
      }),
    );
    const fresh = await startFreshSession(t);
    const settings = await verifySettingsBlock(fresh, imageSettingsBlock(image));
    const verifiedBlocks = await verifyRestoredRanges(fresh, image);
    return { file, blocks, verifiedBlocks, settings };
  });
  print(
    args,
    result,
    () => `wrote ${result.blocks} blocks from ${result.file}; settings and ${result.verifiedBlocks} channel and name blocks verified\n${settingsText(result.settings)}`,
  );
  return EXIT.ok;
}

async function settingsVerb(args: Invocation): Promise<number> {
  checkFlags('settings', args.flags, COMMON);
  const patch = settingsPatch(args.positionals);
  const result = await withTransport(args, async (t) => {
    if (Object.keys(patch).length === 0) return withSession(t, readSettings);
    const block = await withSession(t, (s) => writeSettings(s, patch));
    return verifySettingsInFreshSession(t, block);
  });
  print(args, result, () => settingsText(result));
  return EXIT.ok;
}

async function listenVerb(args: Invocation): Promise<number> {
  checkFlags('listen', args.flags, ['json', 'text', 'seconds', 'device', 'floor', 'out', 'play']);
  if (!args.flags.has('seconds')) throw new UsageError(`listen needs --seconds S (max ${MAX_LISTEN_SECONDS}), as in: listen --seconds 5`);
  const seconds = numberFlag(args.flags, 'seconds')!;
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_LISTEN_SECONDS) {
    throw new UsageError(`--seconds takes a whole number 1..${MAX_LISTEN_SECONDS}; got ${seconds}`);
  }
  const device = stringFlag(args.flags, 'device') ?? DEFAULT_AUDIO_DEVICE;
  const floor = numberFlag(args.flags, 'floor') ?? DEFAULT_FLOOR_DBFS;
  const out = stringFlag(args.flags, 'out');
  const play = args.flags.get('play') === true;
  if (play && out === undefined) throw new UsageError('--play needs --out FILE, as in: listen --seconds 5 --out rx.wav --play');
  const result = await listen(device, seconds, floor, { out, play });
  // Print null levels as zero, since null marks digital zero.
  const level = (db: number | null) => (db === null ? 'zero' : `${db} dBFS`);
  print(args, result, () =>
    [
      `device     ${result.device}`,
      `seconds    ${result.seconds}, after dropping the first captured second`,
      `zero secs  ${result.zeroSeconds}`,
      `mean rms   ${level(result.meanRmsDbfs)}`,
      `peak       ${level(result.peakDbfs)}`,
      `per second ${result.rmsDbfs.map((db) => db ?? 'zero').join(' ')}`,
      `active     ${result.activeSeconds} of ${result.active.length} s above ${floor} dBFS`,
      `timeline   ${result.active.map((on) => (on ? '#' : '.')).join('')}`,
      ...result.warnings.map((w) => `warning    ${w}`),
      ...(result.out === undefined ? [] : [`out        ${result.out}`]),
    ].join('\n'),
  );
  return EXIT.ok;
}

async function main(args: Invocation): Promise<number> {
  if (!args.verb || args.verb === 'help' || args.flags.get('help')) {
    process.stdout.write(`${helpText()}\n`);
    return EXIT.ok;
  }
  const verb = Object.hasOwn(verbs, args.verb) ? verbs[args.verb] : undefined;
  if (!verb) throw new UsageError(`unknown verb ${JSON.stringify(args.verb)}\n${helpText()}`);
  checkPositionals(args.verb, args.positionals, verb.positionals, verb.usage);
  return verb.run(args);
}

/**
 * Run one command line and set process.exitCode; errors go to stderr as JSON or text.
 * The process exits on its own once stdout and stderr drain, so piped output arrives whole.
 */
export async function cli(argv: string[], open: OpenTransport = openSerial): Promise<void> {
  let flags = new Map<string, string | true>();
  try {
    const args = parseArgs(argv, BOOLEAN_FLAGS);
    flags = args.flags;
    process.exitCode = await main({ ...args, open });
  } catch (err) {
    const kind = errorKind(err);
    const body = err instanceof BaofengError ? err.toJSON() : { kind, message: err instanceof Error ? err.message : String(err) };
    if (wantsJson(flags)) process.stderr.write(`${JSON.stringify(body)}\n`);
    else process.stderr.write(`uv5r: ${body.message}\n`);
    process.exitCode = exitCodeFor(kind);
  }
}

if (import.meta.main) await cli(process.argv.slice(2));
