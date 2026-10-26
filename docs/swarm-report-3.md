# Swarm report 3: review 3

Work file: `docs/review-3.md`. Branch `feature/speech-plan`, base 62ce490. Reviewer: GPT-6.1
Sol through the `codex` skill, exchange cap 3. Test command `npx vitest run`, typecheck
`npm run typecheck`.

Final state: 851 tests in 34 files pass (850 at the base). Typecheck is clean.

## Items

Both items landed as written. Two agents ran: `main.ts` (item 1) and `audio.test.ts` (item 2).
No item was dropped.

### Item 1

Commit 623381a. Tests: 850 pass after the merge.

The `help dump` effects line now ends with "When the port close hangs after the write, the dump
exits 3 with ptt-control-failed and FILE keeps the full image." No test or README text quotes the
line.

Files: `src/cli/main.ts`.

### Item 2

Commit fb6b659. Tests: 851 pass after the merge.

A new `listen` test, "reports a signal stop when the timer did not kill the child", sits after
the test at the old line 211. It advances 5 s of the 21 s timeout, exits the fake child on
`SIGTERM`, and expects no timer kill and "ffmpeg stopped on SIGTERM capturing from "AIOC Audio"".
It fails when `exitHow` always reports a timeout.

The first draft placed the test one slot early. The agent moved it and amended the commit.

Files: `test/cli/audio.test.ts`.

## Consensus findings fixed

None. Both models returned empty lists after the first findings call, so no exchanges ran.

## Unreviewed fixes

None.

## Findings dropped

None.

## Disagreements

None.

## Open items

Verified on the bench by the orchestrator on 2026-10-25, closed in swarm report 1:

- `models.sha256`, the audiotoolbox and avfoundation listings, the whisper-cli pin, the
  `whisperArgs` argv and JSON shape, and model load time.

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
