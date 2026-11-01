# Review 1: loop 0 of the API unification issues

Target: diff `e4cfd17..ec045f8` on `feature/unify-api`. References: `issues/001` to `006`, `docs/swarm-report-0.md`, `docs/code-review-1.md`, `../bench-operator/docs/api-unification-2026-10-31.md`.

**Verdict: ready after fixes.** Every acceptance criterion holds at `ec045f8`. Two help fields report wrong values and several tests assert less than the criteria they cover.

## Checks run

- `npm run typecheck` passes.
- `npm test` passes 37 files and 989 of 989 tests in 20 s.
- Every acceptance criterion in the six issues was run on `--target fake`, and the read-only ones on the real radio (`listen`, `hear --once`, `volume`). All hold.
- The catalog is 4036 bytes. `help say --json` is 3017 bytes with 7 flags. Every verb is at most 3022 bytes. `help errors --json` is 4596 bytes.
- `name-not-taken` and `tune-wrong-freq` give `failed: ["name"]` and `failed: ["txHz"]` on `tune`, `load` and `erase`.

## Findings

### Gaps

1. **Mark the multi-block writers `partialWrite: true`**
   - Location: `src/cli/main.ts:375`, `:394`, `:449`, `:693` and the `volume` device block; `issues/003-execution-metadata.md`, "What to build" and criterion 1.
   - Problem: `tune`, `erase`, `check` and `sweep` write the record and then the name as separate blocks. A failure on the name leaves the record in place, yet help reports `partialWrite: false`. `volume` writes squelch 0 and leaves it there when the restore fails. The issue lists only `load` and `restore`, which contradicts its own definition and spec item 4.
   - Evidence: `UV5R_FAKE_FAULT=name-not-taken node src/cli/main.ts tune 446.00625 --channel 5 --name ABC --target fake --json` exits 5 with "channel 5 record written; name did not take the write", and `read 5` then returns `rxHz: 446006250` with `name: ""`. `writeChannel` and `eraseChannel` are at `src/core/radio.ts:442-500`.
   - Fix: set `partialWrite: true` for `tune`, `erase`, `check`, `sweep` and `volume`. Leave `settings` false, since the radio commits the block only on the 0x0E40 write. Update the `DEVICE` rows at `test/cli/cli.test.ts:55-73` and the tune text assertion (`partial write  yes`). In issue 003, set the definition to "true for `load`, `restore`, `tune`, `erase`, `check`, `sweep` and `volume`" and criterion 1 to `partialWrite: true`.
   - Settled: independent match; `volume` added in exchange 1.

2. **Report `appliesAfterMs: 0` for `settings`**
   - Location: `src/cli/main.ts:599`; `issues/003-execution-metadata.md`, "What to build".
   - Problem: `settings` with pairs waits for the reload and reads the block back in a fresh session before it exits, yet help reports a 3000 ms delay after exit. `check`, `sweep`, `restore` and `volume` wait the same way and report 0.
   - Evidence: `settingsVerb` (`main.ts:1329-1333`) awaits `verifySettingsInFreshSession`, which calls `startFreshSession`, which awaits `settle()` (`radio.ts:184-197`).
   - Fix: set `appliesAfterMs: 0` and the note to `'the settings block with FIELD VALUE pairs; reads only with none'`. In issue 003, change the delay text to "3000 for `tune`, `load` and `erase`, 0 otherwise". Update the `settings` row in `DEVICE`.
   - Settled: exchange 1 (raised by Sol).

3. **Document `--rehearse` in `help say`**
   - Location: `src/cli/main.ts:486`.
   - Problem: the flag help uses contrastive framing. `help say` no longer says the result adds `rehearsed`, which e4cfd17 stated (`main.ts:505`). `say` inherits `PTT_ONLY` with `opensPort: true`, though `--rehearse` keeps the port closed. These are code review findings 6 and 9.
   - Evidence: `{ name: 'rehearse', help: 'play through afplay instead of keying' }`. `node src/cli/main.ts help say --json | grep -c rehearsed` prints 0. `src/tts/speak.ts:275` sets `rehearsed: true`.
   - Fix: set the flag help to `'play through afplay with the port closed; the result adds rehearsed'`. `say` grows to about 3046 bytes. Update `HELP_BYTES.say`. Leave `PTT_ONLY` as it is, since a `say`-only device note would push `say` past 3072.
   - Settled: exchange 1.

