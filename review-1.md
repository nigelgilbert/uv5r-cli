# Review: golden set branch

An adversarial review of `feature/new-golden-set`, 1604a05..b996b54, where `npm test` passes 599 tests in 20 files and `npm run typecheck` is clean. Opus reviewed it, with a second opinion from Sol.

Each item carries a tag: both-agree, Opus-only or Sol-only.

## Decisions, 2026-10-25

Settled before the swarm run. Do not interview on these again; implement as written.

- Branch. The items land on `feature/new-golden-set` from 4fe5711.
- Item 4. The golden set branch has no PR yet. Record the CLI change in issue 003 now and in the PR description when the PR is opened. `pr5-body.md` belongs to PR 5, the speech plan.
- Fix text with an "or": pick the simplest option and record it in the commit message.
- Speech plan review. It moved to `docs/speech-plan-review.md` on `feature/speech-plan` (PR 5) in 7392d8b.

## Items

`src/` has no correctness bug. The nine items cover test gaps, an unrecorded CLI change, a stale plan, run-doc statements that item 2 makes stale and duplicated constants.

### 1. Pin the golden set size

**Severity:** medium-low. **Tag:** Sol-only, verified by mutation.

**Files:** `test/core/golden.ts:72`, `test/core/golden.test.ts:53`.

Every golden case comes from `manifest.json`. Deleting unit 2 from the manifest and emptying unit 1's `displayed` array drops their identity, snapshot, round-trip, restore and display cases, and the suite passes 588 of 588.

**Fix:** in `golden.test.ts`, assert that the labels are `['1','2','3']`, that image names are unique, and that each unit has at least one `displayed` entry.

### 2. Compare displayed readings with a fresh decode

**Severity:** low. **Tag:** both-agree, verified by deleting the JSON and by mutating the decoder in a scratch worktree.

**Files:** `test/core/golden.test.ts:71-81`, `test/core/golden.ts`.

The display check compares the human readings with the JSON loaded at module start. With the JSON absent, `vitest -u` writes the files and fails the 8 display cases with a message to run `vitest -u`. Adding 10 kHz to the decoded `rxMhz` fails the 3 snapshot cases. A `-u` run then passes all 18 cases and rewrites the JSON, because the display cases compare against the stale copy.

**Fix:** compare each displayed entry with `decodeImage(unit.image)`. Drop `expected` and `readExpected` from the loader, since only the display check reads them.

### 3. State what the masked round trip cannot catch

**Severity:** low. **Tag:** both-agree, verified by mutation.

**Files:** `test/core/golden.test.ts:84-95`, `issues/003-decoded-expectations.md`.

The masked round trip passes the original record as `prior`, so byte 13 and bits 0-3 of byte 15 match by construction. The JSON records neither scan nor bcl. Every golden slot has scan=1, bcl=0, byte 13=0 and pttid=0, which equal the encoder's defaults. Replacing the kept bytes with defaults passes the golden tests. `codec.test.ts` catches the byte 13, BCL, scan and PTT-ID mutations. `radio.test.ts` catches BCL, PTT-ID and S-code.

**Fix:** add one sentence to the Result section of issue 003 naming byte 13, BCL, scan and PTT-ID and the tests that cover them.

### 4. Name the CLI change in the issue 003 MDF note

**Severity:** low. **Tag:** Opus-only, verified against CHIRP and the image bytes.

**Files:** `issues/003-decoded-expectations.md:49`, `src/core/codec.ts:303`, `:313-314`.

Commit eecd428 reorders `MDF_NAMES` to `['ch','name','freq']`. The note at issue 003 line 49 records the commit and the codec edit and omits the CLI change. `uv5r settings mdfa name` now writes 1 where it wrote 2, and a stored 2 now prints as `freq`. The new order matches CHIRP `uv5r.py:298`, `MODE_LIST = ["Channel","Name","Frequency"]`, and the three images, which store 2 in both fields.

**Fix:** keep the code. Add the CLI change to the line 49 note. Name the same change in the PR description when the branch merges.

### 5. Check the image length in `fromImage`

**Severity:** low. **Tag:** Sol-only, verified by reading the code and checking `subarray` clamping in node.

**Files:** `test/core/fake.ts:106-114`.

`fromImage` accepts an 8-byte image and keeps the default fake's firmware and settings, because `subarray` clamps. An image with a CHIRP metadata trailer throws a RangeError at `eeprom.set`.

**Fix:** throw unless the image length is `IMAGE_AUX + 0x140`. Add a test for a short image.

### 6. Drop the `reload()` in `fromImage`

**Severity:** low. **Tag:** Opus-only, verified by mutation.

**Files:** `test/core/fake.ts:112`, `test/core/protocol.test.ts`.

Removing `radio.reload()` from `fromImage` leaves 599 of 599 passing. Every caller handshakes, and the handshake reloads the page.

**Fix:** drop the line.

### 7. Bring the plan in line with the delivered set

**Severity:** low. **Tag:** both-agree on the exclusion, Opus-only on the stale plan.

**Files:** `docs/golden-set-plan.md`.

The plan still names four units, `unit-4.img` and five channels per unit. Its pairwise aux comparison keeps a radio with a matching aux block when the tape labels differ and marks it with `sameRadioAs`. The skipped radio has its own channel memory and was left out because its aux block matches unit 1's. Units 1 and 3 also share the calibration rows 0x1F00-0x1F9F, so a matching aux block is weak evidence of the same radio.

**Fix:** add a note at the top of the plan naming the delivered set: three units with 3, 3 and 2 displayed channels, and the skipped radio with the reason it was skipped. Link the Result section of issue 001.

### 8. Update the run docs when item 2 lands

**Severity:** low. **Tag:** Opus-only, verified against the code.

**Files:** `docs/golden-set-swarm-log.md:39`, `issues/003-decoded-expectations.md:22`.

- Swarm log line 39 drops a finding because of the current `vitest -u` behaviour. Update it once item 2 lands.
- Issue 003 line 22 calls the display check "the independent check". It reads the committed JSON. Reword it to match item 2 once it lands.

### 9. Remove duplicated constants and helpers

**Severity:** slop. **Tag:** Opus-only.

**Files:** `test/core/fake.ts:22`, `:24`, `:26-27`, `test/core/golden.test.ts:9-10`, `:18`, `:35`, `test/core/protocol.test.ts:130-131`, `:136-137`, `src/core/index.ts:52`, `:61`, `test/cli/cli.test.ts:10`.

- `fake.ts:24` `AUX = 0x1ec0` duplicates `ADDR.firmwareBlock` in `codec.ts`. Import it.
- `fake.ts:22` `MAIN_END` repeats the literal 0x1800. Use `IMAGE_AUX - IMAGE_HEADER`.
- `fake.ts:26-27` and `golden.test.ts:9-10` repeat the version string's offset 48 in the aux block and its length 14. `protocol.test.ts:136-137` repeats them as literals. Export the in-block offset and length once.
- `golden.test.ts:18` `firmware()` repeats the version decoding inline in `Session.finish` (`protocol.ts:175-179`). Extract a helper in `protocol.ts` and call it.
- `golden.test.ts:35` has a doc comment that restates the code. Delete it.
- `protocol.test.ts:130-131` uses literals next to the named constants. Use the constants.
- `src/core/index.ts` re-exports `IMAGE_AUX` and `decodeSlot`, and nothing that imports `index.ts` uses them. Remove the re-exports.
- `cli.test.ts:10` creates a temp directory and never removes it, as do twelve other `mkdtempSync` calls in the file. Create one temp root, give each test its own subdirectory and remove the root in `afterAll`.
