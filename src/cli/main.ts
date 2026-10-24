#!/usr/bin/env node
import { accessSync, closeSync, constants as fsConstants, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { checkFlags, checkPositionals, numberFlag, parseArgs, parseDecimal, stringFlag, type ParsedArgs } from './args.ts';
import { DEFAULT_FLOOR_DBFS, checkFfmpeg, listen } from './audio.ts';
import { CHECK_SECONDS, checkChannel } from './check.ts';
import {
  BaofengError,
  channelPayload,
  checkBand,
  checkChannelNumber,
  checkTenHz,
  DEFAULT_MAGIC,
  dumpImage,
  encodeName,
  eraseChannel,
  FOREIGN_MAGICS,
  holdPtt,
  identify,
  IMAGE_HEADER,
  imageSettingsBlock,
  isSettingName,
  magicByName,
  parseFrequency,
  parseSettingValue,
  parseTone,
  PROGRAM_MAGICS,
  PROGRAM_PAUSE_MS,
  readChannel,
  readPlan,
  readSettings,
  readStatus,
  REASONS,
  resolveTarget,
  RESTORE_RANGES,
  restoreImage,
  RETRY,
  SCAN_ORDER,
  SCAN_SILENT_PAUSE_MS,
  SerialTransport,
  SETTING_NAMES,
  settingValues,
  SETTLE_MS,
  startFreshSession,
  TransportError,
  UnexpectedError,
  UsageError,
  verifyRestoredRanges,
  verifySettingsBlock,
  verifySettingsInFreshSession,
  withDetail,
  withSession,
  writeChannel,
  writeSettings,
  type ChannelResult,
  type ChannelSpec,
  type Family,
  type IdentifyResult,
  type Magic,
  type MagicName,
  type SettingName,
  type Settings,
  type Transport,
} from '../core/index.ts';
import { EXIT, exitCodeFor, signalExitCode } from './exit.ts';
import { HELP_SCHEMA_VERSION, verbJson, verbText, type ArgDoc, type FlagDoc, type VerbDoc } from './help.ts';
import { SWEEP_SECONDS, newProgress, runSweep, slotZero, summarize, type Slot0, type SweepSummary } from './sweep.ts';

/** Open the transport for a target path, or for the discovered AIOC when the path is undefined. */
export type OpenTransport = (target: string | undefined) => Promise<Transport>;

/** Parsed arguments plus the transport opener the verb uses. */
interface Invocation extends ParsedArgs {
  open: OpenTransport;
}

interface Verb extends VerbDoc {
  /** Most positionals the verb takes after its name. */
  positionals: number;
  run: (args: Invocation) => Promise<number>;
}

const MAX_KEY_SECONDS = 60;
const MAX_LISTEN_SECONDS = 600;
const MIN_FLOOR_DBFS = -100;
const MAX_FLOOR_DBFS = 0;
const DEFAULT_AUDIO_DEVICE = 'AIOC Audio';
/** Seconds after the command ends until the radio reloads and applies a write. */
const APPLIES_AFTER_SECONDS = SETTLE_MS / 1000;
/** Bytes a restore image needs to cover its header and every restore range. */
const MIN_IMAGE_BYTES = IMAGE_HEADER + Math.max(...RESTORE_RANGES.map(([, end]) => end));

/** The one statement of how `--channel` relates to what the radio receives; help, README.md and SKILL.md carry it word for word. */
export const CHANNEL_RULE =
  '`--channel N` writes memory slot N. The radio receives slot N after the reload when it is in MR mode with N selected on the active display line. ' +
  'The display may show a name or a frequency. The CLI cannot read the display, so ask the human when it matters which channel the radio is on.';

/** Operating rules `help` prints for an agent that reads no other doc. */
const RULES = {
  checkFirst:
    'Run `uv5r check 162.400 --channel 0` once per session before tuning slot 0, with a NOAA frequency that carries audio at the location. ' +
    'Exit 0 means audio above the floor after writing slot 0, consistent with the radio receiving slot 0. ' +
    'Exit 5 lists the causes; ask the human to set MR mode and select slot 0, then check again.',
  scratchSlot: 'Slot 0 is the scratch slot. `check` examples use slot 0 and `sweep` writes only slot 0. `tune` and `load` write any slot.',
  channel: CHANNEL_RULE,
  oneVerb: 'Run one verb at a time. Do not open, cat, screen or stty the serial port.',
  clone: 'The receiver is deaf during a clone session. Back-to-back verbs take about 3 s longer for the handshake retry.',
  speaker:
    'The radio speaker is silent while the AIOC is plugged in. The human hears receive audio only through listen --seconds 5 --out FILE --play or by playing the WAVs in sweep --out-dir DIR after the run.',
};

const OUTPUT_RULE = 'JSON on stdout when piped or with --json, text on a terminal; a failed command prints nothing on stdout and its error on stderr in the same format';

/** What each exit code means; the error's reason and remedy fields say what to do next. */
const EXIT_CODES: Record<string, string> = {
  '0': 'ok: the result is on stdout',
  '1': 'unexpected: an error the CLI has no kind for',
  '2': 'usage: bad input; argument errors exit before the port opens',
  '3': 'transport: no device, a serial error, an ffmpeg or afplay failure, or a failed file write',
  '4': 'timeout: no ack before a block read, or a short block payload',
  '5': 'device-state: no handshake, a bad reply, an unsupported radio, a refused write, a failed verification, an image ident mismatch, an open squelch or a check under 80% active seconds',
  '6': 'busy: another process holds the serial port',
  '128+signal': 'interrupted by SIGINT, SIGTERM or SIGHUP: key releases PTT and sweep prints its summary',
};

const ERROR_GUIDANCE =
  'A failed command prints one error object on stderr when output is JSON, piped or with --json. ' +
  'The object has reason, message, remedy and retry, and each detail field below sits at its top level beside them. ' +
  'On a terminal it prints the message and a remedy line as text. ' +
  'reason names the failure, remedy is one sentence on what to do next, and retry says whether to rerun the command. ' +
  'A load error from a plan entry write adds slot. A sweep error after the port is requested adds summary, the sweep result so far. ' +
  'An error inside the sweep loop adds phase (check, entry or dwell), slot (0), channel (the plan channel, null during the check) and requestedMhz (the entry frequency, or the checkMhz frequency during the check). ' +
  'summary.slot0 says whether a write landed. A failed check also carries the check result fields. ' +
  'On SIGINT, SIGTERM or SIGHUP once key or sweep has opened the port, the verb prints its result on stdout with interrupted and no error, and exits 128 plus the signal number. ' +
  'A failed PTT release after the signal exits 3 with interrupted in the error. Other verbs end on a signal with no output.';

/** The errors section of `help --json`: the error format, each reason with its exit code, and the retry values. */
const ERRORS_HELP = {
  format: ERROR_GUIDANCE,
  reasons: Object.fromEntries(Object.entries(REASONS).map(([reason, doc]) => [reason, `exit ${exitCodeFor(doc.kind)}: ${doc.means}`])),
  retry: RETRY,
};

const JSON_FLAG: FlagDoc = { name: 'json', help: 'print JSON; the default when stdout is not a terminal' };
const TARGET_FLAG: FlagDoc = { name: 'target', value: 'PATH', help: 'serial device', default: 'UV5R_TARGET, else the AIOC found by USB id 1209:7388' };
const OUTPUT_FLAGS = [JSON_FLAG];
const COMMON_FLAGS = [...OUTPUT_FLAGS, TARGET_FLAG];
const CHANNEL_FLAG: FlagDoc = { name: 'channel', value: 'N', required: true, help: 'memory slot to write, 0..127; see the channel rule in uv5r help' };
const RX_TONE_FLAG: FlagDoc = { name: 'rx-tone', value: 'HZ', default: 'none', help: 'RX tone in the --tone forms; none is carrier squelch' };
const NARROW_FLAG: FlagDoc = { name: 'narrow', help: '12.5 kHz bandwidth; wide without it' };
const LOW_POWER_FLAG: FlagDoc = { name: 'low-power', help: 'low TX power' };
const NAME_FLAG: FlagDoc = { name: 'name', value: 'TEXT', default: 'the frequency', help: 'channel name: printable ASCII, uppercased, cut to 7 characters' };
const DEVICE_FLAG: FlagDoc = { name: 'device', value: 'NAME', default: DEFAULT_AUDIO_DEVICE, help: 'avfoundation audio input by name or index' };
const CAPTURE_DEVICE_FLAG: FlagDoc = {
  ...DEVICE_FLAG,
  help: 'avfoundation audio input by name or index; name the AIOC input, since any input with sound above the floor passes the check',
};
const FLOOR_FLAG: FlagDoc = {
  name: 'floor',
  value: 'DBFS',
  default: DEFAULT_FLOOR_DBFS,
  help: `a second is active when its RMS is above DBFS, ${MIN_FLOOR_DBFS}..${MAX_FLOOR_DBFS}`,
};

const FREQ_ARG: ArgDoc = { name: 'FREQ', help: 'receive frequency in MHz (154.680), Hz (154680000) or exponent form, in 136-174 or 400-520 MHz, in 10 Hz steps' };
const SLOT_ARG: ArgDoc = { name: 'N', help: 'memory slot, 0..127' };

const RADIO_READY = 'The radio is on and the AIOC is plugged in.';
const AUDIO_READY = 'ffmpeg is on PATH and the terminal has microphone access.';
const CAPTURE_READY = ['--device names the AIOC input.', 'Squelch is above 0; uv5r status reports it.'];
const FFMPEG_FIRST = 'Run ffmpeg -version before the port opens. A missing or failing ffmpeg exits 3 with nothing written.';
const APPLIES = `The radio reloads and applies the write about ${APPLIES_AFTER_SECONDS} s after the command ends.`;

const CHANNEL_RECORD = { rxMhz: '154.68', txMhz: '154.68', txTone: '82.5', rxTone: 'none', bandwidth: 'wide', power: 'high', name: '154.68' };
const SETTINGS_EXAMPLE = { squelch: 3, save: 3, abr: 5, beep: 'on', timeout: 3, voice: 'eng', mdfa: 'name', mdfb: 'name' };
const LISTEN_EXAMPLE = {
  device: DEFAULT_AUDIO_DEVICE,
  seconds: 5,
  rmsDbfs: [-21.3, -24.8, -19.6, -30.2, -22.7],
  zeroSeconds: 0,
  meanRmsDbfs: -23.7,
  peakDbfs: -4.1,
  active: [true, true, true, true, true],
  activeSeconds: 5,
  warnings: [],
};

const verbs: Record<string, Verb> = {
  status: {
    summary: 'Print firmware, family, magic, ident, work mode, squelch, voice, beep and abr',
    example: 'uv5r status',
    args: [],
    flags: COMMON_FLAGS,
    effects: [
      'Read the ident, the menu settings and the work mode in one clone session.',
      'Open the session with the magic UV5R_MAGIC names, 291 when unset, as every radio verb does.',
      'Report the magic that answered, the ident and the 14 version bytes as hex. family comes from the magic and the version string, and reads unknown when neither settles it.',
    ],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: false, note: 'reads only' },
    result: {
      firmware: 'HN5RV011',
      firmwareHex: '48 4e 35 52 56 30 31 31 ff ff ff ff ff ff',
      family: 'uv5r',
      magic: '291',
      ident: 'aa 30 76 04 00 05 20 dd',
      workmode: 'channel',
      squelch: 3,
      voice: 'eng',
      beep: 'on',
      abr: 5,
    },
    exits: [],
    positionals: 0,
    run: statusVerb,
  },
  identify: {
    summary: 'Try each classic magic and report the one the radio answers, with the UV5R_MAGIC line to export; name a radio of another family',
    example: 'uv5r identify',
    args: [],
    flags: COMMON_FLAGS,
    effects: [
      `Try the classic magics in the order ${SCAN_ORDER.join(', ')}. A magic UV5R_MAGIC names goes first.`,
      `Give the first magic a second attempt ${SETTLE_MS / 1000} s later on silence or a byte other than 06, as every radio verb does.`,
      `Pause ${SCAN_SILENT_PAUSE_MS / 1000} s after silence or a wrong ack and ${SETTLE_MS / 1000} s after a bad ident or a refused closing 06, then try the next magic.`,
      'Stop at the first magic that opens a clone session and read the firmware block. F11, UV6 and UV6_ORIG run without the closing 06 and with no block read.',
      `When no classic magic opens a session, send the foreign magics of ${FOREIGN_MAGICS.map((m) => m.radio).join(', ')} at 9600 without the closing 06, with the same pauses. An ident stops the scan and names that radio.`,
      `Then switch the port to 115200 and send each UV17Pro magic, ${PROGRAM_MAGICS.map((m) => Buffer.from(m.bytes).toString('latin1')).join(', ')}, in one write, ${PROGRAM_PAUSE_MS / 1000} s apart. An 06 stops the scan and names the model group. The port returns to 9600 after the last magic or the 06.`,
      'pin is the UV5R_MAGIC=NAME line to export when the answering magic differs from the one the other verbs select now, UV5R_MAGIC or else 291. It is null when they match.',
      'In text mode, print one line per attempt on stderr with the baud, as in ORIG at 9600: silent or PROGRAMBFNORMALU at 115200: ack.',
      'A silent radio takes up to 59 s: about 30 s for the classic magics, 16 s for the foreign magics and 12 s at 115200.',
    ],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: false, note: 'reads only' },
    result: {
      magic: '291',
      ident: 'aa 30 76 04 00 05 20 dd',
      firmware: 'HN5RV011',
      firmwareHex: '48 4e 35 52 56 30 31 31 ff ff ff ff ff ff',
      family: 'uv5r',
      flags: { basetype: 'HN5RV01', orig: false, voiceBool: false, band220: false, triPower: false, dtmfTable: '0123456789ABCD*#' },
      droppedByte: true,
      pin: null,
    },
    exits: [
      { code: 5, when: 'radio-unsupported on an F11, UV6 or UV6_ORIG ident, a 14-byte ident or a foreign magic ident, naming the radio' },
      { code: 5, when: 'radio-unsupported with powerCycle true on a 06 at 115200, naming the UV17Pro model group; the radio stays in program mode until the human power-cycles it' },
      { code: 5, when: 'protocol-reply-invalid with the first bad classic ident in got when no magic opened a session' },
      { code: 5, when: 'otherwise session-unavailable with answers, each wrong ack, refusal and foreign bad ident by magic name; empty on a silent cable' },
    ],
    positionals: 0,
    run: identifyVerb,
  },
  tune: {
    summary: 'Write a frequency into memory slot N and read it back',
    example: 'uv5r tune 154.680 --channel 5 --tone 82.5',
    args: [FREQ_ARG],
    flags: [
      CHANNEL_FLAG,
      { name: 'offset', value: 'MHZ', default: 0, help: 'signed repeater offset in 10 Hz steps, as in -0.6; conflicts with --rx-only' },
      { name: 'tone', value: 'HZ', default: 'none', help: 'TX tone: CTCSS from the standard table (82.5), DCS (D023, D023I) or none' },
      RX_TONE_FLAG,
      NARROW_FLAG,
      LOW_POWER_FLAG,
      { name: 'rx-only', help: 'receive only; writes no TX frequency; conflicts with --offset' },
      NAME_FLAG,
      ...COMMON_FLAGS,
    ],
    effects: [
      'Write the channel record and name of slot N in one clone session and read both back.',
      'Keep BCL, PTT-ID, S-code and scan of an existing record. An empty slot gets BCL off, PTT-ID 0, S-code 0 and scan on.',
      APPLIES,
    ],
    preconditions: [RADIO_READY, CHANNEL_RULE, 'Before tuning slot 0, run the check rule that uv5r help lists.'],
    writesToRadio: { writes: true, note: 'the channel record and name of slot N' },
    result: { channel: 5, ...CHANNEL_RECORD, appliesAfterSeconds: APPLIES_AFTER_SECONDS },
    exits: [],
    positionals: 1,
    run: tuneVerb,
  },
  check: {
    summary: 'Write a receive-only frequency into slot N, wait for the reload and listen; exit 5 unless 80% of the seconds are active',
    example: 'uv5r check 162.400 --channel 0',
    args: [FREQ_ARG],
    flags: [CHANNEL_FLAG, CAPTURE_DEVICE_FLAG, ...COMMON_FLAGS],
    effects: [
      FFMPEG_FIRST,
      'Read the squelch setting. Squelch 0 exits 5 with squelch-open before the write.',
      'In the same clone session, write FREQ into slot N as a receive-only record and read it back. --offset and --tone exit 2.',
      `Wait ${APPLIES_AFTER_SECONDS} s for the reload, then capture ${CHECK_SECONDS} s of receive audio with the listen pipeline.`,
      `A second is active when its RMS is above ${DEFAULT_FLOOR_DBFS} dBFS.`,
      'Pass when at least 80% of the seconds are active, rounded up: 4 of 5.',
      'A pass means audio above the floor after writing slot N, consistent with the radio receiving slot N. The received frequency stays unverified.',
      'Once the write succeeds, slot N keeps the receive-only record, also after a capture failure. A capture error then carries slot and requestedMhz. A failure during the write leaves the slot state unknown.',
    ],
    preconditions: [RADIO_READY, AUDIO_READY, ...CAPTURE_READY, 'The human has set MR mode and selected slot N.', 'FREQ carries audio at the location, such as a NOAA weather transmitter.'],
    writesToRadio: { writes: true, note: 'a receive-only record and name in slot N; nothing restores the old record' },
    result: { slot: 0, requestedMhz: '162.4', ...LISTEN_EXAMPLE },
    exits: [
      { code: 3, when: 'a short capture' },
      { code: 5, when: 'squelch 0, before the write; or fewer than 80% of the seconds active, where the message lists the causes and the error carries the result fields' },
    ],
    positionals: 1,
    run: checkVerb,
  },
  load: {
    summary: 'Write every channel of a plan file and read each back',
    example: 'uv5r load channels.json',
    args: [{ name: 'PLAN', help: 'plan JSON with name, notes, checkMhz and a channels array; README.md "Plan fields" lists the entry fields' }],
    flags: COMMON_FLAGS,
    effects: [
      'Validate every entry before the port opens.',
      'Write each entry to its own slot in one clone session and read each back. Slots absent from the plan keep their records and names.',
      'Validate checkMhz and write nothing for it.',
      APPLIES,
    ],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: true, note: 'the record and name of each plan slot' },
    result: [{ channel: 1, rxMhz: '162.4', txMhz: null, txTone: 'none', rxTone: 'none', bandwidth: 'wide', power: 'high', name: 'NOAA', appliesAfterSeconds: APPLIES_AFTER_SECONDS }],
    exits: [
      {
        code: 2,
        when: 'a missing or empty channels array, a bad or unknown top-level or entry field, a channel outside 0..127 or a channel listed twice; a field error carries field, and an entry error carries channel',
      },
    ],
    positionals: 1,
    run: loadVerb,
  },
  read: {
    summary: 'Print one channel record',
    example: 'uv5r read 5',
    args: [SLOT_ARG],
    flags: COMMON_FLAGS,
    effects: [
      'Read the record and name of slot N. An empty slot returns {"channel": N, "empty": true}.',
      'A record whose RX or TX frequency bytes are not valid BCD returns {"channel": N, "malformed": true, "raw": HEX} with the 16 record bytes as hex. The slot is in use.',
    ],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: false, note: 'reads only' },
    result: { channel: 5, ...CHANNEL_RECORD },
    exits: [],
    positionals: 1,
    run: readVerb,
  },
  erase: {
    summary: 'Clear one channel record and its name',
    example: 'uv5r erase 127',
    args: [SLOT_ARG],
    flags: COMMON_FLAGS,
    effects: ['Write 0xFF over the record and name of slot N and read both back.', APPLIES],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: true, note: '0xFF over the record and name of slot N' },
    result: { channel: 127, empty: true, appliesAfterSeconds: APPLIES_AFTER_SECONDS },
    exits: [],
    positionals: 1,
    run: eraseVerb,
  },
  key: {
    summary: 'Raise PTT for S seconds on the channel the radio display shows; ask the human what the display shows before keying',
    example: 'uv5r key --seconds 2',
    args: [],
    flags: [{ name: 'seconds', value: 'S', required: true, help: `hold time, 0 < S <= ${MAX_KEY_SECONDS}` }, ...COMMON_FLAGS],
    effects: [
      'Raise PTT (DTR high, RTS low) for S seconds, then release it. The result reports the measured hold.',
      'Transmit on the channel the radio display shows. The CLI cannot read the displayed channel; a receive-only slot radiates nothing.',
      'Once the port is open, Ctrl-C, SIGTERM or SIGHUP releases PTT, adds interrupted to the result and exits 128 plus the signal number.',
      'A failed PTT release after the signal exits 3 with interrupted in the error.',
    ],
    preconditions: [
      RADIO_READY,
      'Ask the human what the display shows.',
      'Key only when the human asked and the frequency is one they may transmit on.',
    ],
    writesToRadio: { writes: false, note: 'raises PTT only, which transmits on a TX-capable channel' },
    result: { pttAsserted: true, seconds: 2, released: true },
    exits: [{ code: 3, when: 'a PTT control failure' }],
    positionals: 0,
    run: keyVerb,
  },
  dump: {
    summary: 'Save the full memory image',
    example: 'uv5r dump --out radio.img',
    args: [],
    flags: [{ name: 'out', value: 'FILE', default: 'uv5r-YYYY-MM-DDTHH-MM-SS.img', help: 'image path' }, ...COMMON_FLAGS],
    effects: [
      'Open FILE before the port opens; a new FILE is removed when the dump exits with an error and stays empty after a signal.',
      'Read the full memory image in CHIRP layout in one clone session, about 14 s, and write it to FILE.',
    ],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: false, note: 'reads only; writes FILE on disk' },
    result: { out: 'radio.img', bytes: 6472, firmware: 'HN5RV011', family: 'uv5r', magic: '291' },
    exits: [
      { code: 2, when: 'FILE not writable, found before the port opens' },
      { code: 3, when: 'a write that fails after the read, such as a full disk; an existing FILE may be left partial' },
    ],
    positionals: 0,
    run: dumpVerb,
  },
  restore: {
    summary: 'Write the main memory of an image back',
    example: 'uv5r restore radio.img --force',
    args: [{ name: 'IMAGE', help: `image from uv5r dump, at least ${MIN_IMAGE_BYTES} bytes` }],
    flags: [{ name: 'force', required: true, help: 'confirm the bulk write' }, ...COMMON_FLAGS],
    effects: [
      'Write channels, names and settings from IMAGE, about 30 s.',
      'In a fresh session, read back the settings block, the channel records 0x0000..0x07FF and the names 0x1000..0x17FF and compare them with IMAGE.',
    ],
    preconditions: [RADIO_READY, 'IMAGE comes from a radio with the same ident.'],
    writesToRadio: { writes: true, note: 'channels, names and settings from IMAGE' },
    result: { file: 'radio.img', blocks: 382, verifiedBlocks: 64, settings: SETTINGS_EXAMPLE },
    exits: [
      { code: 2, when: 'no --force, an unreadable IMAGE or a short one' },
      { code: 5, when: 'an ident mismatch, or a block that reads back different; the message names the first address' },
    ],
    positionals: 1,
    run: restoreVerb,
  },
  settings: {
    summary: 'Print the menu settings, or set fields',
    example: 'uv5r settings voice eng beep on',
    args: [{ name: 'FIELD VALUE ...', optional: true, help: 'FIELD is a field name; VALUE is a number or a listed name; fields lists both' }],
    flags: COMMON_FLAGS,
    effects: [
      'With no pairs, read the eight fields.',
      'With pairs, write and commit the settings block, wait for the reload, then read it back in a fresh session.',
      'Squelch applies as soon as the session ends.',
    ],
    preconditions: [RADIO_READY],
    writesToRadio: { writes: true, note: 'the menu settings block, only when given FIELD VALUE pairs' },
    result: SETTINGS_EXAMPLE,
    exits: [],
    fields: Object.fromEntries(SETTING_NAMES.map((name) => [name, settingValues(name)])),
    positionals: Infinity,
    run: settingsVerb,
  },
  listen: {
    summary: 'Capture receive audio from the AIOC and report dBFS, active, activeSeconds and warnings',
    example: 'uv5r listen --seconds 5 --out rx.wav --play',
    args: [],
    flags: [
      { name: 'seconds', value: 'S', required: true, help: `capture time, whole number 1..${MAX_LISTEN_SECONDS}` },
      DEVICE_FLAG,
      FLOOR_FLAG,
      { name: 'out', value: 'FILE', help: 'write the capture as a 48 kHz mono WAV and report out; overwrites FILE' },
      { name: 'play', help: 'play the --out file through afplay after the capture; needs --out' },
      ...OUTPUT_FLAGS,
    ],
    effects: [
      'Capture receive audio with ffmpeg at 48 kHz mono and drop the first captured second.',
      'Report rmsDbfs per second, meanRmsDbfs, peakDbfs, zeroSeconds, active, activeSeconds and warnings.',
      'A second is active when its RMS is above the floor. A second of digital zero reads null.',
    ],
    preconditions: [AUDIO_READY],
    writesToRadio: { writes: false, note: 'opens no serial port' },
    result: { ...LISTEN_EXAMPLE, out: 'rx.wav' },
    exits: [{ code: 3, when: 'a short capture' }],
    positionals: 0,
    run: listenVerb,
  },
  sweep: {
    summary: 'Check slot 0 with the plan checkMhz, then write each plan entry into slot 0, listen S seconds and report the active ones',
    example: 'uv5r sweep channels.json --seconds 30',
    args: [{ name: 'PLAN', help: 'plan JSON with a top-level checkMhz' }],
    flags: [
      { name: 'seconds', value: 'S', default: SWEEP_SECONDS, help: `dwell per entry, whole number 1..${MAX_LISTEN_SECONDS}` },
      { name: 'out-dir', value: 'DIR', help: 'keep each capture as DIR/chNN-YYYY-MM-DDTHH-MM-SS.wav; creates DIR after the ffmpeg check; an unwritable DIR exits 2 before the port opens' },
      CAPTURE_DEVICE_FLAG,
      ...COMMON_FLAGS,
    ],
    effects: [
      FFMPEG_FIRST,
      `Run check on slot 0 with the plan checkMhz for ${CHECK_SECONDS} s. Squelch 0 or a check under 80% active seconds exits 5. Any check failure stops before a plan entry is written.`,
      `For each entry in plan order, write it into slot 0 with its own TX setting, wait ${APPLIES_AFTER_SECONDS} s for the reload and capture --seconds.`,
      `A second is active when its RMS is above ${DEFAULT_FLOOR_DBFS} dBFS.`,
      'Print one summary on stdout on success or on a signal: swept, seconds, device, active, warnings and slot0. A failure puts it in the error as summary.',
      'warnings holds the check warnings prefixed with check: and each dwell warning prefixed with its plan channel.',
      'slot0 is {channel, name} of the last verified entry write, {channel: null, name} after only the check write, or null when unknown. Slot 0 keeps it after the run.',
      'active[].name is the plan name. slot0.name is the name the radio holds, uppercased and cut to 7 characters. Match the two on channel.',
      'On SIGINT, SIGTERM or SIGHUP, stop the capture in progress, print the summary with interrupted and exit 128 plus the signal number.',
      'Read nothing from stdin.',
    ],
    preconditions: [RADIO_READY, AUDIO_READY, ...CAPTURE_READY, 'The human has set MR mode and selected slot 0.', 'The plan checkMhz carries audio at the location.'],
    writesToRadio: { writes: true, note: 'slot 0, once for the check and once per plan entry; the last write stays' },
    result: {
      swept: 7,
      seconds: SWEEP_SECONDS,
      device: DEFAULT_AUDIO_DEVICE,
      active: [{ channel: 1, slot: 0, name: 'NOAA', requestedMhz: '162.4', activeSeconds: 30 }],
      warnings: [],
      slot0: { channel: 7, name: 'SHERIFF' },
    },
    exits: [
      { code: 2, when: 'a plan without checkMhz' },
      { code: 3, when: 'a short capture' },
      { code: 3, when: 'a capture that cannot be renamed into DIR mid-run, after slot 0 is written; the error names part and carries summary' },
    ],
    positionals: 1,
    run: sweepVerb,
  },
};

