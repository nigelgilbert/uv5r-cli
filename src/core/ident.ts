import { UsageError } from './errors.ts';

/**
 * Magic tables and radio classification for the clone handshake, from docs/clone-protocol.md
 * sections 4 and 9. Nothing here touches the port.
 */

/** Radio families the classification can report; `unknown` keeps every verb working. */
export type Family = 'uv5r' | 'bf-f8hp' | 'kt-980hp' | 'uv-5g' | 'uv-82' | 'uv-82hp' | 'uv-82x3' | 'f-11' | 'uv-6' | 'unknown';

/** Names of the eight classic magics. */
export type MagicName = '291' | 'ORIG' | 'A58' | 'UV82' | 'F11' | 'UV6' | 'UV6_ORIG' | 'UV5G';

/** One classic magic: its bytes, the families that answer it, and whether this CLI opens sessions with it. */
export interface Magic {
  name: MagicName;
  bytes: Uint8Array;
  families: readonly Family[];
  supported: boolean;
}

const magic = (name: MagicName, bytes: number[], families: Family[], supported = true): Magic => ({ name, bytes: Uint8Array.from(bytes), families, supported });

/** The eight classic magics in the order of spec section 4.1. */
export const MAGICS: readonly Magic[] = [
  magic('291', [0x50, 0xbb, 0xff, 0x20, 0x12, 0x07, 0x25], ['uv5r', 'bf-f8hp', 'kt-980hp']),
  magic('ORIG', [0x50, 0xbb, 0xff, 0x01, 0x25, 0x98, 0x4d], ['uv5r']),
  magic('A58', [0x50, 0xbb, 0xff, 0x20, 0x14, 0x04, 0x13], ['bf-f8hp']),
  magic('UV82', [0x50, 0xbb, 0xff, 0x20, 0x13, 0x01, 0x05], ['uv-82', 'uv-82hp', 'uv-82x3']),
  magic('F11', [0x50, 0xbb, 0xff, 0x13, 0xa1, 0x11, 0xdd], ['f-11'], false),
  magic('UV6', [0x50, 0xbb, 0xff, 0x20, 0x12, 0x08, 0x23], ['uv-6'], false),
  magic('UV6_ORIG', [0x50, 0xbb, 0xff, 0x12, 0x03, 0x98, 0x4d], ['uv-6'], false),
  magic('UV5G', [0x50, 0xbb, 0xff, 0x20, 0x12, 0x06, 0x25], ['uv-5g']),
];

/** The magic every verb opens with when UV5R_MAGIC is unset. */
export const DEFAULT_MAGIC: MagicName = '291';

/** The order `identify` tries the classic magics in. */
export const SCAN_ORDER: readonly MagicName[] = ['291', 'ORIG', 'UV82', 'A58', 'UV5G', 'F11', 'UV6', 'UV6_ORIG'];

/** 7-byte magics of other drivers on the same 9600 link, with the radio a reply names. */
export const FOREIGN_MAGICS: ReadonlyArray<{ radio: string; bytes: Uint8Array }> = [
  { radio: 'BTECH UV-5X3', bytes: Uint8Array.from([0x50, 0x0d, 0x0c, 0x20, 0x16, 0x03, 0x28]) },
  { radio: 'MTC UV-5R-3', bytes: Uint8Array.from([0x50, 0x0d, 0x0c, 0x20, 0x17, 0x09, 0x19]) },
  { radio: 'UV-6R', bytes: Uint8Array.from([0x50, 0xbb, 0xff, 0x20, 0x14, 0x11, 0x22]) },
  { radio: 'UV-9G', bytes: Uint8Array.from([0x50, 0xbb, 0xff, 0x20, 0x12, 0x05, 0x25]) },
  { radio: 'Baojie BJ-UV55', bytes: Uint8Array.from([0x50, 0xbb, 0xdd, 0x55, 0x63, 0x98, 0x4d]) },
];

