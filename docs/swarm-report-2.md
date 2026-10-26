# Swarm report 2: review 2

Work file: `docs/review-2.md`. Branch `feature/speech-plan`, base da76937. Reviewer: GPT-6.1
Sol through the `codex` skill, exchange cap 3. Test command `npx vitest run`, typecheck
`npm run typecheck`.

Final state: 850 tests in 34 files pass (848 at the base). Typecheck is clean.

## Items

All 5 items landed as written. Four agents ran: `audio.ts` (items 1 and 3), `dumpVerb`
(item 2), `speak.ts` (item 4) and `radio.ts` (item 5). No item was dropped.

### Items 1 and 3

Commits 4f8f4d5, b386fa2. Tests: 849 pass on the agent branch.

- Item 1: `exitHow` reports a timeout whenever `killed` is set. A new `listen` test ends a
  timed-out capture with exit 255 and no signal, and expects "timed out after 21s" with detail
  `{ device: 'AIOC Audio', code: 255, signal: null }`. It fails against the old line.
- Every `exitHow` caller sets `killed` only on a timeout. `capture` and `playTo` kill on stop
  without setting it. An external SIGTERM still reads "stopped on SIGTERM".
- Item 3: the `ExecError` comment names `execFile` and `execDetached`.

Files: `src/cli/audio.ts`, `test/cli/audio.test.ts`.

### Item 2

Commit 8f5b17e. Tests: 849 pass on the agent branch.

`dumpVerb` sets `imageWritten` after the write and removes a new FILE only when it is unset.
`withTransport` still throws `ptt-control-failed` on a hung close. A new test hangs
`radio.close` under fake timers, expects exit 3, and checks the file holds the full image. It
fails against the base code.

Files: `src/cli/main.ts`, `test/cli/cli.test.ts`.

### Item 4

Commit 623e30e. Tests: 848 pass on the agent branch.

The `stopped` flag is gone. `stop` resolves only through `resolveStop()` after
`setPttWithin(t, false)` has called `t.setPtt(false)`, and `trackRelease` sets `dropping`
before its first await.

Files: `src/speech/speak.ts`.

### Item 5

Commit 2a8baae. Tests: 848 pass on the agent branch.

The `lateAssert` line drops `!pttAsserted`. Nothing after the assertion throws into that catch.
`pttAsserted` stays for `keyFailureMessage` and the `seconds` field.

Files: `src/core/radio.ts`.

## Consensus findings fixed

Two dispute exchanges settled the fix text. Both models agreed that items 1 to 5 landed as
written and that the implementer notes hold.

1. The `help dump` effects line still said a new FILE is removed on any error. It now reads
   "a new FILE is removed when the dump fails before the image write, and stays empty after a
   signal before the write." Commit 6a7e2d7.

## Unreviewed fixes

The fix above. Tests: 850 pass after the merge.

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
