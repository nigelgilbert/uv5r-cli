# Decoded expectations per unit

**Type**: AFK

**Status:** ✅ Done 2026-10-25, commit 17545dd

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Files" and "Test changes" step 2.

## What to build

Reset the worktree to the tip of `feature/new-golden-set` after #001 is committed, before editing.

Extract a pure `decodeSlot(mem, name)` in core. It returns `Channel | MalformedRecord | undefined`, as `readChannel` returns it. Export it through `src/core/index.ts`. Call it from `readChannel` and the golden test.

`golden.test.ts` writes `fixtures/golden/unit-<n>.json` through `toMatchFileSnapshot`. Each file holds the decoded settings in the shape `settings --json` prints and all 128 slots, each as `channelPayload(n, decodeSlot(mem, name))`. Empty slots are `{ channel, empty: true }`. Malformed slots are `{ channel, malformed: true, raw }`. The payload drops `scan`.

The loader reads each `unit-<n>.json` into `expected` on its `GOLDEN` entry. The golden test gains three checks per unit:

- Decoding the image matches the `unit-<n>.json` snapshot. This catches decoder regressions only, since the same decoder writes the snapshot.
- Each `displayed` entry in the manifest matches the slot of the same `slot` in `expected` on the fields it carries. Compare frequencies as numbers. This is the independent check and covers eight slots across the three units.
- Encoding each well-formed channel record gives back its bytes under masks. Pass the original record as `prior` and map `txHz: null` to `rxOnly`. Compare bytes 0-11 in full, byte 12 under 0x0F, byte 13 in full, byte 14 under 0x01 and byte 15 under 0x4F. Name records stay out of the round trip.

List each slot with bits set outside those masks in the unit's manifest `notes`. Leave `src/core/codec.ts` alone.

Commit the generated JSON.

## Acceptance criteria

- [x] Running `vitest -u` writes three JSON files, and a second `npm test` leaves `git diff` empty.
- [x] Each JSON has a settings object and 128 slot entries.
- [x] `npm test` passes, including 8 `displayed` checks (3, 3 and 2 per unit) and the masked encode round trip on every well-formed slot.
- [x] Changing one channel frequency in a JSON file makes the test fail.
- [x] `npm run typecheck` passes.

## Blocked by

- issues/002-golden-loader.md

## Result

Implemented in `17545dd`. No slot is malformed and no slot sets bits outside the masks, so the manifest notes are unchanged. The round trip covers 21, 15 and 2 well-formed slots on units 1 to 3.

Later commits:

- `46827a9`: `rxMhz` is optional on a displayed entry and its comparison is guarded. The `decodeSlot` comment names a 0xFF first byte as the undefined case.
- `f4a3690`: the displayed check throws on an entry with neither `rxMhz` nor `name`.
- `eecd428`: the MDF names follow CHIRP's `MODE_LIST` order, `['ch', 'name', 'freq']`, at `chirp/drivers/uv5r.py:298` (kk7ds/chirp 21e42e4518c1). The unit JSON now records `mdfa` and `mdfb` as `freq`. The displayed check compares `displayNumber` with `slot` and `mdf` with `mdfa`. The spec said to leave `src/core/codec.ts` alone, and this commit edits it.
- `0c453a2`: the body and criteria say three JSON files and 8 displayed checks, 3, 3 and 2 per unit.
- `012dcc9`: one `MDF_NAMES` const serves `mdfa` and `mdfb`. The `settings` help example shows `freq`. A `freq` entry requires `rxMhz` and a `name` entry requires `name`. The rx-audio correction note covers both fields.
- `ae40d68`: the neither-field guard exempts `ch` entries.
- `43a69c9`: the neither-field guard is deleted, since the mdf checks cover it.

The spec asked for four JSON files and 20 displayed checks. The set holds three units and the run delivered three files and 8 checks. Changing slot 2 of `unit-2.json` to 162.575 fails the unit 2 snapshot and the unit 2 slot 2 check. Reordering `MDF_NAMES` fails 5 tests.

At `7fe8005`, `npm test` passes 599 tests in 20 files, 18 of them in `test/core/golden.test.ts`. `npm run typecheck` passes.
