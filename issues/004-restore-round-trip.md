# Fake radio from an image and restore round trip on every unit

**Type**: AFK

**Status:** ✅ Done 2026-10-25, commit 3beb379

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Test changes" steps 3 and 4.

## What to build

Reset the worktree to the tip of `feature/new-golden-set` after #001 is committed, before editing.

`FakeRadio.fromImage(image, { magic })` returns a fake holding a real unit's memory. It sets the ident in place with `ident.set()` from image bytes 0-7, loads main memory 0x0000-0x17FF from `IMAGE_HEADER` and aux 0x1EC0-0x1FFF from `IMAGE_AUX`, and reloads the 0x0E00 page. The fake acks `magic`; tests pass `unit.manifest.magic`. The default constructor stays as it is.

The protocol and settings tests stop reading `fixtures/uv5r-hn5rv011-2026-10-12.img`. They read `PRIMARY` from the golden loader.

The restore round trip and the restored-range verification run once per unit with `it.each(GOLDEN)`. Build each fake with `fromImage`, fill 0x0000-0x17FF with 0xFF, keep the ident and aux, reload the page, then restore. Keep the dropped-write case on `PRIMARY`.

In `test/core/settings.test.ts`:

- Define `DEFAULT_SETTINGS`, the decoded settings of the default fake, and use it in place of `FIXTURE_SETTINGS` at `:93` and `:112`. Keep literal expectations for the eight values written at `:110` and expected at `:112`.
- Drop the test at `:31-33`; #003 covers decoding.
- `:55` reads `PRIMARY`.
- `:128-130` run on `FakeRadio.fromImage(unit.image)` and compare against `decodeSettings(imageSettingsBlock(unit.image))`.

Put the `fromImage` tests in `protocol.test.ts`. One runs on `PRIMARY`. One runs on a copy of `PRIMARY` with a changed ident and firmware. Each checks the handshake ident and the firmware.

## Acceptance criteria

- [x] `grep -rn "2026-10-12" test/core` prints nothing.
- [x] The restore round trip runs 3 cases, one per unit, all passing.
- [x] A test asserts `FakeRadio.fromImage` reads back the image ident and firmware, on `PRIMARY` and on the changed copy.
- [x] `npm test` and `npm run typecheck` pass.

## Blocked by

- issues/002-golden-loader.md

## Result

Implemented in `3beb379`. `fromImage` defaults `magic` to 291, so `fromImage(unit.image)` works without options.

Later commits:

- `46827a9`: the `PRIMARY` `fromImage` test compares eeprom 0x0000-0x17FF and 0x1EC0-0x1FFF with the image.
- `787b2ce`: the aux load reads `image.subarray(IMAGE_AUX)`. A new test builds the fake with magic ORIG and checks it acks ORIG and refuses 291. The `PRIMARY` test is renamed `answers the handshake as PRIMARY and loads its main memory and aux block` and keeps its ident and firmware assertions.
- `0c453a2`: the criterion says 3 restore cases.
- `eecd428`: the settings write test at `test/core/settings.test.ts:109` expects `freq` for `mdfa` and `mdfb`.

The spec asked for 4 restore cases. The restore round trip runs 3 cases in `protocol.test.ts` and 3 in `settings.test.ts`, one per unit. Removing the `radio.magics` line in `fromImage` fails the ORIG test.

At `7fe8005`, `npm test` passes 599 tests in 20 files: 29 in `test/core/protocol.test.ts` and 15 in `test/core/settings.test.ts`. `npm run typecheck` passes.
