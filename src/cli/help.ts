/**
 * Version of the help and `--version --json` shape that uv5r and tinysa-cli share.
 * Bump it when a field changes meaning or goes away.
 */
export const SCHEMA_VERSION = 4;

/** Pointer printed under every verb's exits in the help JSON. */
const EXITS_NOTE = 'adds to exitCodes in uv5r help --json';

/** One flag a verb takes. A flag without `value` is boolean. */
export interface FlagDoc {
  name: string;
  /** Placeholder for the flag's value, as in N or MHZ. */
  value?: string;
  help: string;
  required?: boolean;
  /** Value the verb uses when the flag is absent; boolean flags default to false. */
  default?: string | number;
  /** Name of an exclusive group; the usage line prints its members together as `[--a V | --b]`. */
  group?: string;
}

/** Return a flag as it appears on the command line, as in `--channel N` or `--narrow`. */
function flagText(f: FlagDoc): string {
  return f.value ? `--${f.name} ${f.value}` : `--${f.name}`;
}

/** One positional argument a verb takes. */
export interface ArgDoc {
  name: string;
  help: string;
  optional?: boolean;
}

/** A verb-specific note on one exit code of the global table. */
export interface ExitCase {
  code: number | string;
  when: string;
}

/** What a verb does to the port and the radio, for a caller that schedules verbs. */
export interface DeviceDoc {
  /** The verb opens the serial port. */
  opensPort: boolean;
  /** The verb runs a clone session, and the receiver is deaf for the call. */
  cloneSession: boolean;
  writesToRadio: boolean;
  /** Milliseconds after exit before the radio runs the write; 0 when nothing waits. */
  appliesAfterMs: number;
  /** A failure can leave some of the write in place. */
  partialWrite: boolean;
  /** What the verb writes, or why it writes nothing. */
  note: string;
}

/** The help entry of one verb; text help, `help VERB` and `help --json` render it. */
export interface VerbDoc {
  summary: string;
  /** Command line to copy. */
  example: string;
  args: ArgDoc[];
  flags: FlagDoc[];
  effects: string[];
  preconditions: string[];
  device: DeviceDoc;
  /** Example of the JSON result on stdout. */
  result: unknown;
  /** Example NDJSON lines a streaming verb prints before the line `result` shows. */
  lines?: unknown[];
  /** Notes that add to the global exit table; empty when the table covers the verb. */
  exits: ExitCase[];
  /** Extra name-to-text table, as the settings fields. */
  fields?: Record<string, string>;
}

/**
 * Return the synopsis of a verb: its arguments, then every flag in order. Required flags are bare and
 * optional ones sit in brackets. An exclusive group prints once, where its first member sits, as `[--a V | --b]`.
 */
function usageLine(name: string, doc: VerbDoc): string {
  const args = doc.args.map((a) => (a.optional ? `[${a.name}]` : a.name));
  const seen = new Set<string>();
  const flags: string[] = [];
  for (const f of doc.flags) {
    if (f.group === undefined) {
      flags.push(f.required ? flagText(f) : `[${flagText(f)}]`);
      continue;
    }
    if (seen.has(f.group)) continue;
    seen.add(f.group);
    flags.push(`[${doc.flags.filter((g) => g.group === f.group).map(flagText).join(' | ')}]`);
  }
  return ['uv5r', name, ...args, ...flags].join(' ');
}

/** Return a flag's default as JSON: the declared default, false for a boolean flag, else null. */
function flagDefault(f: FlagDoc): string | number | boolean | null {
  if (f.default !== undefined) return f.default;
  if (f.required) return null;
  return f.value ? null : false;
}

/** Return one verb's catalog entry for `help --json`: summary, usage and flag names. */
export function catalogEntry(name: string, doc: VerbDoc): Record<string, unknown> {
  return { summary: doc.summary, usage: usageLine(name, doc), flags: doc.flags.map((f) => `--${f.name}`) };
}

/** Return one verb's help entry as a JSON-safe object. */
export function verbJson(name: string, doc: VerbDoc): Record<string, unknown> {
  return {
    verb: name,
    summary: doc.summary,
    usage: usageLine(name, doc),
    example: doc.example,
    args: doc.args.map((a) => ({ name: a.name, optional: Boolean(a.optional), help: a.help })),
    flags: doc.flags.map((f) => ({
      flag: `--${f.name}`,
      value: f.value ?? null,
      required: Boolean(f.required),
      default: flagDefault(f),
      help: f.help,
    })),
    effects: doc.effects,
    preconditions: doc.preconditions,
    device: doc.device,
    result: doc.result,
    ...(doc.lines ? { lines: doc.lines } : {}),
    exits: doc.exits,
    exitsNote: EXITS_NOTE,
    ...(doc.fields ? { fields: doc.fields } : {}),
  };
}

/** Return one verb's help entry as text. */
export function verbText(name: string, doc: VerbDoc): string {
  const width = Math.max(0, ...doc.flags.map((f) => flagText(f).length), ...doc.args.map((a) => a.name.length));
  const flagNote = (f: FlagDoc) => {
    if (f.required) return ' (required)';
    return f.default === undefined ? '' : ` (default ${f.default})`;
  };
  const bullets = (items: string[]) => items.map((s) => `  - ${s}`);
  const codeWidth = Math.max(0, ...doc.exits.map((e) => String(e.code).length));
  const fieldWidth = Math.max(8, ...Object.keys(doc.fields ?? {}).map((k) => k.length));
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  const d = doc.device;
  return [
    `uv5r ${name}: ${doc.summary}`,
    '',
    `usage:   ${usageLine(name, doc)}`,
    `example: ${doc.example}`,
    ...(doc.args.length ? ['', 'arguments:', ...doc.args.map((a) => `  ${a.name.padEnd(width)}  ${a.help}${a.optional ? ' (optional)' : ''}`)] : []),
    ...(doc.flags.length ? ['', 'flags:', ...doc.flags.map((f) => `  ${flagText(f).padEnd(width)}  ${f.help}${flagNote(f)}`)] : []),
    ...(doc.fields ? ['', 'fields:', ...Object.entries(doc.fields).map(([k, v]) => `  ${k.padEnd(fieldWidth)} ${v}`)] : []),
    '',
    'effects:',
    ...bullets(doc.effects),
    '',
    'preconditions:',
    ...bullets(doc.preconditions),
    '',
    'device:',
    `  opens port     ${yes(d.opensPort)}`,
    `  clone session  ${yes(d.cloneSession)}`,
    `  writes radio   ${yes(d.writesToRadio)}; ${d.note}`,
    `  applies after  ${d.appliesAfterMs} ms`,
    `  partial write  ${yes(d.partialWrite)}`,
    '',
    'result:',
    `  ${JSON.stringify(doc.result)}`,
    ...(doc.lines ? ['', 'lines:', ...doc.lines.map((line) => `  ${JSON.stringify(line)}`)] : []),
    ...(doc.exits.length ? ['', 'exit codes beyond uv5r help:', ...doc.exits.map((e) => `  ${String(e.code).padEnd(codeWidth)}  ${e.when}`)] : []),
  ].join('\n');
}