const BOOLEAN_FLAGS = new Set(['help', 'version', ...Object.values(verbs).flatMap((v) => v.flags.filter((f) => !f.value).map((f) => f.name))]);
/** Flags `uv5r` takes with no verb. */
const TOP_FLAGS = ['help', 'version', 'json'];

/** Return the flags `verb` takes, as the verbs table lists them. */
function flagNames(verb: string): string[] {
  return verbs[verb]!.flags.map((f) => f.name);
}

function isVerb(name: string): boolean {
  return Object.hasOwn(verbs, name);
}

/** Return a short error for an unknown verb or help subject, with the verb list and the help command. */
function unknownVerb(what: string, name: string): UsageError {
  return new UsageError(`${what} ${JSON.stringify(name.slice(0, 40))}; verbs: ${Object.keys(verbs).join(', ')}; run uv5r help VERB`);
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
  return pkg.version ?? 'unknown';
}

function helpText(): string {
  const width = Math.max(...Object.keys(verbs).map((v) => v.length));
  const codeWidth = Math.max(...Object.keys(EXIT_CODES).map((c) => c.length));
  return [
    'usage: uv5r VERB [ARGS] [FLAGS]',
    '',
    'verbs:',
    ...Object.entries(verbs).map(([name, v]) => `  ${name.padEnd(width)}  ${v.summary}`),
    `  ${'help'.padEnd(width)}  Print this overview; help VERB prints one verb`,
    '',
    'run uv5r help VERB for flags, defaults, effects, a result example and the exit cases it adds to the table below',
    'run uv5r help --json or uv5r help VERB --json for the same as JSON; uv5r --version prints the version',
    '',
    'rules:',
    ...Object.values(RULES).map((rule) => `  - ${rule}`),
    '',
    `output: ${OUTPUT_RULE}`,
    '',
    `errors: ${ERROR_GUIDANCE}`,
    '',
    'exit codes:',
    ...Object.entries(EXIT_CODES).map(([code, text]) => `  ${code.padEnd(codeWidth)}  ${text}`),
  ].join('\n');
}

