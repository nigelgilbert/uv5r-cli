# Swarm report 2: review 2 nits

Work: `docs/review-2.md`. Branch `feature/unify-api`, base `d5db0df`. Mode: implement without validation.

Both items were one-line doc edits. The overseer applied them directly and spawned no agents.

## Items

### 1. Describe `raw` for every verb in `docs/errors.md`

- Landed: the first `verification-failed` bullet ends with "`raw` appears when every compared field matches and the bytes differ." The `settings` bullet reads "- `settings` compares the setting fields."
- Files: `docs/errors.md`.
- Commit: `255b346`.

### 2. Correct the `nameMismatch` docstring

- Landed: the docstring at `src/core/radio.ts:104` matches the fix text in review 2.
- Files: `src/core/radio.ts`.
- Commit: `255b346`.

## Tests

Run on `255b346`. Help text did not change, so the byte budgets hold at the review 2 sizes.

- `npm run typecheck`: passes.
- `npm test`: 37 files, 995 passed, 0 failed.

## Dropped

None.

## Open items

- The bench-operator and tinysa-cli breakage stays open and out of scope.
