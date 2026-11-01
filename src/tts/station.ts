import { UsageError } from '../core/index.ts';

export const DEFAULT_VOICE = 'Samantha';
export const DEFAULT_LEAD_MS = 300;
export const DEFAULT_TAIL_MS = 400;
export const DEFAULT_MAX_SECONDS = 30;
/** Cap on leadMs and tailMs. */
export const MAX_PAD_MS = 5000;
/** Cap on maxSeconds, under the UV-5R default TOT of 60 s. */
export const MAX_UTTERANCE_SECONDS = 55;

/** The station config `uv5r.json` holds; every field is optional. */
export interface Station {
  /** Callsign the ID sentence spells, uppercased; letters and digits only. */
  callsign?: string;
  /** Output device name that `say` and `id` play into. */
  outputDevice?: string;
  /** Input device name that `hear` and `say --clear` capture from. */
  inputDevice?: string;
  /** Path of the whisper.cpp model that `hear` loads. */
  model?: string;
  /** macOS say voice that `say` and `id` synthesize with. */
  voice?: string;
  /** Milliseconds of silence before the speech while PTT rises, 0..MAX_PAD_MS. */
  leadMs?: number;
  /** Milliseconds PTT stays up after the player exits, 0..MAX_PAD_MS. */
  tailMs?: number;
  /** Cap in seconds on the padded WAV plus tailMs, 0 < S <= MAX_UTTERANCE_SECONDS. */
  maxSeconds?: number;
}

/** String fields a station config takes; other keys are ignored. */
const STRING_FIELDS = ['callsign', 'outputDevice', 'inputDevice', 'model', 'voice'] as const;

/** Number fields a station config takes, each with its range check and the range text its error names. */
const NUMBER_FIELDS = [
  { name: 'leadMs', ok: (n: number) => n >= 0 && n <= MAX_PAD_MS, range: `0..${MAX_PAD_MS} ms` },
  { name: 'tailMs', ok: (n: number) => n >= 0 && n <= MAX_PAD_MS, range: `0..${MAX_PAD_MS} ms` },
  { name: 'maxSeconds', ok: (n: number) => n > 0 && n <= MAX_UTTERANCE_SECONDS, range: `0 < S <= ${MAX_UTTERANCE_SECONDS} seconds` },
] as const;

/**
 * Validate a parsed station config. Unknown keys are ignored. A string field that holds
 * anything other than a string, a number field that holds anything other than a finite
 * number or falls outside its range, and a callsign with characters other than letters
 * and digits throw a UsageError naming the field.
 */
export function parseStation(json: unknown): Station {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new UsageError('a station config is an object');
  const raw = json as Record<string, unknown>;
  const station: Station = {};
  for (const name of STRING_FIELDS) {
    const value = raw[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new UsageError(`station ${name}: needs a string; got ${JSON.stringify(value)}`, { field: name });
    station[name] = value;
  }
  for (const { name, ok, range } of NUMBER_FIELDS) {
    const value = raw[name];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new UsageError(`station ${name}: needs a number; got ${JSON.stringify(value)}`, { field: name });
    if (!ok(value)) throw new UsageError(`station ${name}: takes ${range}; got ${value}`, { field: name });
    station[name] = value;
  }
  if (station.callsign !== undefined) {
    if (!/^[A-Za-z0-9]+$/.test(station.callsign)) throw new UsageError(`station callsign: needs letters and digits; got ${JSON.stringify(station.callsign)}`, { field: 'callsign' });
    station.callsign = station.callsign.toUpperCase();
  }
  return station;
}
