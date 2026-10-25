# Golden loader and unit identity test

**Type**: AFK

**Status:** ✅ Done 2026-10-25, commit b005a73

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Test changes" steps 1 and 2.

## What to build

Reset the worktree to the tip of `feature/new-golden-set` after #001 is committed, before editing.

Export `IMAGE_AUX = 0x1808` from `src/core/radio.ts` next to `IMAGE_HEADER`. Main memory starts at `IMAGE_HEADER`. Use both in the loader and the golden test.

A test helper reads `fixtures/golden/manifest.json` and every image it lists. It exports `GOLDEN`, one `{ label, image, manifest }` per unit, and `PRIMARY`, unit 1. A new golden test checks each image against its manifest entry:

- The first 8 bytes equal `ident`.
- The 14-byte version string at image offset 0x1838 equals `firmware` after the rule in `src/core/protocol.ts:177`: drop bytes outside 0x20-0x7E, then trim.
- The sha256 of the aux block, image offsets 0x1808-0x1947, equals `auxSha256`.

It also checks the hashes differ, skipping units that carry `sameRadioAs`.

Follow the style of `test/core/fake.ts`: one-sentence doc comments, no new dependencies, `node:crypto` for the hash.

## Acceptance criteria

- [x] `npm test` runs the golden test with 3 identity cases and 1 distinct-units case, all passing.
- [x] Changing one byte in the aux block of any image makes the test fail.
- [x] `npm run typecheck` passes.
- [x] `test/core/imports.test.ts` passes with the new helper.

## Blocked by

- issues/001-radio-survey.md

## Result

Implemented in `b005a73`.

Later commits:

- `46827a9`: the `sameRadioAs` comment names an earlier unit with the same aux hash. The `readImage` comment names the IMAGE_AUX + AUX_SIZE length check.
- `0c453a2`: the criterion says 3 identity cases. `DisplayedSlot` and `ManifestUnit` lose `export`. The `PRIMARY` comment names the CLI and protocol tests in place of the deleted fixture.

The spec asked for 4 identity cases. The set holds three units, so the golden test runs 3 identity cases and 1 distinct-units case. Flipping one aux bit in `unit-2.img` fails the unit 2 identity case only.

At `7fe8005`, `npm test` passes 599 tests in 20 files, 18 of them in `test/core/golden.test.ts`. `npm run typecheck` passes.
