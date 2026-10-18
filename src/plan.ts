import { readFileSync } from 'node:fs';
import { parseDecimal } from './args.ts';
import { checkBand, checkChannelNumber, checkTenHz, encodeName, parseFrequency, parseTone, type ChannelSpec } from './codec.ts';
import { BaofengError, UsageError } from './errors.ts';

/** One plan entry, parsed into the slot number and the spec `tune` would write there. */
export interface PlanEntry {
  channel: number;
  spec: ChannelSpec;
  notes?: string;
}

export interface Plan {
  name?: string;
  notes?: string;
  entries: PlanEntry[];
}

/** Entry fields a plan takes; each one except `notes` maps onto one `tune` flag. */
const ENTRY_FIELDS = ['channel', 'rxMhz', 'offsetMhz', 'tone', 'rxTone', 'narrow', 'lowPower', 'rxOnly', 'name', 'notes'];

type Raw = Record<string, unknown>;

function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse the plan file at `file`. Validates every entry, so a bad plan exits 2 before the
 * port opens. Errors name the channel, or the entry index when the channel is unreadable,
 * and the field.
 */
export function readPlan(file: string): Plan {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${file}: ${(err as NodeJS.ErrnoException).message}`, { file });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${file} is not JSON: ${(err as Error).message}`, { file });
  }
  return parsePlan(json);
}

/** Validate a parsed plan object and build one ChannelSpec per entry. */
export function parsePlan(json: unknown): Plan {
  if (!isObject(json) || !Array.isArray(json.channels)) throw new UsageError('a plan is an object with a channels array');
  if (json.channels.length === 0) throw new UsageError('the plan has no channels');
  const seen = new Set<number>();
  const entries = json.channels.map((raw, i) => {
    const entry = parseEntry(raw, i + 1);
    if (seen.has(entry.channel)) throw new UsageError(`plan channel ${entry.channel}: listed twice`, { channel: entry.channel, field: 'channel' });
    seen.add(entry.channel);
    return entry;
  });
  return {
    ...(typeof json.name === 'string' ? { name: json.name } : {}),
    ...(typeof json.notes === 'string' ? { notes: json.notes } : {}),
    entries,
  };
}

function parseEntry(raw: unknown, index: number): PlanEntry {
  if (!isObject(raw)) throw new UsageError(`plan entry ${index}: not an object`, { entry: index });
  const where = typeof raw.channel === 'number' ? `plan channel ${raw.channel}` : `plan entry ${index}`;
  const at = typeof raw.channel === 'number' ? { channel: raw.channel } : { entry: index };

  /** Run `fn` on one field and rethrow a UsageError with the channel and field in front. */
  const field = <T>(name: string, fn: (v: unknown) => T): T => {
    try {
      return fn(raw[name]);
    } catch (err) {
      if (!(err instanceof BaofengError)) throw err;
      throw new UsageError(`${where}, ${name}: ${err.message}`, { ...err.detail, ...at, field: name });
    }
  };
  const optional = <T>(name: string, fn: (v: unknown) => T): T | undefined => (raw[name] === undefined ? undefined : field(name, fn));

  const unknown = Object.keys(raw).find((name) => !ENTRY_FIELDS.includes(name));
  if (unknown !== undefined) {
    throw new UsageError(`${where}, ${unknown}: unknown field; plan fields: ${ENTRY_FIELDS.join(', ')}`, { ...at, field: unknown });
  }

  const channel = field('channel', (v) => {
    if (typeof v !== 'number') throw new UsageError(`needs a number 0..127; got ${JSON.stringify(v)}`);
    checkChannelNumber(v);
    return v;
  });
  const rxHz = field('rxMhz', (v) => {
    if (v === undefined) throw new UsageError('missing');
    const hz = parseFrequency(numberText(v));
    checkBand(hz);
    return hz;
  });
  const rxOnly = optional('rxOnly', bool) ?? false;
  const offsetHz = optional('offsetMhz', (v) => {
    if (rxOnly) throw new UsageError('conflicts with rxOnly; a receive-only channel has no TX frequency');
    const text = numberText(v);
    return checkTenHz(parseDecimal(text, 'offsetMhz') * 1_000_000, `offsetMhz ${text}`);
  });
  const txHz = rxOnly ? undefined : rxHz + (offsetHz ?? 0);
  if (txHz !== undefined) field('offsetMhz', () => checkBand(txHz));
  const name = optional('name', (v) => {
    if (typeof v !== 'string') throw new UsageError(`needs a string; got ${JSON.stringify(v)}`);
    encodeName(v);
    return v;
  });
  const notes = optional('notes', (v) => {
    if (typeof v !== 'string') throw new UsageError(`needs a string; got ${JSON.stringify(v)}`);
    return v;
  });
  return {
    channel,
    spec: {
      rxHz,
      txHz,
      rxOnly,
      txTone: parseTone(optional('tone', toneText) ?? 'none'),
      rxTone: parseTone(optional('rxTone', toneText) ?? 'none'),
      wide: !(optional('narrow', bool) ?? false),
      lowPower: optional('lowPower', bool) ?? false,
      name,
    },
    ...(notes === undefined ? {} : { notes }),
  };
}

function numberText(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  throw new UsageError(`needs a number; got ${JSON.stringify(v)}`);
}

/** Return the tone text after parseTone accepts it, so a bad tone fails inside its field. */
function toneText(v: unknown): string {
  if (typeof v !== 'string' && typeof v !== 'number') throw new UsageError(`needs a string such as "82.5"; got ${JSON.stringify(v)}`);
  parseTone(String(v));
  return String(v);
}

function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new UsageError(`needs true or false; got ${JSON.stringify(v)}`);
  return v;
}
