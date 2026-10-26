1. No test covers the timer clear on a normal exit
   - Files: `test/cli/audio.test.ts:236`
   - Problem: the new signal-stop test checks `child.kills` at 5 s, before the 21 s timer can fire. Removing `clearTimeout(timer)` at `src/cli/audio.ts:276` leaves all 851 tests passing.
   - Fix: insert `await vi.advanceTimersByTimeAsync(30000);` on its own line before `expect(child.kills).toEqual([]);` at line 236. With `clearTimeout(timer)` removed, the test then fails with `['SIGTERM', 'SIGKILL']`.
   - Source: code review finding 4, verify.

2. Report states the item outcome twice
   - Files: `docs/swarm-report-3.md:11-12`
   - Problem: "Both items landed as written." and "No item was dropped." say the same thing in one paragraph.
   - Fix: delete line 12, `No item was dropped.`
   - Source: code review finding 7, de-slop.

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
