1. Help text omits the outcome after the image write
   - Files: `src/cli/main.ts:554`
   - Problem: the `help dump` effects line covers failures before the image write. It gives no outcome for a hung port close after the write, so an agent reading exit 3 `ptt-control-failed` cannot tell that FILE holds the full image.
   - Fix: replace the line with `'Open FILE before the port opens; a new FILE is removed when the dump fails before the image write, and stays empty after a signal before the write. When the port close hangs after the write, the dump exits 3 with ptt-control-failed and FILE keeps the full image.'`
   - Source: code review finding 3, verify. Code review finding 1 merges here.

2. No test for the external SIGTERM reading
   - Files: `test/cli/audio.test.ts`
   - Problem: swarm report 2 claims an external SIGTERM still reads "stopped on SIGTERM" in `exitHow`. No test covers it.
   - Fix: after the test at line 211, add `it('reports a signal stop when the timer did not kill the child', ...)`. Exit the fake child with signal `SIGTERM` before the timeout and expect `ffmpeg stopped on SIGTERM capturing from "AIOC Audio"`.
   - Source: verify.

## Open items (bench)

- The phase 1 bench session over the air, then bench item 7.
- The first bench transmission.
- Bench items 1 to 7 of the plan.
- `say -- TEXT` and the exit on an unknown voice.
- The conditioning chain with `alimiter` at its defaults.
- `astats reset=0` accumulates the sample count.
- `playTo` start latency, tail truncation and level.
- The noise phrase list, which needs recorded traffic.
- Ctrl-C reaching the detached children, and the `listen` and `check` ffmpeg in the uv5r process group.
- Segment timing against bench item 4.
- `say --rehearse` keeps default signal handling because `afplay` is not detached.
