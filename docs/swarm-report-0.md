# Swarm report 0: golden set issues 002 to 005

Branch `feature/new-golden-set`, base 1604a05. Each issue ran on one Opus subagent at effort high. Three review rounds ran, with Opus and GPT-6.1 Sol through the `codex` skill. Nothing is pushed.

Tests at the final commit: `npm test` passes 598 tests in 20 files, and `npm run typecheck` is clean. The baseline at 1604a05 was 575 tests in 19 files.

## Deviations from the issue text

The golden set holds three units. `fixtures/golden/manifest.json` lists a skipped fourth radio whose aux block matches unit 1. The counts in the acceptance criteria assume four units, so the tests run:

| Issue | Criterion says | Runs |
|---|---|---|
| 002 | 4 identity cases | 3, plus 1 distinct-units case |
| 003 | four JSON files, 20 displayed checks | 3 files, 8 checks (3 on unit 1, 3 on unit 2, 2 on unit 3) |
| 004 | 4 restore cases | 3 in protocol.test.ts and 3 in settings.test.ts |

The boxes are ticked on that basis. `FakeRadio.fromImage` defaults `magic` to 291, so `fromImage(unit.image)` works where issues 004 and 005 call it without options.

## What landed

### 002 Golden loader and unit identity test: b005a73

- `src/core/radio.ts`, `src/core/index.ts`: export `IMAGE_AUX = 0x1808` next to `IMAGE_HEADER`.
- `test/core/golden.ts` (new): reads the manifest and images into `GOLDEN` and `PRIMARY`; exports `AUX_SIZE` and `GoldenUnit`. It checks each image length.
- `test/core/golden.test.ts` (new): one case per unit for ident, firmware and aux sha256, plus a distinct-aux case.
- A one-bit change in the aux block of each unit fails that unit's case only. The agent checked this on a scratch copy.

### 003 Decoded expectations per unit: 17545dd

- `src/core/radio.ts`, `src/core/index.ts`: `decodeSlot(mem, name)` is extracted from `readChannel` and exported.
- `test/core/golden.ts`: adds `Expected`, `expectedFile` and `expected`. `expected` is undefined until a `vitest -u` run writes the file.
- `test/core/golden.test.ts`: per unit, a snapshot case, one case per `displayed` entry and a masked encode round trip. The round trip covers 21, 15 and 2 well-formed slots.
- `fixtures/golden/unit-1.json` to `unit-3.json` (new): settings and 128 slots each.
- No slot carries bits outside the masks, so the manifest notes are unchanged. No slot is malformed.
- Changing slot 2 of unit-2.json from 162.55 to 162.575 fails the unit 2 snapshot and the unit 2 slot 2 check.

### 004 Fake radio from an image and restore round trip: 3beb379

- `test/core/fake.ts`: `FakeRadio.fromImage(image, { magic })` sets the ident in place, loads main memory and aux, sets the magic and reloads the page. The default constructor is unchanged.
- `test/core/protocol.test.ts`: reads `PRIMARY`. The restore round trip runs per unit with `it.each(GOLDEN)` after filling main memory with 0xFF; the handshake reloads the page. Adds the two `fromImage` ident and firmware tests on `PRIMARY` and on a changed copy.
- `test/core/settings.test.ts`: `DEFAULT_SETTINGS` decodes the default fake. The :112 expectation stays a literal. The fixture decode test is dropped. The restore-and-verify test runs per unit.
- The overseer restored a blank line after the imports in protocol.test.ts.

### 005 Move CLI tests to the golden set and retire the dated fixture: ff4d18e

- `test/cli/cli.test.ts`: the restore tests read a temp copy of `PRIMARY.image`. `fixtureRadio()` is replaced by `FakeRadio.fromImage(PRIMARY.image)`. No other test needed a change.
- `test/core/imports.test.ts`: `test/core/golden.ts` joins the allowlist.
- `fixtures/uv5r-hn5rv011-2026-10-12.img` is deleted. `git ls-files fixtures` lists only `fixtures/golden/`.
- `README.md`: the Bench files entry points at `fixtures/golden/`.
- `docs/clone-protocol-review.md`: the Golden files open item is closed with a link to the plan.

Commit d7391f8 adds the commit hashes to the Status lines of issues 002 to 005.

## Review findings fixed

| Round | Finding | Fix |
|---|---|---|
| 1 | The README named slot 127 alone. Slots 22-127 of unit-1.img all hold the 155.700 record behind an FF first byte. The entry was one four-sentence bullet. | 142b17f: the entry names slots 22-127 and splits into an images bullet with sub-bullets for the manifest and the unit JSON. |
| 2 | No test checked that `fromImage` loads main memory. With the load replaced by a no-op, all tests passed. | 46827a9: the `PRIMARY` `fromImage` test compares eeprom 0x0000-0x17FF and 0x1EC0-0x1FFF with the image. The no-op mutation now fails one test. |
| 2 | The displayed check required `rxMhz`, so a name-only entry would fail on NaN. | 46827a9: `rxMhz` is optional and its comparison is guarded. |
| 2 | Doc comments on `sameRadioAs`, `decodeSlot` and `readImage` said more than the code does. | 46827a9: the comments match the code. |
| 3 | With both fields optional, an entry with neither `rxMhz` nor `name` passed. | f4a3690: the displayed check throws on such an entry. The overseer made this one-line fix. |

## Findings dropped

- The displayed checks read `expected` at module load, so the first `vitest -u` run fails them. Issue 003 prescribes `expected`, and the failure message says to rerun.
- The round trip passes the original record as `prior`. So the byte 12 low nibble, byte 13 and byte 15 bits 0-3 match trivially. The issue prescribes that design, and the mask comment says the bits come from the prior record.
- `test/cli/cli.test.ts` leaves its temp directory behind. The file leaks other temp directories the same way.
- Round 2 asked to record the MDF follow-up as `issues/006` in this branch. The coordinator kept it in this report for the next review doc. It is listed under Open with the extra scope the reviewers found.

## Disagreements between Opus and Sol

None remained after cross-checks.

- Round 1: Sol withdrew a finding about name-only displayed entries as hypothetical. Round 2 raised it again with a constructed example, and both models backed it.
- Round 2: Sol first answered clean. After the cross-check it agreed on the MDF record objection and added the `settings.test.ts:42` literal.
- Round 3: Sol first answered clean, then agreed with the vacuous-entry nit.

## Open

- **MDF table order.** `src/core/codec.ts:310-311` reads `['freq', 'ch', 'name']`. CHIRP's uv5r driver orders the list Channel, Name, Frequency. All three units store 0x02 and display Frequency. Unit 2 has names on all 15 slots, so 0x02 cannot mean Name. The committed unit JSON therefore records `mdfa` and `mdfb` as "name". Both models back this. The follow-up scope:
  - Change the table to `['ch', 'name', 'freq']` and regenerate unit-1.json to unit-3.json.
  - Change the 'name' literals at `test/core/settings.test.ts:109` to 'freq'.
  - Fix `parseSettingValue('mdfa', 'name')` at `test/core/settings.test.ts:42`; it expects 2 where the CHIRP order gives 1.
  - Compare `mdf` and `displayNumber` in the displayed check in `test/core/golden.test.ts`.
  - Add a correction note beside the "(name)" label for value 2 in `docs/rx-audio-investigation.md:62-63`, keeping the dated history.
- **Issue counts.** The acceptance criteria in issues 002 to 005 still say 4, four, 20 and 4. The set holds three units; see Deviations.

## Next step

Write a review file from the Open items and run the swarm on it.
