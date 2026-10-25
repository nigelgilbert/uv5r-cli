import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hex } from '../../src/core/protocol.ts';
import { IMAGE_AUX, IMAGE_HEADER } from '../../src/core/radio.ts';
import { AUX_SIZE, GOLDEN, type GoldenUnit } from './golden.ts';

/** Image offset of the 14-byte version string in the aux block. */
const VERSION_AT = IMAGE_AUX + 48;
const VERSION_LENGTH = 14;

/** The sha256 of the aux block of `image` as hex. */
function auxSha256(image: Uint8Array): string {
  return createHash('sha256').update(image.subarray(IMAGE_AUX, IMAGE_AUX + AUX_SIZE)).digest('hex');
}

/** The version string of `image` with bytes outside 0x20..0x7E dropped, as `Session.finish` reads it. */
function firmware(image: Uint8Array): string {
  return Buffer.from(image.subarray(VERSION_AT, VERSION_AT + VERSION_LENGTH))
    .toString('latin1')
    .replace(/[^\x20-\x7e]/g, '')
    .trim();
}

describe('golden set', () => {
  it.each(GOLDEN)('unit $label matches its manifest entry', ({ image, manifest }: GoldenUnit) => {
    expect(hex(image.subarray(0, IMAGE_HEADER))).toBe(manifest.ident);
    expect(firmware(image)).toBe(manifest.firmware);
    expect(auxSha256(image)).toBe(manifest.auxSha256);
  });

  it('holds a distinct aux block for each radio', () => {
    const hashes = GOLDEN.filter((unit) => unit.manifest.sameRadioAs === undefined).map((unit) => auxSha256(unit.image));
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
