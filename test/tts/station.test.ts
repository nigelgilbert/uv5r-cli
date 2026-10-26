import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/core/index.ts';
import { parseStation } from '../../src/speech/station.ts';

describe('parseStation', () => {
  it('reads every field', () => {
    expect(parseStation({ callsign: 'KJ7ABC', outputDevice: 'AIOC Audio', inputDevice: 'AIOC Audio', model: 'models/ggml-base.en-q5_1.bin' })).toEqual({
      callsign: 'KJ7ABC',
      outputDevice: 'AIOC Audio',
      inputDevice: 'AIOC Audio',
      model: 'models/ggml-base.en-q5_1.bin',
    });
  });

  it('returns an empty station for an empty object', () => {
    expect(parseStation({})).toEqual({});
  });

  it('ignores unknown keys', () => {
    expect(parseStation({ callsign: 'KJ7ABC', grid: 'DN45', voice: 3 })).toEqual({ callsign: 'KJ7ABC' });
  });

  it('uppercases the callsign', () => {
    expect(parseStation({ callsign: 'kj7abc' }).callsign).toBe('KJ7ABC');
  });

  it.each([
    [{ callsign: 7 }, 'callsign'],
    [{ outputDevice: true }, 'outputDevice'],
    [{ inputDevice: null }, 'inputDevice'],
    [{ model: ['a'] }, 'model'],
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
