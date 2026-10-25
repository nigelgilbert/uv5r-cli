import { existsSync, readFileSync } from 'node:fs';
import type { Settings } from '../../src/core/codec.ts';
import type { MagicName } from '../../src/core/ident.ts';
import { IMAGE_AUX, type ChannelResult } from '../../src/core/radio.ts';

const DIR = new URL('../../fixtures/golden/', import.meta.url);
/** Bytes of the aux block in a CHIRP image, radio memory 0x1EC0..0x1FFF. */
export const AUX_SIZE = 0x140;

/** A slot the radio showed on its display when the unit was dumped. */
export interface DisplayedSlot {
  slot: number;
  displayNumber: number;
  mdf: string;
  rxMhz?: string;
  name?: string;
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
  /** Label of an earlier unit with the same aux hash. */
  sameRadioAs?: string;
}

/** The decoded settings and every slot of a unit, as `unit-<n>.json` holds them. */
export interface Expected {
  settings: Settings;
  slots: ChannelResult[];
}

/** A golden unit with its image bytes, manifest entry and decoded expectations. */
export interface GoldenUnit {
  label: string;
  image: Uint8Array;
  manifest: ManifestUnit;
  /** Path of `unit-<n>.json` relative to the golden directory. */
  expectedFile: string;
  /** Undefined until a `vitest -u` run writes `expectedFile`. */
  expected: Expected | undefined;
}

/** Read `name` from the golden directory and check it holds IMAGE_AUX + AUX_SIZE bytes. */
function readImage(name: string): Uint8Array {
  const image = new Uint8Array(readFileSync(new URL(name, DIR)));
  if (image.length !== IMAGE_AUX + AUX_SIZE) {
    throw new Error(`golden image ${name} is ${image.length} bytes; expected ${IMAGE_AUX + AUX_SIZE}`);
  }
  return image;
}

/** Read `name` from the golden directory, or return undefined when it does not exist. */
function readExpected(name: string): Expected | undefined {
  const url = new URL(name, DIR);
  if (!existsSync(url)) return undefined;
  return JSON.parse(readFileSync(url, 'utf8')) as Expected;
}

const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR), 'utf8')) as { units: ManifestUnit[] };

/** Every unit in the manifest, in manifest order. */
export const GOLDEN: GoldenUnit[] = manifest.units.map((unit) => {
  const expectedFile = unit.image.replace(/\.img$/, '.json');
  return { label: unit.label, image: readImage(unit.image), manifest: unit, expectedFile, expected: readExpected(expectedFile) };
});

/** Unit 1, the radio the older fixture came from. */
export const PRIMARY: GoldenUnit = GOLDEN.find((unit) => unit.label === '1')!;
