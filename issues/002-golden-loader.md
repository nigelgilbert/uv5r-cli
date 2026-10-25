# Golden loader and unit identity test

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Test changes" steps 1 and 2.

## What to build

A test helper reads `fixtures/golden/manifest.json` and every image it lists. It exports `GOLDEN`, one `{ label, image, manifest }` per unit, and `PRIMARY`, unit 1. A new golden test checks each image against its manifest entry: the first 8 bytes equal `ident`, the 14-byte version string at 0x1EF0 trimmed of 0xFF equals `firmware`, and the aux block hash equals `auxSha256`. It also checks the four hashes differ.

Follow the style of `test/core/fake.ts`: one-sentence doc comments, no new dependencies, `node:crypto` for the hash.

## Acceptance criteria

- [ ] `npm test` runs the golden test with 4 identity cases and 1 distinct-units case, all passing.
- [ ] Changing one byte in the aux block of any image makes the test fail.
- [ ] `npm run typecheck` passes.
- [ ] `test/core/imports.test.ts` passes with the new helper.

## Blocked by

- #001
