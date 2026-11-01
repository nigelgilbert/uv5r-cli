# Review 2: loop 1 of the API unification issues

Target: diff `e031394..6ba5e6d` on `feature/unify-api`. References: `docs/review-1.md`, `docs/swarm-report-1.md`, `docs/code-review-2.md`, `issues/001` to `006`, `../bench-operator/docs/api-unification-2026-10-31.md`.

**Verdict: ready after fixes.** All 24 review 1 findings landed and every acceptance criterion holds; two doc texts describe `raw` too narrowly.

## Checks run

- `npm run typecheck` passes.
- `npm test` passes 37 files and 995 of 995 tests in 21 s.
- Every acceptance criterion in the six issues was run on `--target fake`. On the real radio, `status`, `read 1`, `listen --seconds 1 --input "AIOC Audio" --json` and `volume` ran. All hold.
- The catalog is 4086 bytes, 10 under budget. `help say --json` is 3047 bytes with 7 flags, 25 under. `hear` is 3022. `help errors --json` is 4596. Every size equals `HELP_BYTES`.
- `settings` keeps `partialWrite: false`. `writeSettings` (`src/core/radio.ts:138-149`) writes 0x0E20 and 0x0E30 into the radio's staging buffer, and only the 0x0E40 write commits it to EEPROM (`docs/protocol.md:69-76`). A failure before the commit leaves EEPROM untouched. On the fake, both halves left EEPROM unchanged until the commit write. Issue 003, the `DEVICE` row and `main.ts:656` stay as they are.
- The three departures in the swarm report hold. Slot 3 of `channels.example.json` is `NOAA 3`, so `SHERIFF` could never pass. `parse.test.ts:116` pinned the old `128+signal` string. The `key` test gains the same `type` and `kind` checks issue 001 names.

## Findings

### Nits

1. **Describe `raw` for every verb in `docs/errors.md`**
   - Location: `docs/errors.md:40-46`, the `verification-failed` bullets.
   - Problem: the only `raw` sentence sits in the `settings` bullet and refers to the setting fields. `tune`, `load` and `erase` also report `failed: ["raw"]`. The pre-diff text covered every verb.
   - Evidence: `verificationDetail` (`src/core/radio.ts:88`) returns `failed: ['raw']` when no field differs, for `recordMismatch` and `nameMismatch`. `git show e031394:docs/errors.md` ends the all-verbs paragraph with "`raw` names bytes that differ outside those fields."
   - Fix: end the first bullet with "`raw` appears when every compared field matches and the bytes differ." Reduce the third bullet to "- `settings` compares the setting fields."
   - Settled: exchange 2.

2. **Correct the `nameMismatch` docstring**
   - Location: `src/core/radio.ts:104`.
   - Problem: the docstring says `raw` means only the padding differs. `decodeName` maps every non-printable byte inside the name to a space, so a byte difference inside the name also decodes equal and reports `raw`.
   - Evidence: `s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ';` (`src/core/codec.ts:237`). `41 20 42 ff…` and `41 00 42 ff…` both decode to `"A B"`.
   - Fix: replace the docstring with

     ```ts
     /** Compare a written name record with its read-back by decoded name, or as `raw` when the decoded names match and the bytes differ. */
     ```

   - Settled: independent match.

## Disagreements

None. Exchange 2 settled every dispute.

## Dropped

- Code review 2 finding 1, `settings` `partialWrite: true`: refuted. The radio commits the settings block only on the 0x0E40 write. See "Checks run".
- Code review 2 finding 4, compare the delayed tune against the plain run: contradicts review 1 finding 5, which removed the delta because it flaked. A plain fake tune takes about 0.6 s, well under the 4000 ms floor.
- Code review 2 finding 5, a remedy for `say`: refuted. `REASONS['utterance-too-long']` (`src/core/errors.ts:179-184`) gives `say` the default remedy "shorten the text or raise maxSeconds in the station config, then rerun the command". `id` alone overrides it.
- Code review 2 finding 6, a `WRITES` base for the device literals: review 1 finding 20 prescribed named-field literals. The base is a style preference.
- Code review 2 finding 7, exact per-verb key sets: withdrawn in exchange 1. Review 1 finding 6 and issue 002 ask for presence, and the test checks it.
- The `VERIFY_EXIT` half of code review 2 finding 3: withdrawn in exchange 1. "(raw when only other bytes differ)" reads as bytes that change no decoded field, and review 1 finding 15 prescribed it.
- Retitling `cli.test.ts:295` and `:766` for their added assertions: withdrawn in exchange 1. The titles still describe what the tests check.
- `volume` in issue 003's `partialWrite` list leaves a whole block at squelch 0: review 1 finding 1 added `volume` on purpose, and its device note says so.
- Issue 001 says the canonical fields "come after the detail fields": the text predates the diff, and `toJSON` spreads them after the detail as described.
- `README.md:175` says a failed command prints nothing on stdout, with no `hear` exception: the sentence predates the branch (`e4cfd17`) and sits outside the diff. `docs/errors.md:7` and `OUTPUT_RULE` carry the exception.
- `docs/swarm-report-0.md:54` and `:58` record the loop 0 `partialWrite` and `appliesAfterMs` values: history.

## Open items from the swarm report

- The bench-operator and tinysa-cli breakage stays open and out of scope.

## Run

- Angles: code review 2 findings with the `settings` question; issue acceptance criteria and byte budgets, with the real radio on read-only verbs; review 1 findings 1 to 12 with the finding 8 departure; review 1 findings 13 to 24 with the finding 14 and 22 departures; slop and doc style with the swarm report's claims.
- Agents: 5 Sonnet agents, all read-only.
- Reviewer model: GPT-6.1 Sol (`sol`) through Codex.
- Exchanges: 2 of 3.
