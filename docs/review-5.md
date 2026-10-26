1. Dump help puts the hung-close exit in effects only
   - Files: `src/cli/main.ts:554`, `src/cli/main.ts:562`, `test/cli/cli.test.ts:933-939`
   - Problem: the exit-3 `ptt-control-failed` outcome after a hung close sits in the first `effects` entry, ahead of the read and write effect. The `exits` list covers only the write failure. `EXITS_NOTE` names `exits` as the field for per-code notes.
   - Fix: at line 554, replace the entry with `'Open FILE before the port opens; a new FILE is removed when the dump fails before the image write, and stays empty after a signal before the write.',`. After the code 3 entry at line 562, add `{ code: 3, when: 'ptt-control-failed when the port close hangs after the write; FILE keeps the full image' },`. In `test/cli/cli.test.ts`, rename the test at line 933 to `'names the probe exit, the post-read write exit and the hung close exit in help dump'` and add the same entry after line 938.
   - Source: code review finding 1, code review 4 findings 1 and 3, verify.

2. No test covers the kill-grace clear after a timeout
   - Files: `test/cli/audio.test.ts:220`
   - Problem: the timeout tests stop at 21 s. Removing `clearTimeout(escalate)` at `src/cli/audio.ts:277` sends SIGKILL at 23 s to a child that exited during the grace, and all 851 tests still pass.
   - Fix: in the test "reports a timeout when ffmpeg traps SIGTERM and exits 255", insert `await vi.advanceTimersByTimeAsync(5000);` and `expect(child.kills).toEqual(['SIGTERM']);` on their own lines after `const err = await pending;` at line 220. With `clearTimeout(escalate)` removed, the test then fails with `['SIGTERM', 'SIGKILL']`.
   - Source: code review finding 2, verify.

3. Reports 1 and 2 state the item outcome twice
   - Files: `docs/swarm-report-1.md:13`, `docs/swarm-report-2.md:12`, `docs/swarm-report-4.md:60-64`
   - Problem: both reports end the items paragraph with "No item was dropped." after saying every item landed. Review 4 item 2 cut the same repeat from report 3. Report 4 leaves the report 2 case open under "Outside this diff" and misses report 1.
   - Fix: in `docs/swarm-report-1.md:13`, replace `station tests (item 13). No item was dropped.` with `station tests (item 13).`. In `docs/swarm-report-2.md:12`, delete ` No item was dropped.` from the end of the line. In `docs/swarm-report-4.md`, delete lines 60 to 64, the "Outside this diff" block.
   - Source: code review findings 3 and 4, de-slop.

4. Report 4 item 2 pre-empts an objection and cites the wrong finding
   - Files: `docs/swarm-report-4.md:29-31`
   - Problem: "The file stays committed. Both models agree the in-place edit follows the repo rule." answers an imagined objection. The next sentence is about code review 3 finding 7, which concerned `swarm-report-2.md`. Item 2 came from code review 4 finding 7.
   - Fix: keep the first sentence of line 29, which ends "is gone from `docs/swarm-report-3.md`.", and delete the rest of lines 29 to 31.
   - Source: code review findings 5 and 7, de-slop.

5. Reports 2 to 4 repeat the bench items closed in report 1
   - Files: `docs/swarm-report-2.md:80-84`, `docs/swarm-report-3.md:54-58`, `docs/swarm-report-4.md:55-59`
   - Problem: each "Open items" section opens with items swarm report 1 closed. This breaks the rule to say each idea once.
   - Fix: delete the "Verified on the bench by the orchestrator on 2026-10-25, closed in swarm report 1:" line, its bullet and the blank line after it in each file.
   - Source: code review finding 6, code review 4 finding 6, de-slop.

## Dropped findings

- Code review finding 1, the claim that the `exits` entry contradicts the effects line: the two describe different exit-3 paths, and both hold. The gap it found is item 1.
- Code review finding 6, the pointer to `docs/review-4.md` in place of the "Still open" copy: the swarm:implement skill requires the report to hold its open items.
- Code review finding 8: the sentence records why Sol withdrew the finding, and the skill asks for a reason on each drop.
- Code review finding 9: style preference. The test name matches its assertions.
- Code review 4 finding 2: the hung-close error is about 300 bytes, far under the 128 KB pipe buffer, so `process.exit` loses no output.
- Code review 4 finding 5: style preference. No rule asks for shared setup across the timeout tests.

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
