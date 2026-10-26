# Code review 4

Range: `62ce490..50b37fa`, reviewed with `/code-review` at effort high. Context: `docs/review-3.md`, `docs/speech-plan.md` and `docs/swarm-report-3.md`.

The review found no correctness bugs. The help text matches the code, and the new test fails as the report says. 851 tests in 34 files pass. The review gave no per-finding verdict or confidence score.

1. `src/cli/main.ts:554`
   - Problem: the new exit-3 `ptt-control-failed` outcome after a hung close, with FILE holding the full image, sits in the dump `effects` list. The `exits` code 3 entry at line 562 says only that an existing FILE may be left partial. An agent reading `uv5r help dump --json` can discard a good image on this exit. `EXITS_NOTE` names `exits` as the field for exit-code notes.
   - Fix: move the sentence into the `exits` code 3 entry.
   - Verdict: none given.

2. `src/cli/main.ts:1517`
   - Problem: the documented exit 3 after a hung close depends on `process.exit(process.exitCode)`. That call skips the stdout and stderr drain the `cli()` docstring relies on. On macOS, stderr pipes are asynchronous, so `uv5r dump --json 2>err.json` can exit 3 with empty or truncated stderr. The code predates this range. The new help line states the outcome as guaranteed.
   - Fix: none given. Drain stdout and stderr before `process.exit`, or soften the help line.
   - Verdict: none given.

3. `src/cli/main.ts:554`
   - Problem: the after-the-write sentence sits in the first effect, ahead of the effect that reads the image and writes FILE. The effects list reads out of order.
   - Fix: group the failure outcomes after the read and write effect, or move them into `exits`.
   - Verdict: none given.

4. `test/cli/audio.test.ts:227`
   - Problem: the new test checks `child.kills` only at 5 s. It never advances past the 21 s timeout after the child exits. A `finish` that stopped calling `clearTimeout(timer)` would still pass.
   - Fix: after the exit, add `await vi.advanceTimersByTimeAsync(30000); expect(child.kills).toEqual([])`.
   - Verdict: none given.

5. `test/cli/audio.test.ts:227`
   - Problem: the new test copies the setup of the two tests above it: `vi.useFakeTimers`, `try/finally useRealTimers`, `fakeChild`, `spawn.mockReturnValue` and `listen(...).catch((e) => e)`. Three copies drift when the `listen` signature or the fake child API changes.
   - Fix: nest the three tests in `describe('listen timeout', ...)` with `beforeEach(vi.useFakeTimers)` and `afterEach(vi.useRealTimers)`. Add a helper that returns `{ child, pending }`.
   - Verdict: none given.

6. `docs/swarm-report-3.md:54`
   - Problem: the "Open items" section opens with items it calls closed in swarm report 1. The "Still open" list repeats the open-items list in `docs/review-3.md` word for word. This breaks the "Say each idea once" style rule.
   - Fix: drop the closed items from "Open items" and point to `docs/review-3.md` for the open list.
   - Verdict: none given.

7. `docs/swarm-report-3.md:11`
   - Problem: "Both items landed as written." is repeated by "No item was dropped." and again by the "Findings dropped: None." section. This breaks the "Say each idea once" style rule.
   - Fix: keep one of the three statements.
   - Verdict: none given.