function helpJson(): Record<string, unknown> {
  return {
    schemaVersion: HELP_SCHEMA_VERSION,
    name: 'uv5r',
    version: packageVersion(),
    usage: 'uv5r VERB [ARGS] [FLAGS]',
    output: OUTPUT_RULE,
    rules: RULES,
    errors: ERRORS_HELP,
    exitCodes: EXIT_CODES,
    verbs: Object.fromEntries(Object.entries(verbs).map(([name, v]) => [name, verbJson(name, v)])),
  };
}

/** Print the overview, or one verb's entry; JSON when piped or with --json. */
function printHelp(flags: Map<string, string | true>, verb: string | undefined): void {
  const json = wantsJson(flags);
  if (verb === undefined) process.stdout.write(`${json ? JSON.stringify(helpJson()) : helpText()}\n`);
  else {
    const doc = verbs[verb]!;
    process.stdout.write(`${json ? JSON.stringify({ schemaVersion: HELP_SCHEMA_VERSION, ...verbJson(verb, doc) }) : verbText(verb, doc)}\n`);
  }
}

/** Return --floor, or the default, and throw UsageError outside -100..0. */
function floorFlag(flags: Map<string, string | true>, example: string): number {
  const floor = numberFlag(flags, 'floor') ?? DEFAULT_FLOOR_DBFS;
  if (floor < MIN_FLOOR_DBFS || floor > MAX_FLOOR_DBFS) {
    throw new UsageError(`--floor takes ${MIN_FLOOR_DBFS}..${MAX_FLOOR_DBFS} dBFS; got ${floor}, as in: ${example} --floor -40`, { flag: 'floor' });
  }
  return floor;
}

