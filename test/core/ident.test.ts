import { describe, expect, it } from 'vitest';
import { UsageError } from '../../src/core/errors.ts';
import {
  BASETYPES,
  DEFAULT_MAGIC,
  DTMF_TABLES,
  FOREIGN_MAGICS,
  MAGICS,
  PROGRAM_MAGICS,
  SCAN_ORDER,
  classify,
  magicByName,
  parseIdent,
  type Family,
  type MagicName,
} from '../../src/core/ident.ts';
import { hex } from '../../src/core/protocol.ts';

/** The bench ident: post-291 band limits, byte 3 is 04. */
const IDENT = Uint8Array.from([0xaa, 0x30, 0x76, 0x04, 0x00, 0x05, 0x20, 0xdd]);
/** An ident whose byte 3 marks a 220 MHz second band. */
const IDENT_220 = Uint8Array.from([0xaa, 0x36, 0x74, 0x02, 0x20, 0x02, 0x60, 0xdd]);

/** Return `text` as the 14 version bytes, padded with 0xFF. */
function version(text: string, pad = 0xff): Uint8Array {
  const out = new Uint8Array(14).fill(pad);
  out.set(Buffer.from(text, 'latin1').subarray(0, 14));
  return out;
}

const family = (magic: MagicName, text: string) => classify(magic, version(text), IDENT).family;

describe('magic table', () => {
  it.each([
    ['291', '50 bb ff 20 12 07 25', ['uv5r', 'bf-f8hp', 'kt-980hp'], true],
    ['ORIG', '50 bb ff 01 25 98 4d', ['uv5r'], true],
    ['A58', '50 bb ff 20 14 04 13', ['bf-f8hp'], true],
    ['UV82', '50 bb ff 20 13 01 05', ['uv-82', 'uv-82hp', 'uv-82x3'], true],
    ['F11', '50 bb ff 13 a1 11 dd', ['f-11'], false],
    ['UV6', '50 bb ff 20 12 08 23', ['uv-6'], false],
    ['UV6_ORIG', '50 bb ff 12 03 98 4d', ['uv-6'], false],
    ['UV5G', '50 bb ff 20 12 06 25', ['uv-5g'], true],
  ] as const)('maps magic %s to its bytes and families', (name, bytes, families, supported) => {
    const m = MAGICS.find((x) => x.name === name)!;
    expect(hex(m.bytes)).toBe(bytes);
    expect(m.families).toEqual(families);
    expect(m.supported).toBe(supported);
  });

  it('holds the eight classic magics, defaults to 291 and scans every one', () => {
    expect(MAGICS.map((m) => m.name)).toEqual(['291', 'ORIG', 'A58', 'UV82', 'F11', 'UV6', 'UV6_ORIG', 'UV5G']);
    expect(DEFAULT_MAGIC).toBe('291');
    expect(SCAN_ORDER).toEqual(['291', 'ORIG', 'UV82', 'A58', 'UV5G', 'F11', 'UV6', 'UV6_ORIG']);
  });

  it('keeps 7-byte foreign magics and 16-byte ASCII program magics', () => {
    expect(FOREIGN_MAGICS.map((f) => [f.radio, hex(f.bytes)])).toEqual([
      ['BTECH UV-5X3', '50 0d 0c 20 16 03 28'],
      ['MTC UV-5R-3', '50 0d 0c 20 17 09 19'],
      ['UV-6R', '50 bb ff 20 14 11 22'],
      ['UV-9G', '50 bb ff 20 12 05 25'],
      ['Baojie BJ-UV55', '50 bb dd 55 63 98 4d'],
    ]);
    for (const p of PROGRAM_MAGICS) expect(Buffer.from(p.bytes).toString('latin1')).toMatch(/^PROGRAM.{8}U$/);
    expect(PROGRAM_MAGICS).toHaveLength(6);
  });
});

