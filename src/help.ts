/** Version of the `help --json` shape; bump it when a field changes meaning or goes away. */
export const HELP_SCHEMA_VERSION = 2;

/** One flag a verb takes. A flag without `value` is boolean. */
export interface FlagDoc {
  name: string;
  /** Placeholder for the flag's value, as in N or MHZ. */
  value?: string;
  help: string;
  required?: boolean;
  /** Value the verb uses when the flag is absent; boolean flags default to false. */
  default?: string | number;
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

/** The help entry of one verb; text help, `help VERB` and `help --json` render it. */
export interface VerbDoc {
  summary: string;
  /** Command line to copy. */
  example: string;
  args: ArgDoc[];
  flags: FlagDoc[];
  effects: string[];
  preconditions: string[];
  writesToRadio: { writes: boolean; note: string };
  /** Example of the JSON result on stdout. */
  result: unknown;
  /** Notes that add to the global exit table; empty when the table covers the verb. */
  exits: ExitCase[];
  /** Extra name-to-text table, as the settings fields. */
  fields?: Record<string, string>;
}

/** Return the synopsis of a verb built from its arguments and flags. */
export function usageLine(name: string, doc: VerbDoc): string {
  const args = doc.args.map((a) => (a.optional ? `[${a.name}]` : a.name));
  const flags = doc.flags.map((f) => {
    const text = f.value ? `--${f.name} ${f.value}` : `--${f.name}`;
    return f.required ? text : `[${text}]`;
  });
  return ['uv5r', name, ...args, ...flags].join(' ');
}

/** Return a flag's default as JSON: the declared default, false for a boolean flag, else null. */
function flagDefault(f: FlagDoc): string | number | boolean | null {
  if (f.default !== undefined) return f.default;
  if (f.required) return null;
  return f.value ? null : false;
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
    writesToRadio: doc.writesToRadio,
    result: doc.result,
    exits: doc.exits,
    ...(doc.fields ? { fields: doc.fields } : {}),
  };
}

/** Return one verb's help entry as text. */
export function verbText(name: string, doc: VerbDoc): string {
  const flagCol = (f: FlagDoc) => (f.value ? `--${f.name} ${f.value}` : `--${f.name}`);
  const width = Math.max(0, ...doc.flags.map((f) => flagCol(f).length), ...doc.args.map((a) => a.name.length));
  const flagNote = (f: FlagDoc) => {
    if (f.required) return ' (required)';
    return f.default === undefined ? '' : ` (default ${f.default})`;
  };
  const bullets = (items: string[]) => items.map((s) => `  - ${s}`);
  const codeWidth = Math.max(0, ...doc.exits.map((e) => String(e.code).length));
  return [
    `uv5r ${name}: ${doc.summary}`,
    '',
    `usage:   ${usageLine(name, doc)}`,
    `example: ${doc.example}`,
    ...(doc.args.length ? ['', 'arguments:', ...doc.args.map((a) => `  ${a.name.padEnd(width)}  ${a.help}${a.optional ? ' (optional)' : ''}`)] : []),
    '',
    'flags:',
    ...doc.flags.map((f) => `  ${flagCol(f).padEnd(width)}  ${f.help}${flagNote(f)}`),
    ...(doc.fields ? ['', 'fields:', ...Object.entries(doc.fields).map(([k, v]) => `  ${k.padEnd(8)} ${v}`)] : []),
    '',
    'effects:',
    ...bullets(doc.effects),
    '',
    'preconditions:',
    ...bullets(doc.preconditions),
    '',
    `writes to radio: ${doc.writesToRadio.writes ? 'yes' : 'no'}; ${doc.writesToRadio.note}`,
    '',
    'result:',
    `  ${JSON.stringify(doc.result)}`,
    ...(doc.exits.length ? ['', 'exit codes beyond uv5r help:', ...doc.exits.map((e) => `  ${String(e.code).padEnd(codeWidth)}  ${e.when}`)] : []),
  ].join('\n');
}