/** Pick JSON for --json or a non-terminal stdout, and text on a terminal. */
function wantsJson(flags: Map<string, string | true>): boolean {
  return flags.get('json') === true || !process.stdout.isTTY;
}

/** Return the magic UV5R_MAGIC names, or 291 when it is unset or empty; call it before the port opens. */
function selectedMagic(): Magic {
  const name = process.env.UV5R_MAGIC;
  return magicByName(name === undefined || name === '' ? DEFAULT_MAGIC : name);
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
  if ('malformed' in c) return `ch ${c.channel}: malformed record ${c.raw}`;
  return `ch ${c.channel}: rx ${c.rxMhz} tx ${c.txMhz ?? 'off'} tone ${c.txTone} rx-tone ${c.rxTone} ${c.bandwidth} ${c.power} ${c.name}`;
}

/** Return each key of `o` padded to 12 columns and its value, one per line. */
function fieldLines(o: object): string {
  return Object.entries(o)
    .map(([key, value]) => `${key.padEnd(12)} ${value}`)
    .join('\n');
}

function identifyText(r: IdentifyResult): string {
  const flags = Object.entries(r.flags)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  return fieldLines({ ...r, flags, pin: r.pin ?? 'none; the verbs already open with this magic' });
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
  checkFlags('status', args.flags, flagNames('status'));
  const magic = selectedMagic();
  const status = await withTransport(args, (t) => withSession(t, readStatus, { magic }));
  print(args, status, () => fieldLines(status));
  return EXIT.ok;
}

