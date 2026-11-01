# Swarm report 1: review 1 of the loop 0 diff

Date: 2026-10-31. Branch `feature/unify-api`, base `e031394`.
Work: the 24 findings in `docs/review-1.md`, 8 gaps and 16 nits.
Run: `swarm:implement-no-validate`, four concurrent Opus agents in worktrees, grouped by file. The overseer cherry-picked each group onto the branch.

Final checks: `npm run typecheck` passes. `npm test` passes 995 of 995 tests in 37 files, up from 989.

Help sizes: catalog 4086 bytes (budget 4096). `say` 3047 bytes with 7 flags, the largest verb (budget 3072). `help errors` 4596 bytes.

## Groups

- A: findings 1, 2, 3, 6, 7, 8, 13 to 20 and 22. Files `src/cli/main.ts`, `test/cli/cli.test.ts`, `issues/003-execution-metadata.md`, `docs/errors.md`.
- B: finding 4. Files `src/core/radio.ts`, `test/core/radio.test.ts`.
- C: findings 12, 21 and 23. Files `src/tts/speak.ts`, `test/cli/id-cli.test.ts`.
- D: findings 5, 9, 10, 11 and 24. Files `test/cli/{fake-target,check,sweep,volume,hear-cli}.test.ts`, `issues/001-error-envelope.md`, `issues/006-integer-hz-results.md`, `docs/swarm-report-0.md`, `docs/receive.md`.

## Per item

1. `partialWrite: true` for `tune`, `erase`, `check`, `sweep` and `volume`; `settings` stays false. Issue 003 definition and criterion 1 now match. `DEVICE` rows, the tune device assertion and the `partial write  yes` text assertion updated. Commit `8add5e0`.
2. `settings` reports `appliesAfterMs: 0` with the note `'the settings block with FIELD VALUE pairs; reads only with none'`. Issue 003 delay text reads "3000 for `tune`, `load` and `erase`, 0 otherwise". The note test asserts the exact text. Commit `8add5e0`.
3. `--rehearse` help reads `'play through afplay with the port closed; the result adds rehearsed'`. `HELP_BYTES.say` is 3047. `PTT_ONLY` unchanged. Commit `74009a1`.
4. `nameMismatch` returns `verificationDetail` on the decoded names, so a padding-only difference reports `raw`. Two padding-only tests cover the write and erase paths. `name-not-taken` on `--target fake` still reports `failed: ["name"]`. Commit `9877821`.
5. The `tune-delay:4000` test asserts `delayed.ms` between 4000 and 14000 and keeps `plain` for its exit code. Retitled as written. Commit `f37c32d`.
6. New test "every verb's help carries the per-verb fields" checks the 13 keys on every verb, `fields` on `say`, `id` and `settings`, `lines` on `hear`, and exact catalog entry keys. Commit `5314cf4`.
7. New terminal tests for `read 5` and `tune` print `rx 446.00625 tx 446.00625`. The `help read` test checks numeric `rxHz` and `txHz` and no `rxMhz`. Commit `5314cf4`.
8. The corrupt-write `load` test asserts `failed` and `settings`. The ignored-name test asserts `failed: ['name']` and `settings: { name: { desired: 'NOAA 3', observed: '' } }`. Slot 3 of `channels.example.json` is `NOAA 3`, so the review's `SHERIFF` was replaced with the name the test loads. Commit `5314cf4`.
9. Issue 001 criterion 3 names `txHz`. Commit `d938e6a`.
10. Issue 006 and `docs/swarm-report-0.md` open with the corrected Hz sentence. The report bullet drops the two sentences the new text repeats. Commit `d938e6a`.
11. `docs/receive.md` names the `check`, `listen`, `hear` and `sweep` results. Commit `d938e6a`.
12. `id` gets the remedy `'raise maxSeconds in the station config, then rerun the command'`. The `maxSeconds: 3` test asserts no "shorten". Commit `6bf75a5`.
13. `OUTPUT_RULE` adds "hear keeps lines printed before it". Commit `bc534c3`.
14. `128+signal` reads `'a signal; help VERB says what prints, else nothing'`. `HELP_BYTES.catalog` is 4086. `test/cli/parse.test.ts:116` pinned the old text and was updated by the overseer. Commits `bc534c3`, `f98aa3c`.
15. `VERIFY_EXIT` reads "(raw when only other bytes differ)". `docs/errors.md` carries the new wording through finding 18. SKILL.md had no `raw` wording and is unchanged. Commit `c31fb3f`.
16. `HELP_BYTES.errors` is 4596 with a tolerance assertion and no ceiling. Commit `5314cf4`.
17. The `load` effect reads `'Validate every entry and checkMhz before the port opens.'` Commit `c31fb3f`.
18. The `verification-failed` bullet in `docs/errors.md` is three bullets with the review's text. Commit `c31fb3f`.
19. The `type` sentence below the JSON example is gone. Commit `c31fb3f`.
20. `device()` and its docstring are deleted. Each block is a `DeviceDoc` literal with named fields; `dump` spreads `READS_ONLY`. Commit `9732e64`.
21. `type Pacing = Pick<SpeakOptions, 'voice' | 'leadMs' | 'tailMs' | 'maxSeconds'>`. Commit `43a194a`.
22. The CLI `device-unavailable` test asserts `type: 'error'` and `kind: 'transport'`. The `key` device-unavailable test asserts the same. Commit `5314cf4`.
23. New `id` test with config `voice: 'Daniel'` and `leadMs: 500` checks the synth call and the result. Commit `4a95c44`.
24. The four test titles name `--input`; the sweep test reads "reports input in the summary". Commit `c6f3592`.

Test command for every item: `npm run typecheck` and `npm test` on the final commit.

## Hardware

No agent used the real radio. Every write and fault path ran on `--target fake` or in tests.

## Findings dropped

None. The review's own dropped list stands.

## Open items

- The bench-operator and tinysa-cli breakage from loop 0 remains out of scope.
