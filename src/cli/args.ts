import { parseDecimal, UsageError } from '../core/index.ts';

export { parseDecimal };

export interface ParsedArgs {
  verb: string | undefined;
  positionals: string[];
  flags: Map<string, string | true>;
}

/**
 * Split argv into a verb, positionals and `--flag [value]` pairs. `-h` stands for `--help`.
 * Every argument after the first `--` is a positional, so text may start with a dash. Throw
 * UsageError on a value given to a boolean flag and on a flag given twice, except `--help`.
 */
export function parseArgs(argv: string[], booleanFlags: ReadonlySet<string>): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  const set = (name: string, value: string | true) => {
    if (flags.has(name) && name !== 'help') throw new UsageError(`--${name} given twice; pass it once`, { flag: name });
    flags.set(name, value);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      set('help', true);
      continue;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      const name = arg.slice(2, eq);
      if (booleanFlags.has(name)) throw new UsageError(`--${name} takes no value`);
      set(name, arg.slice(eq + 1));
    } else if (booleanFlags.has(arg.slice(2))) {
      set(arg.slice(2), true);
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) set(arg.slice(2), true);
      else {
        set(arg.slice(2), next);
        i++;
      }
    }
  }
  const [verb, ...rest] = positionals;
  return { verb, positionals: rest, flags };
}

export function checkFlags(verb: string, flags: Map<string, string | true>, allowed: readonly string[]): void {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) throw new UsageError(`uv5r ${verb}: unknown option --${name}; run uv5r help ${verb}`, { flag: name });
  }
}

/** Throw UsageError when the verb got more than `max` positionals. */
export function checkPositionals(verb: string, positionals: readonly string[], max: number, usage: string): void {
  if (positionals.length <= max) return;
  const unexpected = positionals.slice(max);
  throw new UsageError(`uv5r ${verb}: unexpected argument ${JSON.stringify(unexpected[0])}; usage: ${usage}`, { unexpected });
}

export function stringFlag(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  if (v === true) throw new UsageError(`--${name} needs a value`);
  return v;
}

export function numberFlag(flags: Map<string, string | true>, name: string): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  return parseDecimal(raw, `--${name}`);
}