async function identifyVerb(args: Invocation): Promise<number> {
  checkFlags('identify', args.flags, flagNames('identify'));
  const magic = selectedMagic();
  const json = wantsJson(args.flags);
  const result = await withTransport(args, (t) =>
    identify(
      t,
      (a) => {
        if (!json) process.stderr.write(`${a.name} at ${a.baud}: ${a.outcome}\n`);
      },
      { magic },
    ),
  );
  print(args, result, () => identifyText(result));
  return EXIT.ok;
}

async function tuneVerb(args: Invocation): Promise<number> {
  checkFlags('tune', args.flags, flagNames('tune'));
  const freq = args.positionals[0];
  if (!freq) throw new UsageError('tune needs a frequency in MHz, as in: tune 154.680 --channel 5');
  if (!args.flags.has('channel')) throw new UsageError('tune needs --channel N, the memory slot to write, as in: tune 154.680 --channel 0; run uv5r help tune for the channel rule');
  const n = numberFlag(args.flags, 'channel')!;
  checkChannelNumber(n);
  const spec = channelSpec(freq, args.flags);
  const magic = selectedMagic();
  const written = await withTransport(args, (t) => withSession(t, (s) => writeChannel(s, n, spec), { magic }));
  const result = { ...channelPayload(n, written), appliesAfterSeconds: APPLIES_AFTER_SECONDS };
  print(args, result, () => `${channelText(result)}\nwritten; the radio applies it about ${APPLIES_AFTER_SECONDS} s after this command ends`);
  return EXIT.ok;
}