/** 16-byte ASCII magics of the UV17Pro family at 115200 baud, with the model group an ack names. */
export const PROGRAM_MAGICS: ReadonlyArray<{ name: string; radio: string; bytes: Uint8Array }> = [
  ['PROGRAMBFNORMALU', 'UV17Pro family: UV-17Pro, UV-21ProV2, UV-25, 5RM, P15, MT-5RM, K5-Plus, UV-5RM Plus, UV-17R-Plus, UV-5RH'],
  ['PROGRAMCOLORPROU', 'UV17Pro family: UV-17ProGPS, GM-21, GM-30 Plus/Pro, UV-32, UV-21ProGPS, UV-28Plus, UV-5R Mini'],
].map(([name, radio]) => ({ name: name!, radio: radio!, bytes: Uint8Array.from(Buffer.from(name!, 'latin1')) }));

/**
 * Firmware substrings by family in match order, most specific first, after spec section 4.6
 * step 5. `classify` tries only the entries whose family the answering magic lists, so the
 * magic resolves the overlaps of `N5R2` and `N5RV`.
 */
export const BASETYPES: ReadonlyArray<{ family: Family; strings: readonly string[] }> = [
  { family: 'kt-980hp', strings: ['BFP3V3 B'] },
  { family: 'bf-f8hp', strings: ['BFP3V3 F', 'N5R-3', 'N5R3', 'F5R3', 'BFT'] },
  { family: 'uv-82hp', strings: ['N82-3', 'N823'] },
  { family: 'uv-82', strings: ['US2S2', 'B82S', 'BF82', 'N82-2', 'N822'] },
  { family: 'f-11', strings: ['USA'] },
  { family: 'uv-6', strings: ['BF1', 'UV6'] },
  { family: 'uv-82hp', strings: ['N5R2'] },
  { family: 'uv5r', strings: ['N5R2', 'N5RV'] },
  { family: 'bf-f8hp', strings: ['N5RV'] },
  { family: 'uv5r', strings: ['BFS', 'BFB', 'N5R-2', 'BTS', 'D5R2', 'B5R2'] },
];

/** Family the HN5RV01 rule gives per magic; the rule runs before the family filter. */
const HN5RV01 = 'HN5RV01';
const HN5RV01_FAMILY: Partial<Record<MagicName, Family>> = { '291': 'uv5r', UV5G: 'uv-5g', UV82: 'uv-82x3' };

/** Families that can be orig. */
const ORIG_FAMILIES: readonly Family[] = ['uv5r', 'uv-5g', 'unknown'];
/** Orig radios run firmware below BFB291. */
const ORIG_BELOW = 291;
/** Orig radios below BFB251 take the voice prompt as a boolean. */
const VOICE_LIST_FROM = 251;
const TRI_POWER: readonly Family[] = ['kt-980hp', 'bf-f8hp', 'uv-82hp'];
/** DTMF character tables, selected by the first 7 version bytes. */
export const DTMF_TABLES = { hn5rv01: '0123456789ABCD*#', classic: '0123456789 *#ABCD' } as const;

/** Feature flags derived from the magic, the version string and the ident; reported only. */
export interface IdentFlags {
  /** The basetype string that set the family, or null when none matched. */
  basetype: string | null;
  /** Firmware before BFB291 on a magic and family that can be orig. */
  orig: boolean;
  /** The voice prompt setting is on/off. */
  voiceBool: boolean;
  /** The second band is 220-260 MHz. */
  band220: boolean;
  triPower: boolean;
  /** DTMF characters in code order. */
  dtmfTable: (typeof DTMF_TABLES)[keyof typeof DTMF_TABLES];
}

export interface Classification {
  family: Family;
  flags: IdentFlags;
}

/** Return the magic named `name`, or undefined. */
function findMagic(name: string): Magic | undefined {
  return MAGICS.find((m) => m.name === name);
}

