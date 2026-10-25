# Fake radio from an image and restore round trip on every unit

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Test changes" steps 3 and 4.

## What to build

`FakeRadio.fromImage(image)` returns a fake holding a real unit's memory: the ident from the image header, main memory 0x0000-0x17FF and aux 0x1EC0-0x1FFF, with the 0x0E00 page reloaded. The default constructor stays as it is.

The protocol and settings tests stop reading `fixtures/uv5r-hn5rv011-2026-10-12.img`. They read `PRIMARY` from the golden loader. The restore round trip and the restored-range verification run once per unit with `it.each(GOLDEN)` on `FakeRadio.fromImage(unit.image)`. `FIXTURE_SETTINGS` goes away. The expected settings come from the decoded settings of the unit under test. Until #003 lands, decode them in the test from the image's settings block.

## Acceptance criteria

- [ ] `grep -rn "2026-10-12" test/core` prints nothing.
- [ ] The restore round trip runs 4 cases, one per unit, all passing.
- [ ] A test asserts `FakeRadio.fromImage(PRIMARY.image)` reads back the image ident and firmware.
- [ ] `npm test` and `npm run typecheck` pass.

## Blocked by

- #002
