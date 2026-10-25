import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CHANNEL_BASE, CHANNEL_COUNT, NAME_BASE, decodeSettings, encodeChannel, type Channel } from '../../src/core/codec.ts';
import { hex } from '../../src/core/protocol.ts';
import { IMAGE_AUX, IMAGE_HEADER, channelPayload, decodeSlot, imageSettingsBlock, type MalformedRecord } from '../../src/core/radio.ts';
import { AUX_SIZE, GOLDEN, type Expected, type GoldenUnit } from './golden.ts';

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

/** Bits of each channel record byte that encodeChannel gives back from the decoded channel and its prior record. */
const ROUND_TRIP_MASKS = [...Array<number>(12).fill(0xff), 0x0f, 0xff, 0x01, 0x4f];

/** The channel record and name record of slot `n` in `image`. */
function slotRecords(image: Uint8Array, n: number): { mem: Uint8Array; name: Uint8Array } {
  const mem = IMAGE_HEADER + CHANNEL_BASE + n * 16;
  const name = IMAGE_HEADER + NAME_BASE + n * 16;
  return { mem: image.subarray(mem, mem + 16), name: image.subarray(name, name + 16) };
}

/** Decode slot `n` of `image`. */
function imageSlot(image: Uint8Array, n: number): Channel | MalformedRecord | undefined {
  const { mem, name } = slotRecords(image, n);
  return decodeSlot(mem, name);
}

/** The settings and every slot of `image`, as `settings --json` and `read --json` print them. */
function decodeImage(image: Uint8Array): Expected {
  const slots = Array.from({ length: CHANNEL_COUNT }, (_, n) => channelPayload(n, imageSlot(image, n)));
  return { settings: decodeSettings(imageSettingsBlock(image)), slots };
}

/** The bytes of `record` under ROUND_TRIP_MASKS as hex. */
function masked(record: Uint8Array): string {
  return hex(record.map((b, i) => b & ROUND_TRIP_MASKS[i]!));
}

/** Every manifest `displayed` entry with the label and expectations of its unit. */
const DISPLAYED = GOLDEN.flatMap(({ label, manifest, expected }) => manifest.displayed.map((entry) => ({ label, slot: entry.slot, entry, expected })));

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

  it.each(GOLDEN)('unit $label decodes to its JSON snapshot', async ({ image, expectedFile }: GoldenUnit) => {
    await expect(`${JSON.stringify(decodeImage(image), null, 2)}\n`).toMatchFileSnapshot(`../../fixtures/golden/${expectedFile}`);
  });

  it.each(DISPLAYED)('unit $label slot $slot matches the radio display', ({ entry, expected }) => {
    if (expected === undefined) throw new Error('run vitest -u to write the unit JSON, then check it against the radio display');
    const slot = expected.slots.find((s) => s.channel === entry.slot);
    if (slot === undefined || !('rxMhz' in slot)) throw new Error(`slot ${entry.slot} holds no channel in the unit JSON`);
    expect(Number(slot.rxMhz)).toBe(Number(entry.rxMhz));
    if (entry.name !== undefined) expect(slot.name).toBe(entry.name);
  });

  it.each(GOLDEN)('unit $label encodes each channel record back under the round-trip masks', ({ image }: GoldenUnit) => {
    let checked = 0;
    for (let n = 0; n < CHANNEL_COUNT; n++) {
      const ch = imageSlot(image, n);
      if (ch === undefined || 'malformed' in ch) continue;
      const { mem } = slotRecords(image, n);
      const spec = { ...ch, txHz: ch.txHz ?? undefined, rxOnly: ch.txHz === null };
      expect(masked(encodeChannel(spec, mem)), `slot ${n}`).toBe(masked(mem));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
