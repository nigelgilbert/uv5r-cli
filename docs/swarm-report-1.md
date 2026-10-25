# Swarm report 1: review 1 of the golden set

Branch `feature/new-golden-set`, base 47b0344, which commits `docs/review-1.md`. Three Opus subagents at effort high ran the seven items in worktrees, grouped by shared files. Three review rounds ran, with Opus and GPT-6.1 Sol through the `codex` skill. Round 3 ran twice because the host slept after its first fix. Nothing is pushed.

Tests at the final commit: `npm test` passes 599 tests in 20 files, and `npm run typecheck` is clean. The baseline at 47b0344 was 598 tests in 20 files.

## Deviations from the review text

- **Item 3.** The 291 rejection runs through `new Session(radio).start(magicByName('291'))`. `startSession` drives the promise itself and returns a settled session, so `driveRejection` has nothing to wait on. The test builds a second fake for the rejection because the first is already in a session.
- **Item 7.** Issue 004 prescribes a `PRIMARY` `fromImage` test that checks the handshake ident and firmware. The test keeps those assertions and is renamed `answers the handshake as PRIMARY and loads its main memory and aux block`. A comment says the changed-copy test covers the ident load, since PRIMARY's ident and firmware match the default constructor. The memory comparisons already fail when `fromImage` returns the default constructor or skips either load. Sol agreed: deleting the assertions would leave issue 004's ticked box false.
- **Item 2.** Issue 005 states no unit or check count, so it is unchanged. Issue 003 also had "five slots per unit" in its body and "(5 per unit)" in a criterion. Both now give the 3, 3 and 2 split.

## What landed

### Item 1 MDF table order: eecd428

CHIRP master, kk7ds/chirp 21e42e4518c1, `chirp/drivers/uv5r.py:298` reads `MODE_LIST = ["Channel", "Name", "Frequency"]`. Lines 1359-1370 build `mdfa` and `mdfb` from it. The item stands.

- `src/core/codec.ts`: `mdfa` and `mdfb` read `['ch', 'name', 'freq']`.
- `fixtures/golden/unit-1.json` to `unit-3.json`: regenerated. Only `mdfa` and `mdfb` changed, from "name" to "freq".
- `test/core/settings.test.ts`: `:42` expects 1 for `'name'`. `:109` expects `'freq'` for both fields.
- `test/core/golden.test.ts`: the displayed check compares `displayNumber` with `slot` and `mdf` with the decoded `mdfa`. The UV-5R numbers channels 0 to 127 as the CLI does; unit 3's entries for slots 0 and 127 confirm it.
- `docs/rx-audio-investigation.md`: a dated correction note under the settings table. The history is unchanged.

### Items 3, 6 and 7 fake and protocol tests: 787b2ce

- `test/core/fake.ts`: the aux load reads `radio.eeprom.set(image.subarray(IMAGE_AUX), AUX);`.
- `test/core/protocol.test.ts`: new test `acks the magic it is given and ignores the default 291`. It fails with the `radio.magics` line removed, and it fails when ORIG is appended next to 291. Item 7 as described above.

### Items 2, 4 and 5 issues and golden loader: 0c453a2

- `issues/002-golden-loader.md`: 3 identity cases.
- `issues/003-decoded-expectations.md`: three JSON files, 8 displayed checks, eight slots across the three units.
- `issues/004-restore-round-trip.md`: 3 restore cases.
- `test/core/golden.ts`: `DisplayedSlot` and `ManifestUnit` lose `export`. The `PRIMARY` comment reads "Unit 1, the radio the CLI and protocol tests use."
- `docs/swarm-report-0.md`: the golden.ts line lists `AUX_SIZE` and `GoldenUnit` as exports.

## Review findings fixed

| Round | Finding | Fix |
|---|---|---|
| 1 | `SETTINGS_EXAMPLE` in `src/cli/main.ts:174` showed `mdfa: 'name'`. Its other fields match unit 1, which now decodes `freq`. | 012dcc9: the example shows `freq` for both fields. |
| 1 | The `mdfb` names were unpinned. Changing them left every test passing. | 012dcc9: one `MDF_NAMES` const serves both fields. Changing it fails five tests. |
| 1 | The rx-audio correction covered only `mdfa`, and the cell text was clunky. | 012dcc9: the note covers `mdfa` and `mdfb`. The cells read "2 (name, see correction)". |
| 1 | A displayed entry with `mdf: 'freq'` that carried only `name` passed. | 012dcc9: `freq` requires `rxMhz` and `name` requires `name`. |
| 2 | The manifest example in issue 001 paired slot 0 with displayNumber 1, which fails the new check. | ae40d68: the example uses displayNumber 0. |
| 2 | The neither-field guard threw on an `mdf: 'ch'` entry. | ae40d68: the guard exempts `ch`. |
| 3 | The mdf checks from round 1 left the neither-field guard with nothing to catch. | 43a69c9: the guard is deleted. The overseer made this one-line fix. |
| 3 | The unit 2 manifest note said names are on all 15 slots. Slot 127 has an empty name. | e4c0a72: the note says slots 0 to 13 carry names and slot 127 has none. The overseer made this one-line fix. |

## Findings dropped

- `image.subarray(IMAGE_AUX)` has no end bound and would throw on an image with a trailer. Every caller passes a golden image that `readImage` length-checks.
- The displayed check compares `mdf` with `mdfa` only. All three units store the same value in `mdfa` and `mdfb`, and an entry records one mode.
- The rx-audio note quotes the labels as "(name)" while the cells read "(name, see correction)". Polish only.
- Sol offered a shorter item 7 comment and a constructor spy that would make the PRIMARY ident assertion discriminate. Both models rated the spy heavier than the problem.

## Disagreements between Opus and Sol

- Round 1: Sol first kept `SETTINGS_EXAMPLE` at `'name'` as a valid mode. Opus showed the example matches unit 1 field for field, and Sol moved to `'freq'`.
- Round 2: Sol first answered clean, then backed both findings.
- Round 3, first pass: Sol first answered clean, then agreed the guard should go.
- Round 3, second pass: Opus proposed fixing the issue 001 example, whose label "1" pairs with 162.400 on slot 0, a frequency that sits on unit 2. Sol rated it optional cleanup of a pre-survey example. Opus accepted. It is listed under Open.

## Open

- `issues/001-radio-survey.md:29-31`: the example manifest entry names unit 1 and shows 162.400 on slot 0. Unit 1's slot 0 is empty; 162.400 is on unit 2.
- `issues/001-radio-survey.md:24` says the displayed field goes in `rxMhz` or `name`. A `ch` entry displays only `displayNumber`.
- `docs/review-1.md:9` and `docs/swarm-report-0.md:81` repeat the "names on every one of its 15 slots" claim. Both are records and stay as written.
- Two worktrees from earlier runs remain under `.claude/worktrees/`: `agent-a7c8fe491c985bec9` and `agent-aa0712616e0ffadcc`.

## Next step

Write a review file from the Open items and run the swarm on it, or close them by hand in issue 001.
