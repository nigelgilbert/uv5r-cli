# Swarm report 4: review 4

Work file: `docs/review-4.md`. Branch `feature/speech-plan`, base 9fdb31c. Reviewer: GPT-6.1
Sol through the `codex` skill, exchange cap 3. Test command `npx vitest run`, typecheck
`npm run typecheck`.

Final state: 851 tests in 34 files pass (851 at the base). Typecheck is clean.

## Items

Both items landed as written. Two agents ran: `audio.test.ts` (item 1) and `swarm-report-3.md`
(item 2).

### Item 1

Commit c9098f1. Tests: 851 pass after the merge.

The signal-stop test now runs `await vi.advanceTimersByTimeAsync(30000);` at line 236, before
`expect(child.kills).toEqual([]);`. The fake clock reaches 35 s, past the 21 s timeout and the
2 s kill grace. With `clearTimeout(timer);` removed from `src/cli/audio.ts:276`, the test fails
with `['SIGTERM', 'SIGKILL']`. The agent and the overseer each ran that check.

Files: `test/cli/audio.test.ts`.

### Item 2

Commit c0d8118. No test reads the swarm reports.

Line 12, `No item was dropped.`, is gone from `docs/swarm-report-3.md`. The file stays committed.
Both models agree the in-place edit follows the repo rule. Review 3 dropped code review 3
finding 7 with a no-edit reason that no repo rule contains.

Files: `docs/swarm-report-3.md`.

## Consensus findings fixed

None. Both models ended with empty lists after 2 exchanges.

## Unreviewed fixes

None.

## Findings dropped

- Sol, `docs/swarm-report-3.md:11`: "Both items landed as written." repeats "Findings dropped:
  None." Sol withdrew it in exchange 2. Line 11 reports the work items and "Findings dropped"
  reports review findings, so the two state different facts.

## Disagreements

None.

## Open items

Verified on the bench by the orchestrator on 2026-10-25, closed in swarm report 1:

- `models.sha256`, the audiotoolbox and avfoundation listings, the whisper-cli pin, the
  `whisperArgs` argv and JSON shape, and model load time.

Outside this diff:

- `docs/swarm-report-2.md:11-12` carries the same repeat as item 2 ("All 5 items landed as
  written." and "No item was dropped."). The reviewers raised it as optional.

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