async function checkVerb(args: Invocation): Promise<number> {
  for (const flag of ['offset', 'tone']) {
    if (args.flags.has(flag)) {
      throw new UsageError(`check writes a receive-only record and takes no --${flag}; drop it, as in: check 162.400 --channel 0`, { flag });
    }
  }
  checkFlags('check', args.flags, flagNames('check'));
  const freq = args.positionals[0];
  if (!freq) throw new UsageError('check needs a frequency in MHz, as in: check 162.400 --channel 0');
  if (!args.flags.has('channel')) throw new UsageError('check needs --channel N, as in: check 162.400 --channel 0');
  const n = numberFlag(args.flags, 'channel')!;
  checkChannelNumber(n);
  // Pass no flags so the spec takes the defaults: no RX tone, wide, high power, named by frequency.
  const spec = channelSpec(freq, new Map());
  const device = stringFlag(args.flags, 'device') ?? DEFAULT_AUDIO_DEVICE;
  const magic = selectedMagic();
  await checkFfmpeg();
  const result = await withTransport(args, (t) => checkChannel(t, n, spec, { device, magic }));
  print(args, result, () =>
    [
      `slot ${result.slot}: requested ${result.requestedMhz}`,
      `active     ${result.activeSeconds} of ${result.active.length} s above ${DEFAULT_FLOOR_DBFS} dBFS`,
      `timeline   ${result.active.map((on) => (on ? '#' : '.')).join('')}`,
      ...result.warnings.map((w) => `warning    ${w}`),
    ].join('\n'),
  );
  return EXIT.ok;
}

async function loadVerb(args: Invocation): Promise<number> {
  checkFlags('load', args.flags, flagNames('load'));
  const records: ChannelResult[] = [];
  let slot: number | undefined;
  try {
    const file = args.positionals[0];
    if (!file) throw new UsageError('load needs a plan file, as in: load channels.json');
    const plan = readPlan(file);
    const magic = selectedMagic();
    await withTransport(args, (t) =>
      withSession(
        t,
        async (s) => {
          for (const { channel, spec } of plan.entries) {
            slot = channel;
            records.push(channelPayload(channel, await writeChannel(s, channel, spec)));
          }
        },
        { magic },
      ),
    );
  } catch (err) {
    // Name the slot that failed.
    throw withDetail(err, slot === undefined ? {} : { slot });
  }
  const result = records.map((record) => ({ ...record, appliesAfterSeconds: APPLIES_AFTER_SECONDS }));
  print(args, result, () => result.map(channelText).join('\n'));
  return EXIT.ok;
}