4. **Report `raw` for a name that differs only in padding**
   - Location: `src/core/radio.ts:105`.
   - Problem: `nameMismatch` always reports `failed: ["name"]`. When only the bytes past the decoded name differ, `desired` equals `observed`. The record path reports `raw` in that case, as `docs/errors.md` describes.
   - Evidence: corrupting byte 15 of a name block gives `"failed":["name"],"settings":{"name":{"desired":"TEST","observed":"TEST"}}`.
   - Fix: return `verificationDetail({ name: decodeName(wrote) }, { name: decodeName(read) }, wrote, read)` from `nameMismatch`. Add padding-only tests for the write and erase paths in `test/core/radio.test.ts`.
   - Settled: independent match.

5. **Assert on the `tune-delay:4000` run alone**
   - Location: `test/cli/fake-target.test.ts:157-165`.
   - Problem: the test subtracts two separate process runs in a `describe.concurrent` suite and requires `3500 < delta < 5000`. Start-up time varies by several hundred ms between runs, so the window flakes. It failed once in loop 0.
   - Evidence: six back-to-back runs under load gave `plain` from 1408 to 1797 ms and deltas from 3776 to 4172 ms. The first came within 276 ms of the lower bound.
   - Fix: replace the two `delta` assertions with `expect(delayed.ms).toBeGreaterThanOrEqual(4000)` and `expect(delayed.ms).toBeLessThan(14_000)`. Keep `plain` for its exit code only. Retitle the test "tune-delay:4000 returns the tune at least 4 s later".
   - Settled: independent match.

6. **Test the per-verb help keys on every verb**
   - Location: `test/cli/cli.test.ts:271-305`.
   - Problem: the loop that asserted each verb's help keys was deleted with no replacement. Dropping `example`, `args`, `effects` or `result` from any verb except `tune` passes. Issue 002 criterion 2 asks that `help VERB --json` keeps every field.
   - Evidence: only `tune` is checked key by key, and `say` only for `preconditions`, `flags` and `fields`. Only `check` has an exact catalog-entry assertion.
   - Fix: add the test "every verb's help carries the per-verb fields". Loop over `Object.keys(HELP_BYTES.verbs)` and assert that each object has `schemaVersion`, `verb`, `summary`, `usage`, `example`, `args`, `flags`, `effects`, `preconditions`, `device`, `result`, `exits` and `exitsNote`. Also assert `fields` on `say`, `id` and `settings`, `lines` on `hear`, and that each catalog entry has exactly the keys `summary`, `usage` and `flags`.
   - Settled: exchange 1.

7. **Test issue 006 criteria 2 and 4**
   - Location: `test/cli/cli.test.ts:723` and `:733-737`.
   - Problem: no test prints a valid channel record in MHz on a terminal, and the `help read` test leaves `result` unchecked. Only the `load` text line (`cli.test.ts:1465`) pins MHz output.
   - Evidence: the `read` terminal test covers a malformed record only. The `help read` test asserts the malformed text only.
   - Fix: under "read output", add "prints a channel record in MHz on a terminal". Run `read 5` on a radio holding 446.00625 and assert the line holds `rx 446.00625 tx 446.00625`. Add a `tune` terminal test asserting `rx 446.00625`. In the `help read` test, assert `result` has numeric `rxHz` and `txHz` and no `rxMhz`.
   - Settled: exchange 1.

8. **Assert `failed` and `settings` on the CLI `load` failures**
   - Location: `test/cli/cli.test.ts:1372-1386` and `:1400-1416`.
   - Problem: both tests assert `reason`, `message`, `remedy` and `slot` only. A regression in `withDetail` at `main.ts:1116` could drop `failed` or `settings` and pass.
   - Evidence: `test/core/radio.test.ts` covers the detail shape. The CLI wrapping is untested.
   - Fix: add `failed: expect.any(Array), settings: expect.any(Object)` to the corrupt-write test. Add `failed: ['name'], settings: { name: { desired: 'SHERIFF', observed: '' } }` to the ignored-name test.
   - Settled: exchange 1.

