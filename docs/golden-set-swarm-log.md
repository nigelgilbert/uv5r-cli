# Golden set swarm log

Branch `feature/new-golden-set`. The swarm implemented issues 002 to 005 of [golden-set-plan.md](golden-set-plan.md) from base 1604a05, then ran two review loops. Opus subagents at effort high did the work in worktrees. Each round of review ran Opus and GPT-6.1 Sol, through the `codex` skill, and cross-checked their findings. Nothing is pushed.

| Point | Commit | `npm test` |
|---|---|---|
| Base | 1604a05 | 575 tests in 19 files |
| End of loop 0 | c4b31d9 | 598 tests in 20 files |
| End of loops 1 and 2 | 7fe8005 | 599 tests in 20 files |

`npm run typecheck` is clean at each point. The Result section of each issue file lists its commits and final counts.

## Loop 0: issues 002 to 005

One subagent per issue. Three review rounds.

### What landed

- **002, b005a73.** `IMAGE_AUX = 0x1808` is exported next to `IMAGE_HEADER`. `test/core/golden.ts` reads the manifest and images into `GOLDEN` and `PRIMARY`, exports `AUX_SIZE` and `GoldenUnit`, and checks each image length. `golden.test.ts` checks ident, firmware and aux sha256 per unit, plus a distinct-aux case.
- **003, 17545dd.** `decodeSlot(mem, name)` is extracted from `readChannel` and exported. `fixtures/golden/unit-1.json` to `unit-3.json` hold settings and 128 slots. Per unit the golden test runs a snapshot case, one case per `displayed` entry and a masked encode round trip over 21, 15 and 2 well-formed slots. No slot is malformed or sets bits outside the masks.
- **004, 3beb379.** `FakeRadio.fromImage(image, { magic })` loads ident, main memory and aux, and defaults `magic` to 291. The restore round trip runs per unit in `protocol.test.ts` and `settings.test.ts`. `DEFAULT_SETTINGS` decodes the default fake.
- **005, ff4d18e.** The CLI tests use `PRIMARY`. `test/core/golden.ts` joins the import allowlist. `fixtures/uv5r-hn5rv011-2026-10-12.img` is deleted. The README Bench files entry and `docs/clone-protocol-review.md` point at the golden set.
- **d7391f8** adds commit hashes to the Status lines of issues 002 to 005.

The issues assumed four units. The set holds three, so the tests run 3 identity cases, 3 JSON files, 8 displayed checks (3, 3 and 2) and 3 restore cases per test file. Loop 1 corrected the issue text to match.

### Review findings fixed

| Round | Finding | Fix |
|---|---|---|
| 1 | The README named slot 127 alone. Slots 22-127 of `unit-1.img` hold the 155.700 record behind an FF first byte. The entry was one four-sentence bullet. | 142b17f: the entry names slots 22-127 and splits into sub-bullets for the manifest and the unit JSON. |
| 2 | No test checked that `fromImage` loads main memory. | 46827a9: the `PRIMARY` `fromImage` test compares eeprom 0x0000-0x17FF and 0x1EC0-0x1FFF with the image. |
| 2 | The displayed check required `rxMhz`, so a name-only entry would fail on NaN. | 46827a9: `rxMhz` is optional and its comparison is guarded. |
| 2 | Doc comments on `sameRadioAs`, `decodeSlot` and `readImage` claimed more than the code does. | 46827a9: the comments match the code. |
| 3 | An entry with neither `rxMhz` nor `name` passed. | f4a3690: the check throws on such an entry. Loop 1 replaced this guard with per-mode checks. |

### Findings dropped

- The displayed checks read `expected` at module load, so the first `vitest -u` run failed them. Issue 003 prescribed `expected`, and the failure message said to rerun. Review 1 item 2, `f239798`, compares each entry with a fresh decode of the image, so the first run passes them and a decoder change fails them under `vitest -u`.
- The round trip passes the original record as `prior`, so the byte 12 low nibble, byte 13 and byte 15 bits 0-3 match trivially. Issue 003 prescribes that design.
- `test/cli/cli.test.ts` leaves its temp directory behind, as the file does for its other temp directories.
- Round 2 asked to file the MDF order as `issues/006`. The coordinator carried it into review 1.

### Opus and Sol

- Round 1: Sol withdrew the name-only finding as hypothetical. Round 2 raised it again with a constructed example, and both models backed it.
- Round 2: Sol first answered clean. After the cross-check it agreed on the MDF order and added the `settings.test.ts:42` expectation.
- Round 3: Sol first answered clean, then agreed with the neither-field finding.

## Loop 1: review 1

Base 47b0344, which committed review 1. Seven items, run by three subagents grouped by shared files. Three review rounds. Round 3 ran twice because the host slept after its first fix.

### Items

