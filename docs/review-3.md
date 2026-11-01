# Review 3: loop 2 of the API unification issues

Target: diff `d5db0df..52c272a` on `feature/unify-api`. References: `docs/review-2.md`, `docs/swarm-report-2.md`, `docs/code-review-3.md`, `issues/001` to `006`, `../bench-operator/docs/api-unification-2026-10-31.md`.

**Verdict: ready after fixes.** Both review 2 nits landed verbatim and read true against the code; one sentence in the swarm report misdescribes the edits.

## Checks run

- `npm run typecheck` passes.
- `npm test` passes 37 files and 995 of 995 tests in 21 s.
- Both review 2 fixes match their fix text. The `nameMismatch` docstring sits at `src/core/radio.ts:104`.
- The `raw` sentence holds for every verb. `verificationDetail` (`src/core/radio.ts:85-90`) returns `failed: ['raw']` when no compared field differs. Each caller runs it only after a hex mismatch. `tune` and `load` call `recordMismatch` and `nameMismatch` at `radio.ts:453` and `:462`, `erase` at `:482` and `:491`, and `settings` goes through `verifySettingsBlock` (`:160-170`).
- `decodeName` (`src/core/codec.ts:232-240`) reads 7 bytes, stops at 0xFF and maps non-printable bytes to a space, so the docstring's "the decoded names match and the bytes differ" is accurate.
- Help text did not change. The catalog is 4086 bytes. `say` is the largest per-verb object at 3047 bytes. `help errors --json` stays at 4596.
- `test/core/radio.test.ts:84`, `:95` and `:837` and `test/core/settings.test.ts:89` assert `failed: ['raw']` for the record, name and settings paths.
- No command ran against the real radio. The fake and a stub session covered the erase read-back cases.

## Findings

### Nits

1. **Describe the loop 2 edits accurately in swarm report 2**
   - Location: `docs/swarm-report-2.md:5`.
   - Problem: "Both items were one-line doc edits." Item 1 edits two bullets across three lines of `docs/errors.md`.
   - Evidence: `git diff --numstat d5db0df..52c272a` gives `3 3 docs/errors.md` and `1 1 src/core/radio.ts`. The hunk changes line 42, adds line 43 and collapses the two-line `settings` bullet to one line.
   - Fix: replace the sentence with "Both items were small text edits." Line 5 then reads "Both items were small text edits. The overseer applied them directly and spawned no agents."
   - Settled: exchange 1.

## Disagreements

None. Exchange 1 settled the only dispute.

## Dropped

- Code review 3 finding 1, erase read-back that decodes to no channel reports `raw`: out of range for Nigel. The behavior is real. A non-blank read-back such as `00 ff ff …` maps every record field to `null` in `recordFields`, which equals the erase's desired nulls, so `failed` is `["raw"]`. The loop 2 sentence describes that case correctly, and the code predates the range.
- Code review 3 finding 2, `VERIFY_EXIT` help text at `src/cli/main.ts:232`: refuted. "raw when only other bytes differ" reads as bytes that change no compared field, which agrees with the new wording. Review 2 withdrew the same point, and review 1 finding 15 prescribed the text.
- Code review 3 finding 3, add `scan` to `RECORD_FIELDS`: refuted. `read` does not print `scan`. `channelPayload` (`src/core/radio.ts:59`) drops it, and `read 3` on the fake prints no `scan` key. No verb writes it. The loop 2 text says "compared field", and `docs/errors.md:44` lists the compared fields to match `RECORD_FIELDS`.
- Code review 3 finding 4, say where `raw` appears: refuted. The same bullet defines `failed` and the `settings` map from each failed field, so `raw` sits in both. The fix would restate the bullet.
- Code review 3 finding 5, `settings.raw` duplicates `wrote` and `read`: out of range for Nigel. The duplication is real and predates the range. It keeps every `failed` key mapped to `{desired, observed}`, and the loop 2 text makes no claim about it.
- Code review 3 finding 6, say the record and name are two writes: refuted. "on the record, then `name`" matches the order of the two checks. The example at `docs/errors.md:11-27` and the messages at `radio.ts:462` and `:491` name the write that failed.

## Open items from the swarm report

- The bench-operator and tinysa-cli breakage stays open and out of scope.

## Run

- Angles: accuracy of the new wording against `nameMismatch`, `decodeName` and the callers; code review 3 findings at their cited lines; the swarm report's claims with typecheck and tests.
- Agents: 3 Sonnet agents, all read-only.
- Reviewer model: GPT-6.1 Sol (`sol`) through Codex. Its sandbox blocked vitest; the swarm ran the suite.
- Exchanges: 1 of 3.