### Nits

9. **Name `txHz` in issue 001 criterion 3**
   - Location: `issues/001-error-envelope.md`, criterion 3.
   - Problem: the checked criterion names `txMhz`. The code emits `txHz`, which issue 006 prescribes ("The `verification-failed` field list from #001 uses the new names").
   - Evidence: `UV5R_FAKE_FAULT=tune-wrong-freq node src/cli/main.ts tune 446.00625 --channel 1 --target fake --json` exits 5 with `"failed":["txHz"],"settings":{"txHz":{"desired":446006250,"observed":447006250}}`.
   - Fix: replace `txMhz` with `txHz` in the criterion.
   - Settled: independent match.

10. **Correct which results carry Hz fields**
    - Location: `issues/006-integer-hz-results.md`, "What to build"; `docs/swarm-report-0.md:28`.
    - Problem: both texts say `erase` and the `sweep` summary report `rxHz` and `txHz`. `erase` reports no frequency, `check` and `sweep` report `requestedHz`, and no result reports an offset.
    - Evidence: `erase` returns `{"channel":127,"empty":true,"appliesAfterSeconds":3}`. `src/cli/sweep.ts:155` sets `requestedHz`.
    - Fix: in both files, replace the first sentence with "`read`, `tune` and `load` report `rxHz` and `txHz` as integers. `check` and `sweep` report `requestedHz`. `erase` reports no frequency and no result reports an offset."
    - Settled: independent match.

11. **Leave `volume` out of the `input` sentence in `docs/receive.md`**
    - Location: `docs/receive.md:13`.
    - Problem: "The result and any capture error report the input as `input`" covers `volume`, whose result has only `state`, `rmsDbfs` and `instruction`.
    - Evidence: `help volume --json | jq -c .result` gives `{"state":"too-loud","rmsDbfs":-10.4,"instruction":"..."}`.
    - Fix: "The `check`, `listen`, `hear` and `sweep` results and any capture error report the input as `input`."
    - Settled: exchange 1 (raised by Sol).

12. **Give `id` its own `utterance-too-long` remedy**
    - Location: `src/tts/speak.ts:252-257`.
    - Problem: the remedy starts "shorten the text", and `id` takes no text. This is code review finding 3.
    - Evidence: `id --config c.json --target fake --json` with `maxSeconds: 3` exits 2 with remedy "shorten the text or raise maxSeconds in the station config...".
    - Fix: pass `options.idOnly ? { remedy: 'raise maxSeconds in the station config, then rerun the command' } : {}` as the `UsageError` guidance. In the `maxSeconds: 3` test in `test/cli/id-cli.test.ts`, assert the remedy does not contain "shorten".
    - Settled: exchange 1.

13. **Restore the `hear` exception in `OUTPUT_RULE`**
    - Location: `src/cli/main.ts:133`.
    - Problem: the rule says a failed command prints no result. A `hear` capture or file-write failure keeps the NDJSON lines already printed, and `help hear` lists only `speech-engine-failed` for that. e4cfd17 covered every `hear` failure. This is code review finding 4.
    - Evidence: `src/tts/hear.ts:148-149` reads "A capture or transcription failure stops capture ... and throws; lines already printed stay printed". `hear.ts:127` throws `file-write-failed`.
    - Fix: `'JSON when piped or with --json, else text; hear prints NDJSON. A failed command prints its error on stderr and no result; hear keeps lines printed before it.'` The catalog grows by about 35 bytes.
    - Settled: exchange 1.

14. **State the default signal behavior in the catalog**
    - Location: `src/cli/main.ts:145`.
    - Problem: `'128+signal'` reads "a signal; help VERB says what prints". Ten verbs say nothing about signals in their help. e4cfd17 said "Other verbs end on a signal with no output."
    - Evidence: `status`, `identify`, `tune`, `check`, `load`, `read`, `erase`, `restore`, `settings` and `listen` have no "signal" text in `help VERB --json`.
    - Fix: `'a signal; help VERB says what prints, else nothing'`. With finding 13 the catalog is about 4085 bytes. Update `HELP_BYTES.catalog`.
    - Settled: exchange 1.

