import { readFileSync } from 'node:fs';
import type { MagicName } from '../../src/core/ident.ts';
import { IMAGE_AUX } from '../../src/core/radio.ts';

const DIR = new URL('../../fixtures/golden/', import.meta.url);
/** Bytes of the aux block in a CHIRP image, radio memory 0x1EC0..0x1FFF. */
export const AUX_SIZE = 0x140;

/** A slot the radio showed on its display when the unit was dumped. */
export interface DisplayedSlot {
  slot: number;
  displayNumber: number;
  mdf: string;
  rxMhz: string;
}

/** One entry of `units` in `fixtures/golden/manifest.json`. */
export interface ManifestUnit {
  label: string;
  image: string;
  dumped: string;
  /** The 8-byte ident as hex. */
  ident: string;
  firmware: string;
  magic: MagicName;
  /** The sha256 of the aux block as hex. */
  auxSha256: string;
  notes: string;
  displayed: DisplayedSlot[];
  /** Label of a unit that is the same physical radio. */
  sameRadioAs?: string;
}

/** A golden unit with its image bytes and manifest entry. */
export interface GoldenUnit {
  label: string;
  image: Uint8Array;
  manifest: ManifestUnit;
}

/** Read `name` from the golden directory and check it ends with the aux block. */
function readImage(name: string): Uint8Array {
  const image = new Uint8Array(readFileSync(new URL(name, DIR)));
  if (image.length !== IMAGE_AUX + AUX_SIZE) {
    throw new Error(`golden image ${name} is ${image.length} bytes; expected ${IMAGE_AUX + AUX_SIZE}`);
  }
  return image;
}

const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as { units: ManifestUnit[] };

/** Every unit in the manifest, in manifest order. */
export const GOLDEN: GoldenUnit[] = manifest.units.map((unit) => ({ label: unit.label, image: readImage(unit.image), manifest: unit }));

/** Unit 1, the radio the older fixture came from. */
export const PRIMARY: GoldenUnit = GOLDEN.find((unit) => unit.label === '1')!;
