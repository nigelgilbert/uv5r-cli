import { UsageError } from '../core/index.ts';

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
}

/** Fields a station config takes; other keys are ignored. */
const STATION_FIELDS = ['callsign', 'outputDevice', 'inputDevice', 'model'] as const;

/**
 * Validate a parsed station config. Unknown keys are ignored. A known key that holds
 * anything other than a string, or a callsign with characters other than letters and
 * digits, throws a UsageError naming the field.
 */
export function parseStation(json: unknown): Station {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new UsageError('a station config is an object');
  const raw = json as Record<string, unknown>;
  const station: Station = {};
  for (const name of STATION_FIELDS) {
    const value = raw[name];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new UsageError(`station ${name}: needs a string; got ${JSON.stringify(value)}`, { field: name });
    station[name] = value;
  }
  if (station.callsign !== undefined) {
    if (!/^[A-Za-z0-9]+$/.test(station.callsign)) throw new UsageError(`station callsign: needs letters and digits; got ${JSON.stringify(station.callsign)}`, { field: 'callsign' });
    station.callsign = station.callsign.toUpperCase();
  }
  return station;
}
