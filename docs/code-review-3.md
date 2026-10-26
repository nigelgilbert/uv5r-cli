# Code review 3

Review of `da76937..bdf7b29` by the `code-review` skill at effort high. Context files were `docs/review-2.md`, `docs/speech-plan.md` and `docs/swarm-report-2.md`. The review gave no confidence scores. It ranked finding 1 the most serious and found no crash or wrong-result bug in the five items. Findings 1 to 4 are correctness gaps. Findings 5 and 6 are latent guards. Finding 7 is a style cleanup.

The review checked these and found them safe:

- Removing the `stopped` flag in `speak.ts`. `trackRelease` sets `dropping` synchronously before `keyWhile` resolves `stop`.
- Dropping `!pttAsserted` in `keyWhile`. Only the failed assertion reaches that catch.
- The `exitHow` change for the Node `execFile` callers `play` and `checkFfmpeg`. Node sets `killed` only when its own timeout, abort or maxBuffer handling kills the child.

1. `src/cli/main.ts:1240`
   - Problem: when the dump writes the image and the port close then hangs, the CLI exits 3 with `ptt-control-failed`. The error has no `out` or `bytes` detail and stdout prints nothing. An operator or agent reads exit 3 as a failed backup, may discard `radio.img`, and reruns a 14 s clone session on a port that may still have PTT high. The new test checks only `reason` and `message`.
   - Fix: when `imageWritten` is set, add `out` and `bytes` to the rethrown error detail and say in the message that FILE holds the complete image. Assert those fields in the test.
   - Verdict: correctness gap, ranked most serious.

2. `src/cli/audio.ts:279`
   - Problem: `execDetached` reports success when a timed-out child traps SIGTERM and exits 0, because the `code === 0` branch runs before `timedOut` is checked. `say`, `whisper-cli` or an ffmpeg pass that hits its timeout and exits 0 hands back a truncated WAV or partial transcript as complete. A truncated utterance could then be keyed and transmitted. Item 1 fixed only the exit-255 case in `exitHow`.
   - Fix: call back with a killed `ExecError` whenever `timedOut` is set, whatever the exit code.
   - Verdict: correctness bug.

3. `src/cli/main.ts:554`
   - Problem: the `help dump` effects line from commit 6a7e2d7 covers only failures before the image write. It gives no outcome for a failure after the write, so an agent cannot tell that FILE holds a valid image after an exit-3 `ptt-control-failed`.
   - Fix: add that a failure after the write, such as a hung port close, exits 3 and keeps the full image in FILE.
   - Verdict: documentation gap in the unreviewed consensus fix; pairs with finding 1.

4. `src/cli/main.ts:1226`
   - Problem: `writeFileSync` truncates an existing FILE before writing. A write failure such as ENOSPC or EIO leaves an earlier backup truncated or half-written. Cleanup runs only for a new FILE because `created` is false for an existing one, so both the old and new images are lost.
   - Fix: write to a temp file in the same directory and rename it into place.
   - Verdict: correctness bug.

5. `src/speech/speak.ts:297`
   - Problem: with the `stopped` guard gone, `identified` depends only on `dropping()` from `trackRelease`. `dropping` defaults to `() => false` and is reassigned only inside the `withPort` callback. Any path that runs `body` with an untracked transport marks a stopped playback as identified, and the station-ID logic records a callsign that was never fully sent. No code or test enforces this invariant.
   - Fix: add a test that stops playback mid-ID and asserts `identified` stays false, or restore the `stopped` check.
   - Verdict: latent risk from a future refactor; current code is safe.

6. `src/core/radio.ts:694`
   - Problem: dropping `!pttAsserted` removes the only guard that limits `lateAssert` to the assertion step. The catch is right only because nothing after `setPttWithin(t, true)` in that `try` can throw. A later step that throws a timed-out `BaofengError` would set `lateAssert` after a confirmed assertion, and `keyFailureMessage` and the remedy would report a late assertion that never happened.
   - Fix: restore the `!pttAsserted` check in the `lateAssert` assignment.
   - Verdict: latent risk from a future edit; current code is safe.

7. `docs/swarm-report-2.md:12`
   - Problem: the report says the same thing three times. Line 11 says "All 5 items landed as written", line 12 says "No item was dropped", and line 59 says both models agreed items 1 to 5 landed as written. "Findings dropped: None" repeats it again. This breaks the say-each-idea-once rule.
   - Fix: keep line 11, delete "No item was dropped." on line 12, and cut the repeat at line 59.
   - Verdict: style cleanup.
