# Review chunk 1: golden set branch

Adversarial review of `feature/new-golden-set`, 1604a05..b996b54, by Opus with a second opinion from Sol. No correctness bug was found in `src/`. `npm test` passes 599 tests in 20 files and `npm run typecheck` is clean.

Tags: both-agree, Opus-only or Sol-only. Each single-model finding was verified by mutation or by reading the code.

## 1. Record the MDF order fix in issue 003

**Severity:** medium. **Tag:** Opus-only, verified against CHIRP and the image bytes.

**Files:** `issues/003-decoded-expectations.md`, `src/core/codec.ts:303`, `:313-314`.

Commit eecd428 reorders `MDF_NAMES` to `['ch','name','freq']`. Issue 003 still says "Leave `src/core/codec.ts` alone" and its criteria are ticked. The change alters CLI behaviour: `uv5r settings mdfa name` now writes 1 where it wrote 2, and a stored 2 now prints as `freq`. The new order matches CHIRP `uv5r.py:298`, `MODE_LIST = ["Channel","Name","Frequency"]`, and the three images.

**Fix:** keep the code. In issue 003, replace the "Leave `src/core/codec.ts` alone" line with a note that eecd428 corrects the MDF order to CHIRP's `MODE_LIST`, and name the CLI change. Name the same change in the PR description when the branch merges.

## 2. Pin the golden set size

**Severity:** medium-low. **Tag:** Sol-only, verified by mutation.

**Files:** `test/core/golden.ts:72`, `test/core/golden.test.ts:53`.

Every golden case comes from `manifest.json`. Deleting unit 2 from the manifest and emptying unit 1's `displayed` array drops their identity, snapshot, round-trip, restore and display cases, and the suite passes 588 of 588.

**Fix:** in `golden.test.ts`, assert that the labels are `['1','2','3']`, that image names are unique, and that each unit has at least one `displayed` entry.

## 3. Compare displayed readings with a fresh decode

**Severity:** low. **Tag:** both-agree, verified by deleting the JSON in a scratch worktree.

**Files:** `test/core/golden.test.ts:71-81`, `test/core/golden.ts`.

The display check compares the human readings with the JSON loaded at module start. With the JSON absent, `vitest -u` writes the files and fails the 8 display cases with a message to run `vitest -u`. After a decoder regression, a `-u` run compares the readings with stale JSON.

**Fix:** compare each displayed entry with `decodeImage(unit.image)`. Drop `expected` from the loader if nothing else reads it.

## 4. State what the masked round trip cannot catch

**Severity:** low. **Tag:** both-agree, verified by mutation.

**Files:** `test/core/golden.test.ts:84-95`, `issues/003-decoded-expectations.md`.

The masked round trip passes the original record as `prior`, so the low nibble of byte 12, byte 13 and bits 0-3 of byte 15 match by construction. The snapshot from `channelPayload` omits `scan` and does not write `bcl`. Every golden slot has scan=1, bcl=0, byte 13=0 and pttid=0, so the golden data cannot tell those fields apart. `codec.test.ts` and `radio.test.ts` catch the mutations.

**Fix:** add one sentence to the Result section of issue 003 naming these fields and the tests that cover them.

## 5. Check the image length in `fromImage`

**Severity:** low. **Tag:** Sol-only, verified by reading the code and checking `subarray` clamping in node.

**Files:** `test/core/fake.ts:106-114`.

`fromImage` accepts an 8-byte image and keeps the default fake's firmware and settings, because `subarray` clamps. An image with a CHIRP metadata trailer throws a RangeError at `eeprom.set`.

**Fix:** throw unless the image length is `IMAGE_AUX + 0x140`. Add a test for a short image.

## 6. Cover or drop the `reload()` in `fromImage`

**Severity:** low. **Tag:** Opus-only, verified by mutation.

**Files:** `test/core/fake.ts:113`, `test/core/protocol.test.ts`.

Removing `radio.reload()` from `fromImage` leaves 599 of 599 passing. Every caller handshakes, and the handshake reloads the page.

**Fix:** add a test that reads the 0x0E00 page from a `fromImage` fake before any handshake, or drop the line.

## 7. Bring the plan in line with the delivered set

**Severity:** low. **Tag:** both-agree on the exclusion, Opus-only on the stale plan.

**Files:** `docs/golden-set-plan.md`.

The plan still names base 21dbcb7, four units, `unit-4.img` and five channels per unit. It says to keep a radio that shares another unit's aux block and mark it with `sameRadioAs`. The skipped radio has its own channel memory and was left out because its aux block matches unit 1's. Units 1 and 3 also share the calibration rows 0x1F00-0x1F9F, so a matching aux block is weak evidence of the same radio.

**Fix:** add a note at the top of the plan naming the delivered set: three units, three channels each, and the skipped radio with the reason it was skipped. Link the Result section of issue 001.

## 8. Correct three claims in the run docs

**Severity:** low. **Tag:** Opus-only, verified against the code and manifest.

**Files:** `docs/golden-set-swarm-log.md:39`, `issues/003-decoded-expectations.md`, `issues/001-radio-survey.md`.

- Swarm log line 39 says the failure message says to rerun. The message says to run `vitest -u`, which is the run that failed. Rewrite the line to match item 3 once it lands.
- The Result section of issue 003 calls the display check "the independent check". It reads the committed JSON. Reword it to match item 3 once it lands.
- The Result section of issue 001 says "a fourth radio" shares unit 1's aux block. The manifest's `skipped` note calls it the "Third radio dumped". Use the manifest's wording.

## 9. Remove duplicated constants and helpers

**Severity:** slop. **Tag:** Opus-only.

**Files:** `test/core/fake.ts:20`, `:22`, `test/core/golden.test.ts:9-10`, `:18`, `:36`, `test/core/protocol.test.ts:130-131`, `src/core/index.ts`, `test/cli/cli.test.ts:10`.

- `fake.ts:22` `AUX = 0x1ec0` duplicates `ADDR.firmwareBlock` in `codec.ts`. Import it.
- `fake.ts:20` `MAIN_END` repeats the literal 0x1800. Derive it from the existing constant.
- `golden.test.ts:9-10` `VERSION_AT` and `VERSION_LENGTH` duplicate the constants in `fake.ts`. Share one definition.
- `golden.test.ts:18` `firmware()` re-implements `protocol.ts:177`. Call the existing function.
- `golden.test.ts:36` has a doc comment that restates the code. Delete it.
- `protocol.test.ts:130-131` uses literals next to the named constants. Use the constants.
- `src/core/index.ts` re-exports `IMAGE_AUX` and `decodeSlot`, and nothing that imports `index.ts` uses them. Remove the re-exports unless the CLI needs them.
- `cli.test.ts:10` creates a temp directory and never removes it. Remove it in `afterAll`.
