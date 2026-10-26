# Swarm report 5: review 5

Work file: `docs/review-5.md`. Branch `feature/speech-plan`, base 314f879. Reviewer: GPT-6.1
Sol through the `codex` skill, exchange cap 3. Test command `npx vitest run`, typecheck
`npm run typecheck`.

Final state: 851 tests in 34 files pass (851 at the base). Typecheck is clean.

## Items

All 5 items landed as written. Three agents ran: `main.ts` and `cli.test.ts` (item 1),
`audio.test.ts` (item 2) and the swarm reports (items 3 to 5).

### Item 1

Commit 21284bd. Tests: 851 pass after the merge.

The dump effects entry at `src/cli/main.ts:554` ends at "stays empty after a signal before the
write." The hung close is a second code 3 entry in `exits` at line 563. The help dump test at
`test/cli/cli.test.ts:933` has the new name and expects the new entry.

Files: `src/cli/main.ts`, `test/cli/cli.test.ts`.

### Item 2

Commit 51280c3. Tests: 851 pass after the merge.

The SIGTERM-trap timeout test advances 5 s after the exit and expects `['SIGTERM']`. With
`clearTimeout(escalate);` removed from `src/cli/audio.ts:277`, the test fails with
`['SIGTERM', 'SIGKILL']`. The agent, the overseer and the reviewer each ran that check.

Files: `test/cli/audio.test.ts`.

### Items 3 to 5

Commits 9bc3e52 (item 3), 125aeba (item 4) and fdba8f4 (item 5). No test reads the swarm
reports.

Reports 1 and 2 end their items paragraph at the last group. Report 4 item 2 keeps its first
sentence. Reports 2 to 4 open "Open items" with the bench list, and report 4 has no "Outside
this diff" block.

Files: `docs/swarm-report-1.md`, `docs/swarm-report-2.md`, `docs/swarm-report-3.md`,
`docs/swarm-report-4.md`.

## Consensus findings fixed

None. Both models returned empty lists on the first pass, so 0 exchanges ran.

## Unreviewed fixes

None.

## Findings dropped

None.

## Disagreements

None.

## Open items

Still open, all bench work:

- The phase 1 bench session over the air, then bench item 7.
- The first bench transmission.
- Bench items 1 to 7 of the plan.
- `say -- TEXT` and the exit on an unknown voice.
- The conditioning chain with `alimiter` at its defaults.
- `astats reset=0` accumulates the sample count.
- `playTo` start latency, tail truncation and level.
- The noise phrase list, which needs recorded traffic.
- Ctrl-C reaching the detached children, and the `listen` and `check` ffmpeg in the uv5r
  process group.
- Segment timing against bench item 4.
- `say --rehearse` keeps default signal handling because `afplay` is not detached.