async function readVerb(args: Invocation): Promise<number> {
  checkFlags('read', args.flags, flagNames('read'));
  const numText = args.positionals[0];
  if (numText === undefined) throw new UsageError('read needs a channel number 0..127, as in: read 5');
  const n = parseDecimal(numText, 'channel');
  checkChannelNumber(n);
  const magic = selectedMagic();
  const ch = await withTransport(args, (t) => withSession(t, (s) => readChannel(s, n), { magic }));
  const result = channelPayload(n, ch);
  print(args, result, () => channelText(result));
  return EXIT.ok;
}

async function eraseVerb(args: Invocation): Promise<number> {
  checkFlags('erase', args.flags, flagNames('erase'));
  const numText = args.positionals[0];
  if (numText === undefined) throw new UsageError('erase needs a channel number 0..127, as in: erase 127');
  const n = parseDecimal(numText, 'channel');
  checkChannelNumber(n);
  const magic = selectedMagic();
  await withTransport(args, (t) => withSession(t, (s) => eraseChannel(s, n), { magic }));
  const result = { channel: n, empty: true, appliesAfterSeconds: APPLIES_AFTER_SECONDS };
  print(args, result, () => `channel ${n} erased; the radio applies it about ${APPLIES_AFTER_SECONDS} s after this command ends`);
  return EXIT.ok;
}

async function keyVerb(args: Invocation): Promise<number> {
  checkFlags('key', args.flags, flagNames('key'));
  if (!args.flags.has('seconds')) throw new UsageError(`key needs --seconds S (max ${MAX_KEY_SECONDS}), as in: key --seconds 2`);
  const seconds = numberFlag(args.flags, 'seconds')!;
  if (seconds <= 0 || seconds > MAX_KEY_SECONDS) throw new UsageError(`--seconds takes 0 < S <= ${MAX_KEY_SECONDS}; got ${seconds}`);
  const held = await withTransport(args, (t) => holdPtt(t, seconds));
  const signal = held.interrupted;
  if (signal) {
    print(args, held, () => `PTT asserted for ${held.seconds} s; interrupted by ${signal}; PTT released`);
    return signalExitCode(signal);
  }
  print(args, held, () => `PTT asserted for ${held.seconds} s; PTT released`);
  return EXIT.ok;
}

/** Name a dump file from the local time, as in uv5r-2026-10-12T14-03-09.img. */
function defaultDumpName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `uv5r-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}.img`;
}

async function dumpVerb(args: Invocation): Promise<number> {
  checkFlags('dump', args.flags, flagNames('dump'));
  const out = stringFlag(args.flags, 'out') ?? defaultDumpName();
  const json = wantsJson(args.flags);
  const magic = selectedMagic();
  const notWritable = (err: unknown) =>
    new UsageError(`cannot write ${out}: ${(err as NodeJS.ErrnoException).message}`, { out }, { remedy: 'pass --out with a writable path' });
  let created = false;
  // Create FILE, or open an existing one for append without creating it, so a missing directory, a read-only file, a directory path or a dangling symlink fails before the port opens.
  try {
    try {
      closeSync(openSync(out, 'wx'));
      created = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      closeSync(openSync(out, fsConstants.O_WRONLY | fsConstants.O_APPEND));
    }
  } catch (err) {
    throw notWritable(err);
  }
  let result: { out: string; bytes: number; firmware: string; family: Family; magic: MagicName };
  try {
    result = await withTransport(args, (t) =>
      withSession(
        t,
        async (s) => {
          const image = await dumpImage(s, (addr) => {
            if (!json && addr % 0x400 === 0) process.stderr.write(`read 0x${addr.toString(16).padStart(4, '0')}\n`);
          });
          try {
            writeFileSync(out, image);
          } catch (err) {
            const e = err as NodeJS.ErrnoException;
            throw new TransportError('file-write-failed', `cannot write ${out}: ${e.message}`, { out, code: e.code }, { remedy: 'pass --out with a writable path that has free space' });
          }
          const { firmware, family, magic: answered } = s.startedIdent;
          return { out, bytes: image.length, firmware, family, magic: answered };
        },
        { magic },
      ),
    );
  } catch (err) {
    // Remove the file the probe created and keep the dump error when the removal fails.
    if (created) {
      try {
        rmSync(out, { force: true });
      } catch {}
    }
    throw err;
  }
  print(args, result, () => `wrote ${result.bytes} bytes to ${result.out} (${result.firmware}, family ${result.family}, magic ${result.magic})`);
  return EXIT.ok;
}