describe('magicByName', () => {
  it('returns a supported magic by name', () => {
    expect(magicByName('UV82').name).toBe('UV82');
    expect(magicByName('291')).toBe(MAGICS[0]);
  });

  it.each(['BOGUS', 'UV6', 'F11', 'UV6_ORIG', 'orig', ''])('throws a UsageError listing the supported names for %j', (name) => {
    const err = (() => {
      try {
        magicByName(name);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).message).toContain('supported: 291, ORIG, UV82, A58, UV5G');
    expect((err as UsageError).detail).toMatchObject({ env: 'UV5R_MAGIC', supported: ['291', 'ORIG', 'UV82', 'A58', 'UV5G'] });
  });
});

describe('basetypes', () => {
  /** A magic whose families include each family. */
  const HOME: Record<Exclude<Family, 'unknown' | 'uv-5g'>, MagicName> = {
    uv5r: 'ORIG',
    'bf-f8hp': 'A58',
    'kt-980hp': '291',
    'uv-82': 'UV82',
    'uv-82hp': 'UV82',
    'uv-82x3': 'UV82',
    'f-11': 'F11',
    'uv-6': 'UV6',
  };
  const cases = BASETYPES.flatMap(({ family: f, strings }) => strings.map((s) => [s, f] as const));

  it.each(cases)('lands %s on %s with a magic whose families include it', (s, f) => {
    const magic = HOME[f as keyof typeof HOME];
    expect(classify(magic, version(s), IDENT)).toMatchObject({ family: f, flags: { basetype: s } });
  });

  it.each(cases)('ignores %s (%s) with a magic whose families exclude it', (s, f) => {
    const magic: MagicName = f === 'uv-6' ? 'ORIG' : 'UV6';
    const blank = classify(magic, version(''), IDENT);
    expect(classify(magic, version(s), IDENT)).toMatchObject({ family: blank.family, flags: { basetype: null } });
  });

  it('gives uv5r for HN5RV011 with magic 291, uv-82x3 with UV82 and uv-5g with UV5G', () => {
    expect(classify('291', version('HN5RV011'), IDENT)).toMatchObject({ family: 'uv5r', flags: { basetype: 'HN5RV01' } });
    expect(family('UV82', 'HN5RV011')).toBe('uv-82x3');
    expect(family('UV5G', 'HN5RV011')).toBe('uv-5g');
  });

  it('runs the HN5RV01 rule first: HN5RV01N5R3 with magic 291 gives uv5r', () => {
    expect(family('291', 'HN5RV01N5R3')).toBe('uv5r');
  });

  it('gives uv5r for N5RV with magic 291 and bf-f8hp with A58', () => {
    expect(family('291', 'N5RV')).toBe('uv5r');
    expect(family('A58', 'N5RV')).toBe('bf-f8hp');
  });

  it('resolves N5R2 by the magic: uv5r with 291, uv-82hp with UV82', () => {
    expect(family('291', 'N5R2401BFB297')).toBe('uv5r');
    expect(family('UV82', 'N5R2401BFB297')).toBe('uv-82hp');
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['all-00', new Uint8Array(14)],
    ['all-FF', new Uint8Array(14).fill(0xff)],
    ['all-space', new Uint8Array(14).fill(0x20)],
  ])('gives unknown for %s firmware with magic 291 and uv5r with ORIG', (_what, bytes) => {
    expect(classify('291', bytes, IDENT)).toMatchObject({ family: 'unknown', flags: { basetype: null, orig: false } });
    expect(classify('ORIG', bytes, IDENT)).toMatchObject({ family: 'uv5r', flags: { basetype: null, orig: false } });
  });

  it('sets triPower for the three-power families only', () => {
    expect(classify('A58', version('N5R3401'), IDENT).flags.triPower).toBe(true);
    expect(classify('291', version('BFP3V3 B'), IDENT).flags.triPower).toBe(true);
    expect(classify('UV82', version('N82-3'), IDENT).flags.triPower).toBe(true);
    expect(classify('291', version('HN5RV011'), IDENT).flags.triPower).toBe(false);
  });
});

describe('orig and voice', () => {
  it.each(['  Ver  BFB231 ', '  Ver  BFB250 '])('gives orig and voiceBool for %j with magic ORIG', (text) => {
    expect(classify('ORIG', version(text, 0x20), IDENT)).toEqual({
      family: 'uv5r',
      flags: { basetype: 'BFB', orig: true, voiceBool: true, band220: false, triPower: false, dtmfTable: DTMF_TABLES.classic },
    });
  });

  it('gives orig and a voice list for BFB260 with magic ORIG', () => {
    expect(classify('ORIG', version('  Ver  BFB260 ', 0x20), IDENT)).toMatchObject({ family: 'uv5r', flags: { orig: true, voiceBool: false } });
  });

  it('gives orig false and uv5r for BFB29x with magic 291 without throwing', () => {
    expect(classify('291', version('BFB29x'), IDENT)).toMatchObject({ family: 'uv5r', flags: { basetype: 'BFB', orig: false, voiceBool: false } });
  });

  it('gives orig false for BFB297 with magic 291', () => {
    expect(classify('291', version('BFB297'), IDENT)).toMatchObject({ family: 'uv5r', flags: { orig: false } });
  });

  it('gives orig false and unknown for BFB231 with magic UV82', () => {
    expect(classify('UV82', version('  Ver  BFB231 ', 0x20), IDENT)).toMatchObject({ family: 'unknown', flags: { basetype: null, orig: false, voiceBool: false } });
  });

  it('gives orig false for BFB231 on a family that is never orig, BF-F8HP with magic A58', () => {
    expect(classify('A58', version('BFT BFB231'), IDENT)).toMatchObject({ family: 'bf-f8hp', flags: { orig: false } });
  });
});

describe('band220 and dtmfTable', () => {
  it('sets band220 from ident byte 3 = 02 on a non-orig radio only', () => {
    expect(classify('291', version('HN5RV011'), IDENT_220).flags.band220).toBe(true);
    expect(classify('291', version('HN5RV011'), IDENT).flags.band220).toBe(false);
    expect(classify('ORIG', version('  Ver  BFB231 ', 0x20), IDENT_220).flags).toMatchObject({ orig: true, band220: false });
  });

  it('sets the HN5RV01 DTMF table for HN5RV011 with magic 291 and the classic table otherwise', () => {
    expect(classify('291', version('HN5RV011'), IDENT).flags.dtmfTable).toBe('0123456789ABCD*#');
    expect(classify('291', version('BFB297'), IDENT).flags.dtmfTable).toBe('0123456789 *#ABCD');
    expect(classify('291', version('HN5RV001'), IDENT).flags.dtmfTable).toBe('0123456789 *#ABCD');
  });

  it('never throws on arbitrary bytes or an unknown magic name', () => {
    for (let seed = 0; seed < 256; seed++) {
      const bytes = Uint8Array.from({ length: 14 }, (_, i) => (seed * 31 + i * 17) & 0xff);
      for (const name of [...SCAN_ORDER, 'BOGUS']) expect(() => classify(name, bytes, bytes.subarray(0, seed % 9))).not.toThrow();
    }
    expect(classify('BOGUS', version('HN5RV011'), IDENT).family).toBe('unknown');
  });
});

describe('parseIdent', () => {
  it('accepts an 8-byte ident as it is', () => {
    expect(parseIdent(IDENT)).toEqual({ kind: 'ident', bytes: IDENT });
  });

  it('collapses a 12-byte ident to 8 bytes', () => {
    const long = Uint8Array.from([0xaa, 0x01, 0x01, 0x36, 0x01, 0x74, 0x01, 0x04, 0x00, 0x05, 0x20, 0xdd]);
    expect(parseIdent(long)).toEqual({ kind: 'ident', bytes: Uint8Array.from([0xaa, 0x36, 0x74, 0x04, 0x00, 0x05, 0x20, 0xdd]) });
  });

  it('names a UV-5X3-type radio from a 14-byte AA .. DD reply', () => {
    const reply = Uint8Array.from([0xaa, ...new Array(12).fill(0x30), 0xdd]);
    expect(parseIdent(reply)).toEqual({ kind: 'foreign', name: 'UV-5X3-type radio' });
  });

  it.each([
    ['9 bytes', new Uint8Array(9).fill(0xaa)],
    ['14 bytes without the AA .. DD frame', new Uint8Array(14)],
    ['no bytes', new Uint8Array(0)],
  ])('rejects %s', (_what, reply) => {
    expect(parseIdent(reply)).toEqual({ kind: 'invalid' });
  });
});