/** Return the supported magic named `name` for UV5R_MAGIC; throw UsageError listing the supported names otherwise. */
export function magicByName(name: string): Magic {
  const found = findMagic(name);
  if (found?.supported) return found;
  const supported = SCAN_ORDER.filter((n) => findMagic(n)!.supported);
  const why = found ? 'names a radio this CLI does not support' : 'names no magic';
  throw new UsageError(
    `UV5R_MAGIC ${JSON.stringify(name.slice(0, 40))} ${why}; supported: ${supported.join(', ')}`,
    { env: 'UV5R_MAGIC', supported },
    { remedy: `set UV5R_MAGIC to one of ${supported.join(', ')}, or unset it for ${DEFAULT_MAGIC}` },
  );
}

/** The 12-byte ident keeps these positions; the other four hold 01. */
const LONG_IDENT_KEEP = [0, 3, 5, 7, 8, 9, 10, 11];

export type ParsedIdent = { kind: 'ident'; bytes: Uint8Array } | { kind: 'foreign'; name: string } | { kind: 'invalid' };

/** Parse the reply to `02`: 8 bytes as is, 12 bytes collapsed to 8, a 14-byte AA..DD reply as a UV-5X3-type radio. */
export function parseIdent(reply: Uint8Array): ParsedIdent {
  if (reply.length === 8) return { kind: 'ident', bytes: Uint8Array.from(reply) };
  if (reply.length === 12) return { kind: 'ident', bytes: Uint8Array.from(LONG_IDENT_KEEP, (i) => reply[i]!) };
  if (reply.length === 14 && reply[0] === 0xaa && reply[13] === 0xdd) return { kind: 'foreign', name: 'UV-5X3-type radio' };
  return { kind: 'invalid' };
}

/** Return the family and basetype for `version`, keeping a single-family magic's family on no hit. */
function matchFamily(m: Magic | undefined, version: string): { family: Family; basetype: string | null } {
  const families = m?.families ?? [];
  const pinned = m ? HN5RV01_FAMILY[m.name] : undefined;
  if (pinned && version.includes(HN5RV01)) return { family: pinned, basetype: HN5RV01 };
  for (const { family, strings } of BASETYPES) {
    if (!families.includes(family)) continue;
    const hit = strings.find((s) => version.includes(s));
    if (hit) return { family, basetype: hit };
  }
  return { family: families.length === 1 ? families[0]! : 'unknown', basetype: null };
}

/** Return the BFB number when the three bytes after the first BFB are ASCII digits, else undefined. */
function bfbNumber(version: string): number | undefined {
  const at = version.indexOf('BFB');
  if (at < 0) return undefined;
  const digits = version.slice(at + 3, at + 6);
  return /^\d{3}$/.test(digits) ? Number(digits) : undefined;
}

/**
 * Classify the radio from the magic that answered, the 14 raw version bytes at 0x1EF0 and
 * the 8-byte ident. Never throws; an unmatched version string gives the magic's family when
 * it lists one, and `unknown` otherwise.
 */
export function classify(magicName: string, versionBytes: Uint8Array, identBytes: Uint8Array): Classification {
  const m = findMagic(magicName);
  const version = Buffer.from(versionBytes).toString('latin1');
  const { family, basetype } = matchFamily(m, version);
  const bfb = bfbNumber(version);
  const canBeOrig = (m?.families ?? []).some((f) => f === 'uv5r' || f === 'uv-5g') && ORIG_FAMILIES.includes(family);
  const orig = canBeOrig && bfb !== undefined && bfb < ORIG_BELOW;
  return {
    family,
    flags: {
      basetype,
      orig,
      voiceBool: orig && bfb! < VOICE_LIST_FROM,
      band220: !orig && identBytes[3] === 0x02,
      triPower: TRI_POWER.includes(family),
      dtmfTable: version.slice(0, 7) === HN5RV01 ? DTMF_TABLES.hn5rv01 : DTMF_TABLES.classic,
    },
  };
}