15. **Describe when `raw` appears**
    - Location: `src/cli/main.ts:232`; `docs/errors.md`, the `verification-failed` bullet; `.claude/skills/uv5r/SKILL.md` if it repeats the wording.
    - Problem: "(raw for other bytes)" implies `raw` joins any failure with stray bytes. `verificationDetail` (`radio.ts:85-90`) lists `raw` only when no decoded field differs.
    - Evidence: `if (failed.length === 0) return { failed: ['raw'], ... }`.
    - Fix: in `VERIFY_EXIT`, write "(raw when only other bytes differ)". In `docs/errors.md`, write "`raw` appears when only bytes outside those fields differ".
    - Settled: exchange 1.

16. **Record the `help errors` size**
    - Location: `test/cli/cli.test.ts`, `HELP_BYTES`.
    - Problem: issue 002 records measured help sizes in a test. The new `help errors --json` topic, 4596 bytes, has no entry and can grow unnoticed.
    - Evidence: `HELP_BYTES` holds `catalog` and `verbs` only.
    - Fix: add `errors: 4596` and a tolerance assertion in the budget test, with no ceiling.
    - Settled: exchange 1.

17. **Drop "and not written" from the `load` effect**
    - Location: `src/cli/main.ts:412`.
    - Problem: contrastive framing.
    - Evidence: `'Validate every entry before the port opens. checkMhz is validated and not written.'`
    - Fix: `'Validate every entry and checkMhz before the port opens.'`
    - Settled: exchange 1.

18. **Split the `verification-failed` bullet in `docs/errors.md`**
    - Location: `docs/errors.md`, the `verification-failed` bullet under "Error object".
    - Problem: the bullet is a five-sentence paragraph.
    - Evidence: the bullet runs from "A `verification-failed` error from `tune`..." to "`raw` names bytes that differ outside those fields."
    - Fix: split it into three bullets.
      - "A `verification-failed` error from `tune`, `load`, `erase` or `settings` adds `failed`, the fields that read back wrong, and `settings`, a map from each failed field to `{desired, observed}`. `wrote` and `read` hold the bytes as hex."
      - "`tune`, `load` and `erase` compare `rxHz`, `txHz`, `txTone`, `rxTone`, `bandwidth` and `power` on the record, then `name`. An erase desires `null` for each record field and `""` for the name."
      - "`settings` compares the setting fields. `raw` appears when only bytes outside those fields differ."
    - Settled: exchange 1.

19. **Drop the `type` sentence below the JSON example**
    - Location: `docs/errors.md`, "Error object", the line after the JSON example.
    - Problem: "`type` is `"error"`." repeats the example above it.
    - Evidence: `` `type` is `"error"`. `kind` follows from `reason` and sets the exit code: ``
    - Fix: `` `kind` follows from `reason` and sets the exit code: ``
    - Settled: exchange 1.

20. **Replace the positional `device()` helper**
    - Location: `src/cli/main.ts:285`.
    - Problem: `device()` takes five unlabeled booleans and numbers, so swapped arguments type-check. This is code review finding 7.
    - Evidence: `function device(opensPort: boolean, cloneSession: boolean, writesToRadio: boolean, appliesAfterMs: number, partialWrite: boolean, note: string): DeviceDoc`.
    - Fix: write each block as a `DeviceDoc` object literal with named fields. Keep `READS_ONLY`, `PTT_ONLY` and `AUDIO_ONLY` as literals and spread them where a note differs, as in `{ ...READS_ONLY, note: 'reads only; writes FILE' }` for `dump`. Delete `device()` and its docstring.
    - Settled: independent match.

21. **Derive `Pacing` from `SpeakOptions`**
    - Location: `src/tts/speak.ts:95`.
    - Problem: `Pacing` declares the four fields `SpeakOptions` already declares. This is code review finding 8, whose `Pick<Station, ...>` fix fails because the `Station` fields are optional.
    - Evidence: both interfaces declare `voice`, `leadMs`, `tailMs` and `maxSeconds`.
    - Fix: `type Pacing = Pick<SpeakOptions, 'voice' | 'leadMs' | 'tailMs' | 'maxSeconds'>;`. Keep the `pacing` object. Leave `TRANSMIT_RESULT` and `TRANSMIT_FIELDS` in `main.ts`.
    - Settled: independent match.

