# Review 1: golden set issues 002 to 005

Scope: 1604a05..c4b31d9 on `feature/new-golden-set`. `npm test` passes 598 tests in 20 files and `npm run typecheck` is clean.

## Bug

1. **MDF table order**
   - Files: `src/core/codec.ts:310-311`, `fixtures/golden/unit-1.json`, `fixtures/golden/unit-2.json`, `fixtures/golden/unit-3.json`, `test/core/settings.test.ts:42`, `test/core/settings.test.ts:109`, `test/core/golden.test.ts`, `docs/rx-audio-investigation.md:62-63`.
   - Problem: the table reads `['freq', 'ch', 'name']`. CHIRP's uv5r driver orders the list Channel, Name, Frequency. All three units store 0x02 and display Frequency. Unit 2 has names on every one of its 15 slots, so 0x02 cannot mean Name. The unit JSON records `mdfa` and `mdfb` as "name".
   - Fix:
     - Change the table to `['ch', 'name', 'freq']`.
     - Regenerate `unit-1.json` to `unit-3.json` with `vitest -u`.
     - Change the `'name'` literals at `test/core/settings.test.ts:109` to `'freq'`.
     - Change `parseSettingValue('mdfa', 'name')` at `test/core/settings.test.ts:42` to expect 1.
     - Compare `mdf` and `displayNumber` in the displayed check in `test/core/golden.test.ts`.
     - Add a correction note beside the "(name)" label for value 2 in `docs/rx-audio-investigation.md:62-63` and keep the dated history.

## Gap

2. **Acceptance counts in issues 002 to 005**
   - Files: `issues/002-golden-loader.md`, `issues/003-decoded-expectations.md`, `issues/004-restore-round-trip.md`, `issues/005-retire-dated-fixture.md`.
   - Problem: the acceptance criteria say 4, four, 20 and 4. The set holds three units and eight displayed checks.
   - Fix: in 002 change "4 identity cases" to 3. In 003 change "four JSON files" to three and "20 displayed checks" to 8. In 004 change "4 restore cases" to 3. In 005 change any four-unit count to three. Keep the ticked boxes.

3. **The `magic` option of `fromImage` has no test**
   - Files: `test/core/fake.ts:111`, `test/core/protocol.test.ts` (describe `fake from an image`).
   - Problem: all three units carry `"magic": "291"`, which is the default. Removing the `radio.magics = [magicByName(magic).bytes]` line leaves every test passing.
   - Fix: add a test that builds `FakeRadio.fromImage(PRIMARY.image, { magic: 'ORIG' })`. Assert that `startSession(radio, magicByName('ORIG'))` resolves. Assert that `startSession(radio)` with the default 291 magic rejects through `driveRejection` with `session-unavailable`.

## Slop

4. **Unused exports in the golden loader**
   - File: `test/core/golden.ts:11`, `test/core/golden.ts:20`.
   - Problem: nothing imports `DisplayedSlot` or `ManifestUnit`.
   - Fix: change `export interface DisplayedSlot {` to `interface DisplayedSlot {` and `export interface ManifestUnit {` to `interface ManifestUnit {`. Update the swarm report line that lists them as exports.

5. **Stale comment on `PRIMARY`**
   - File: `test/core/golden.ts:77`.
   - Problem: the comment points at the fixture that commit ff4d18e deleted.
   - Fix: replace `/** Unit 1, the radio the older fixture came from. */` with `/** Unit 1, the radio the CLI and protocol tests use. */`.

6. **Roundabout aux slice in `fromImage`**
   - File: `test/core/fake.ts:110`.
   - Problem: `image.subarray(IMAGE_AUX, IMAGE_AUX + 0x2000 - AUX)` repeats the EEPROM size as a literal to take the rest of the image.
   - Fix: replace the line with `radio.eeprom.set(image.subarray(IMAGE_AUX), AUX);`.

7. **Handshake assertions in the PRIMARY `fromImage` test add no coverage**
   - File: `test/core/protocol.test.ts:127-128`.
   - Problem: PRIMARY's ident and firmware equal the default constructor's values, so the two assertions pass if `fromImage` ignores the ident. The changed-copy test and the memory comparisons carry the coverage.
   - Fix: delete the `startedIdent.bytes` and `startedIdent.firmware` expectations from `answers the handshake with the ident and firmware of PRIMARY`. Rename the test to `loads main memory and the aux block of PRIMARY`.
