import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/core/index.ts';
import { parseStation } from '../../src/tts/station.ts';

describe('parseStation', () => {
  it('reads every field', () => {
    const json = {
      callsign: 'KJ7ABC',
      outputDevice: 'AIOC Audio',
      inputDevice: 'AIOC Audio',
      model: 'models/ggml-base.en-q5_1.bin',
      voice: 'Samantha',
      leadMs: 300,
      tailMs: 400,
      maxSeconds: 30,
    };
    expect(parseStation(json)).toEqual(json);
  });

  it('returns an empty station for an empty object', () => {
    expect(parseStation({})).toEqual({});
  });

  it('ignores unknown keys', () => {
    expect(parseStation({ callsign: 'KJ7ABC', grid: 'DN45', lead: 3 })).toEqual({ callsign: 'KJ7ABC' });
  });

  it('takes the range ends of leadMs, tailMs and maxSeconds', () => {
    expect(parseStation({ leadMs: 0, tailMs: 5000, maxSeconds: 55 })).toEqual({ leadMs: 0, tailMs: 5000, maxSeconds: 55 });
  });

  it('says the range of an out-of-range number field', () => {
    expect(() => parseStation({ maxSeconds: 90 })).toThrow('station maxSeconds: takes 0 < S <= 55 seconds; got 90');
  });

  it('uppercases the callsign', () => {
    expect(parseStation({ callsign: 'kj7abc' }).callsign).toBe('KJ7ABC');
  });

  it.each([
    [{ callsign: 7 }, 'callsign'],
    [{ outputDevice: true }, 'outputDevice'],
    [{ inputDevice: null }, 'inputDevice'],
    [{ model: ['a'] }, 'model'],
    [{ voice: 3 }, 'voice'],
    [{ leadMs: '300' }, 'leadMs'],
    [{ leadMs: 5001 }, 'leadMs'],
    [{ tailMs: -1 }, 'tailMs'],
    [{ tailMs: null }, 'tailMs'],
    [{ maxSeconds: 0 }, 'maxSeconds'],
    [{ maxSeconds: 90 }, 'maxSeconds'],
    [{ callsign: 'KJ7/ABC' }, 'callsign'],
    [{ callsign: '' }, 'callsign'],
  ])('rejects %j naming %s', (json, field) => {
    try {
      parseStation(json);
      expect.fail('parseStation accepted the config');
    } catch (err) {
      expect(err).toBeInstanceOf(UsageError);
      expect((err as UsageError).reason).toBe('invalid-argument');
      expect((err as UsageError).detail.field).toBe(field);
    }
  });

  it.each([[[]], [null], ['KJ7ABC']])('rejects %j as the top level', (json) => {
    expect(() => parseStation(json)).toThrow(UsageError);
  });

  it('says a station config is an object for an array', () => {
    expect(() => parseStation([])).toThrow('a station config is an object');
  });

  it('says the callsign needs letters and digits for a hyphen', () => {
    expect(() => parseStation({ callsign: 'KJ7-ABC' })).toThrow('station callsign: needs letters and digits; got "KJ7-ABC"');
  });
});
