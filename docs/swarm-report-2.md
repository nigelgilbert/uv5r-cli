# Swarm report 2: review 2 of the golden set

Branch `feature/new-golden-set`, base d0a03a4, which commits `docs/review-2.md`. Two Opus subagents at effort high ran the three items in worktrees. Items 1 and 2 share `issues/001-radio-survey.md` and ran in one agent. Two review rounds ran, with Opus and GPT-6.1 Sol through the `codex` skill. Round 2 came back clean. Nothing is pushed.

Tests at the final commit: `npm test` passes 599 tests in 20 files, and `npm run typecheck` is clean. The baseline at d0a03a4 was 599 tests in 20 files. All changes are doc edits.

## Deviations from the review text

- **Item 3, line 69.** A literal swap of the quoted phrase leaves "repeat the claim names on ... claim". The agent replaced `repeat the "names on every one of its 15 slots" claim` with the fix text. Round 1 then added "programmed".

## What landed

### Items 1 and 2 issue 001: 80767ad

Checked against `fixtures/golden/unit-1.json`: slot 0 is empty and slot 1 receives 452.125. `fixtures/golden/manifest.json` lists slot 1 first for unit 1. 162.400 is on unit 2. `test/core/golden.test.ts:78-79` requires `rxMhz` for `freq` and `name` for `name`.

- `issues/001-radio-survey.md:31`: the example `displayed` entry is slot 1, displayNumber 1, `freq`, 452.125.
- `issues/001-radio-survey.md:24`: step 6 ends "`rxMhz` for `freq` and `name` for `name`. A `ch` entry carries no further field."
- `issues/001-radio-survey.md:45`: the criterion reads "`mdf` and, for `freq` and `name`, the displayed field".

### Item 3 swarm report 1: cb3e7c0

Checked against `issues/003-decoded-expectations.md:22` and `:33`, commits 0c453a2, eecd428 and 012dcc9, `docs/rx-audio-investigation.md:62-63`, `docs/review-1.md:9` and `docs/swarm-report-0.md:81`.

- `docs/swarm-report-1.md:11`: "The body now says eight slots across the three units and the criterion gives the 3, 3 and 2 split."
- `docs/swarm-report-1.md:23`: "The history stays, with the `mdfa` cells annotated." The `mdfb` row was never annotated.
- `docs/swarm-report-1.md:69`: the two records "claim names on all 15 of unit 2's slots".

## Review findings fixed

| Round | Finding | Fix |
|---|---|---|
| 1 | `docs/swarm-report-1.md:69` read as if unit 2 has 15 slots. It has 128, and 15 are programmed: 0 to 13 and 127. The wording came from the review text. | c6b9446: "all 15 of unit 2's programmed slots". The overseer made this one-word fix. |

## Findings dropped

- `docs/swarm-report-1.md:67-68` and `:74`: the Open bullets and Next step still describe the end of the review 1 run. They record that run, and this report records the closure.
- `issues/001-radio-survey.md:26` says the `displayed` array holds "the three channels" while the example shows one. The line predates the diff and the example is shortened.
- `docs/swarm-report-1.md:69` no longer says slot 127 has no name. Line 49 says it.

## Disagreements between Opus and Sol

- Round 1: Sol first raised the two stale-record findings at `docs/swarm-report-1.md:67-68` and `:74`, then dropped both after the cross-check. Its proposed line 74 named cb3e7c0 inside the file that commit changes.
- Round 2: none. Both models answered clean.

## Open

- Four worktrees remain under `.claude/worktrees/`. Two are from earlier runs: `agent-a7c8fe491c985bec9` and `agent-aa0712616e0ffadcc`. Two are from this run, and their commits are cherry-picked: `agent-a28b7b21b75b0fb5b` and `agent-a773bd86829551a57`.

## Next step

Remove the worktrees with `git worktree remove`, or write a review file if the golden set needs more work.