async function restoreVerb(args: Invocation): Promise<number> {
  checkFlags('restore', args.flags, flagNames('restore'));
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
  const magic = selectedMagic();
  const result = await withTransport(args, async (t) => {
    const blocks = await withSession(
      t,
      (s) =>
        restoreImage(s, image, (addr) => {
          if (!json && addr % 0x400 === 0) process.stderr.write(`write 0x${addr.toString(16).padStart(4, '0')}\n`);
        }),
      { magic },
    );
    const fresh = await startFreshSession(t, { magic });
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
  checkFlags('settings', args.flags, flagNames('settings'));
  const patch = settingsPatch(args.positionals);
  const magic = selectedMagic();
  const result = await withTransport(args, async (t) => {
    if (Object.keys(patch).length === 0) return withSession(t, readSettings, { magic });
    const block = await withSession(t, (s) => writeSettings(s, patch), { magic });
    return verifySettingsInFreshSession(t, block, { magic });
  });
  print(args, result, () => settingsText(result));
  return EXIT.ok;
}

async function listenVerb(args: Invocation): Promise<number> {
  checkFlags('listen', args.flags, flagNames('listen'));
  if (!args.flags.has('seconds')) throw new UsageError(`listen needs --seconds S (max ${MAX_LISTEN_SECONDS}), as in: listen --seconds 5`);
  const seconds = numberFlag(args.flags, 'seconds')!;
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_LISTEN_SECONDS) {
    throw new UsageError(`--seconds takes a whole number 1..${MAX_LISTEN_SECONDS}; got ${seconds}`);
  }
  const device = stringFlag(args.flags, 'device') ?? DEFAULT_AUDIO_DEVICE;
  const floor = floorFlag(args.flags, 'uv5r listen --seconds 5');
  const out = stringFlag(args.flags, 'out');
  // Reject stdout, since capture drops ffmpeg's stdout and no file would hold the WAV.
  if (out === '-') throw new UsageError('--out takes a file path; got "-", as in: listen --seconds 5 --out rx.wav', { flag: 'out' });
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

function slot0Text(slot0: Slot0 | null): string {
  if (slot0 === null) return 'unknown';
  return slot0.channel === null ? `check record ${slot0.name}` : `ch ${slot0.channel} ${slot0.name}`;
}

function sweepText(s: SweepSummary): string {
  return [
    `swept      ${s.swept} entries, ${s.seconds} s each${s.interrupted ? `; interrupted by ${s.interrupted}` : ''}`,
    `device     ${s.device}`,
    ...s.active.map((a) => `active     ch ${a.channel} ${a.name} requested ${a.requestedMhz}: ${a.activeSeconds} s${a.out === undefined ? '' : ` ${a.out}`}`),
    ...s.warnings.map((w) => `warning    ${w}`),
    `slot 0     ${slot0Text(s.slot0)}`,
  ].join('\n');
}

async function sweepVerb(args: Invocation): Promise<number> {
  checkFlags('sweep', args.flags, flagNames('sweep'));
  const progress = newProgress();
  let seconds = SWEEP_SECONDS;
  let device = DEFAULT_AUDIO_DEVICE;
  let transportAsked = false;
  let summary: SweepSummary;
  try {
    const file = args.positionals[0];
    if (!file) throw new UsageError('sweep needs a plan file, as in: sweep channels.json --seconds 30');
    seconds = numberFlag(args.flags, 'seconds') ?? SWEEP_SECONDS;
    if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_LISTEN_SECONDS) {
      throw new UsageError(`--seconds takes a whole number 1..${MAX_LISTEN_SECONDS}; got ${seconds}`);
    }
    device = stringFlag(args.flags, 'device') ?? DEFAULT_AUDIO_DEVICE;
    const outDir = stringFlag(args.flags, 'out-dir');
    const plan = readPlan(file);
    if (plan.checkHz === undefined) {
      throw new UsageError(`${file} has no checkMhz; add a top-level "checkMhz" with a NOAA frequency that carries audio at the location, as in: "checkMhz": 162.400`, {
        file,
        field: 'checkMhz',
      });
    }
    const checkSpec: ChannelSpec = { rxHz: plan.checkHz };
    const magic = selectedMagic();
    await checkFfmpeg();
    if (outDir !== undefined) {
      try {
        mkdirSync(outDir, { recursive: true });
      } catch (err) {
        throw new UsageError(`cannot create ${outDir}: ${(err as NodeJS.ErrnoException).message}`, { outDir });
      }
      try {
        accessSync(outDir, fsConstants.W_OK | fsConstants.X_OK);
      } catch (err) {
        throw new UsageError(`cannot write to ${outDir}: ${(err as NodeJS.ErrnoException).message}`, { outDir }, { remedy: 'pass --out-dir with a writable directory' });
      }
    }
    const options = { device, seconds, outDir };
    transportAsked = true;
    summary = await withTransport(args, (t) => runSweep(plan.entries, slotZero(t, checkSpec, { device, magic }), options, progress));
  } catch (err) {
    // Add the finished dwells and slot 0 to the error once the port was asked for.
    throw withDetail(err, transportAsked ? { summary: summarize(progress, { seconds, device }) } : {});
  }
  print(args, summary, () => sweepText(summary));
  return summary.interrupted ? signalExitCode(summary.interrupted) : EXIT.ok;
}

async function main(args: Invocation): Promise<number> {
  if (!args.verb) {
    for (const name of args.flags.keys()) {
      if (!TOP_FLAGS.includes(name)) throw new UsageError(`unknown option --${name}; run uv5r help`, { flag: name });
    }
    if (args.flags.get('version')) {
      const version = packageVersion();
      process.stdout.write(`${wantsJson(args.flags) ? JSON.stringify({ version }) : version}\n`);
      return EXIT.ok;
    }
    printHelp(args.flags, undefined);
    return EXIT.ok;
  }
  if (args.verb === 'help') {
    checkFlags('help', args.flags, ['help', 'json']);
    checkPositionals('help', args.positionals, 1, 'uv5r help VERB');
    const subject = args.positionals[0];
    if (subject !== undefined && !isVerb(subject)) throw unknownVerb('unknown help subject', subject);
    printHelp(args.flags, subject);
    return EXIT.ok;
  }
  if (!isVerb(args.verb)) throw unknownVerb('unknown verb', args.verb);
  const verb = verbs[args.verb]!;
  if (args.flags.get('help')) {
    checkFlags(args.verb, args.flags, [...flagNames(args.verb), 'help']);
    checkPositionals(args.verb, args.positionals, verb.positionals, verb.example);
    printHelp(args.flags, args.verb);
    return EXIT.ok;
  }
  checkPositionals(args.verb, args.positionals, verb.positionals, verb.example);
  return verb.run(args);
}

/**
 * Run one command line and set process.exitCode; errors go to stderr as JSON or text.
 * The process exits on its own once stdout and stderr drain, so piped output arrives whole.
 */
export async function cli(argv: string[], open: OpenTransport = openSerial): Promise<void> {
  // Read --json from argv so an error from parseArgs keeps the requested format.
  let flags = new Map<string, string | true>(argv.includes('--json') ? [['json', true]] : []);
  try {
    const args = parseArgs(argv, BOOLEAN_FLAGS);
    flags = args.flags;
    process.exitCode = await main({ ...args, open });
  } catch (err) {
    const error = err instanceof BaofengError ? err : new UnexpectedError(err instanceof Error ? err.message : String(err));
    if (wantsJson(flags)) process.stderr.write(`${JSON.stringify(error)}\n`);
    else {
      process.stderr.write(`uv5r: ${error.message}\nremedy: ${error.remedy} (retry: ${error.retry})\n`);
      // Print the sweep result so far under the error.
      if ('summary' in error.detail) process.stderr.write(`${sweepText(error.detail.summary as SweepSummary)}\n`);
    }
    process.exitCode = exitCodeFor(error.kind);
  }
}

if (import.meta.main) await cli(process.argv.slice(2));