1. **MDF table order, eecd428.** `src/core/codec.ts` read `['freq', 'ch', 'name']`. All three units store 0x02 and display Frequency. Unit 2 has names on 14 of its 15 programmed slots, so 0x02 cannot mean Name. The table now reads `['ch', 'name', 'freq']`. The unit JSON records `mdfa` and `mdfb` as `freq`. `settings.test.ts:42` expects 1 for `'name'` and `:109` expects `'freq'`. The displayed check compares `displayNumber` with `slot` and `mdf` with `mdfa`. The UV-5R numbers channels 0 to 127 as the CLI does, as unit 3's entries for slots 0 and 127 show. `docs/rx-audio-investigation.md` gains a dated correction note and keeps its history.
2. **Issue counts, 0c453a2.** Issues 002 to 004 give 3 units and 8 displayed checks. The issue 003 body says eight slots across the three units and its criterion gives the 3, 3 and 2 split. Issue 005 states no count and is unchanged.
3. **`fromImage` magic test, 787b2ce.** A fake built with magic ORIG acks ORIG and refuses 291. The rejection runs through `new Session(radio).start(magicByName('291'))` on a second fake, because `startSession` returns a settled session and the first fake is already in one.
4. **Unused exports, 0c453a2.** `DisplayedSlot` and `ManifestUnit` lose `export`.
5. **Stale `PRIMARY` comment, 0c453a2.** It reads "Unit 1, the radio the CLI and protocol tests use."
6. **Aux slice, 787b2ce.** `fromImage` reads `image.subarray(IMAGE_AUX)`.
7. **`PRIMARY` handshake assertions, 787b2ce.** The review asked to delete them. Issue 004 requires them, so they stay. The test is renamed `answers the handshake as PRIMARY and loads its main memory and aux block`, and a comment says the changed-copy test covers the ident load. Sol agreed.

### CHIRP citation for the MDF order

`chirp/drivers/uv5r.py:298` at kk7ds/chirp 21e42e4518c1 reads `MODE_LIST = ["Channel", "Name", "Frequency"]`. Lines 1359-1370 build the `mdfa` and `mdfb` settings from it.

### Review findings fixed

| Round | Finding | Fix |
|---|---|---|
| 1 | `SETTINGS_EXAMPLE` in `src/cli/main.ts` showed `mdfa: 'name'`. Its other fields match unit 1, which decodes `freq`. | 012dcc9: the example shows `freq` for both fields. |
| 1 | Changing the `mdfb` names left every test passing. | 012dcc9: one `MDF_NAMES` const serves both fields. Changing it fails five tests. |
| 1 | The rx-audio correction covered only `mdfa`. | 012dcc9: the note covers both fields. The `mdfa` cells read "2 (name, see correction)". The `mdfb` row carries no label. |
| 1 | A `freq` entry that carried only `name` passed. | 012dcc9: `freq` requires `rxMhz` and `name` requires `name`. |
| 2 | The issue 001 example paired slot 0 with displayNumber 1. | ae40d68: displayNumber 0. |
| 2 | The neither-field guard threw on a `ch` entry. | ae40d68: the guard exempts `ch`. |
| 3 | The per-mode checks left the guard nothing to catch. | 43a69c9: the guard is deleted. |
| 3 | The unit 2 manifest note said names are on all 15 slots. | e4c0a72: names are on slots 0 to 13 and slot 127 has none. |

### Findings dropped

- `image.subarray(IMAGE_AUX)` has no end bound and would throw on an image with a trailer. Every caller passes a golden image that `readImage` length-checks.
- The displayed check compares `mdf` with `mdfa` only. All three units store the same value in both fields, and an entry records one mode.
- The rx-audio note quotes the labels as "(name)" while the cells read "(name, see correction)".
- Sol offered a shorter item 7 comment and a constructor spy to make the `PRIMARY` ident assertion discriminate. Both models rated the spy heavier than the problem.

### Opus and Sol

- Round 1: Sol kept `SETTINGS_EXAMPLE` at `'name'` as a valid mode. Opus showed the example matches unit 1 field for field, and Sol moved to `'freq'`.
- Round 2: Sol first answered clean, then backed both findings.
- Round 3, first pass: Sol first answered clean, then agreed the guard should go.
- Round 3, second pass: Opus proposed fixing the issue 001 example, which still showed 162.400, a unit 2 frequency, under unit 1. Sol rated it optional cleanup of a pre-survey example. Opus accepted, and the item went to review 2.

## Loop 2: review 2

Base d0a03a4, which committed review 2. Three items, run by two subagents. Two review rounds; round 2 came back clean. All changes are doc edits.

### Items

1. **Issue 001 example, 80767ad.** The example entry is slot 1, displayNumber 1, `freq`, 452.125, as in unit 1's manifest entry.
2. **Display field per mode, 80767ad.** Issue 001 step 6 and its second criterion say `freq` carries `rxMhz`, `name` carries `name` and `ch` carries no further field.
3. **Loop 1 report text, cb3e7c0 and c6b9446.** Three lines of the loop 1 report were corrected. This log carries the corrected text.

### Findings dropped

- Two findings on the loop 1 report's Open list and Next step. Those lines recorded the state at the end of loop 1.
- `issues/001-radio-survey.md:26` says the `displayed` array holds "the three channels" while the example shows one. The line predates the diff and the example is shortened.

### Opus and Sol

- Round 1: Sol raised the two loop 1 report findings, then dropped both after the cross-check.
- Round 2: both models answered clean.

## Open

Loop 2 left four agent worktrees under `.claude/worktrees/`. They are gone: `git worktree list` shows only the main checkout and the directory is empty. No item remains open.