22. **Assert `type` and `kind` on the CLI `device-unavailable` test**
    - Location: `test/cli/cli.test.ts:192`.
    - Problem: issue 001 criterion 1 names `kind: "transport"`. The CLI test checks `reason` only.
    - Evidence: `kind` is asserted only at `test/core/transport.test.ts:72`.
    - Fix: add `type: 'error', kind: 'transport'` to the `toMatchObject`.
    - Settled: exchange 1.

23. **Test config `voice` and `leadMs` on `id`**
    - Location: `test/cli/id-cli.test.ts`.
    - Problem: `say` has a test that config `voice` and `leadMs` reach the synth and the result. `id` has none.
    - Evidence: the `id` tests cover `tailMs: 0`, `maxSeconds: 3` and the result key list.
    - Fix: add an `id` test with `config({ callsign: 'KJ7ABC', voice: 'Daniel', leadMs: 500 })` asserting `synth.calls[0].voice === 'Daniel'` and `leadMs: 500` in the result.
    - Settled: exchange 1.

24. **Rename the test titles that name `--device`**
    - Location: `test/cli/check.test.ts:117`, `test/cli/sweep.test.ts:547`, `test/cli/volume.test.ts:169`, `test/cli/hear-cli.test.ts:121`.
    - Problem: the titles name the removed flag while the tests pass `--input`.
    - Evidence: "passes --device to listen with 5 s at -50 dBFS", "reports --device in the summary", "passes --device to listen", "passes --device over the config inputDevice".
    - Fix: replace `--device` with `--input` in each title. Title the sweep test "reports input in the summary".
    - Settled: exchange 1.

## Disagreements

None. Exchange 1 settled every dispute.

## Dropped

- Code review 1: `hear` stops on an out-of-range transmit field. User decision: batteries included. `parseStation` has validated every field on every verb since before this diff, and issue 005 prescribes the range checks.
- Code review 5, `appliesAfterSeconds` in results: withdrawn in exchange 1. The field predates the diff and no issue asks for the rename.
- Sol's comment-length finding at `src/core/errors.ts:235`, `src/cli/help.ts:1`, `src/core/radio.ts:80` and `src/tts/station.ts:44`: withdrawn in exchange 1. All four are docstrings, which may run several sentences.
- `fatal()` exits 1 for any kind (`src/cli/main.ts:929`): reachable only through an unhandled rejection of a typed error. The fix adds defensive code.
- `docs/errors.md` never writes `--input`: e4cfd17's file had no `--device`, and the new text documents the `input` field.
- CLI tests for `erase` and `settings` verification failures: `test/core/radio.test.ts` and `test/core/settings.test.ts` cover the shape, and finding 8 covers the CLI wrapping.
- A test pinning the `help --json` guidance in SKILL.md: the text is present at `SKILL.md:10`, and no rule calls for the test.
- A `mhzText` docstring naming `formatMhz` and the `HELP_TOPICS` comment: style preference with no rule behind it.
- Help headroom and a ceiling for `help errors --json`: the budget test fails at the ceiling, and no issue sets a ceiling for the topic. Finding 16 records the size.
- `docs/plan-volume.md` and `docs/bench-volume-trial-0.md` still describe the old help shape: they are history files with no inbound links.
- bench-operator and tinysa-cli breakage: known open items, out of scope.

## Open items from the swarm report

- Item 3, `txMhz` in issue 001: the code is right. Finding 9 fixes the issue text.
- Item 4, `partialWrite`: findings 1 and 2.
- Item 5, headroom and `help errors`: not a gap against the issues. Finding 16 records the topic size.

## Run

- Angles: issues 001 and 006 with code review 5; issues 002 and 003 with code review 2, 4 and 6; issues 004 and 005 with code review 1 and 3 on the real radio; slop and doc style with code review 7, 8 and 9; test coverage.
- Agents: 5 Sonnet agents, all read-only.
- Reviewer model: GPT-6.1 Sol (`sol`) through Codex.
- Exchanges: 1 of 3.
