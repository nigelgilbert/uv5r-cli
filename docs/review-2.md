# Review 2

1. exitHow misses a timeout when ffmpeg traps SIGTERM (bug)
   - Files: `src/cli/audio.ts:243`, `test/cli/audio.test.ts`
   - Wrong: `exitHow` reports a timeout only when `e.killed && e.signal`. `execDetached` sets `killed: true` on timeout, and ffmpeg traps SIGTERM and exits 255 with `signal` null. Timeouts in `runFfmpeg`, `capture` and `listOutputDevices` read "exited with code 255". The test at `test/cli/audio.test.ts:193` passes `signal: 'SIGTERM'`, which hides the case.
   - Fix: replace line 243 with `if (e.killed) return \`timed out after ${timeoutMs / 1000}s\`;`. Add a test beside the one at line 193 with the same fake-timers flow that ends with `child.exit(255, { stderr: STDERR })` and no signal. Expect a message matching `/^ffmpeg timed out after 21s capturing from "AIOC Audio"/` and detail `{ device: 'AIOC Audio', code: 255, signal: null }`.
   - Source: code review 4, verify.

2. dump deletes a complete backup image when the port close hangs (bug)
   - Files: `src/cli/main.ts:1202`, `src/cli/main.ts:1229`, `src/cli/main.ts:1238`, `test/cli/cli.test.ts`
   - Wrong: when the dump succeeds and the close then hangs, `withTransport` throws `ptt-control-failed` as review-1 item 2 specifies. The catch in `dumpVerb` runs `rmSync(out)` and removes the finished image.
   - Fix: add `let imageWritten = false;` after `let created = false;` at line 1202. Set `imageWritten = true;` after the `writeFileSync` try/catch closes at line 1229. Change line 1238 to `if (created && !imageWritten) {`. Add a `dump` test where `radio.close` never resolves, with fake timers and a new `--out` path. Expect exit 3 and the file to exist.
   - Source: code review 1 (narrowed to the deletion), verify.

3. Stale ExecError comment (slop)
   - Files: `src/cli/audio.ts:238`
   - Wrong: the comment names only `execFile`; `execDetached` also produces `ExecError`.
   - Fix: replace with `/** The error execFile and execDetached pass to their callbacks. */`
   - Source: de-slop.

4. Redundant stopped flag in speak (slop)
   - Files: `src/speech/speak.ts:289`, `src/speech/speak.ts:290`, `src/speech/speak.ts:299`
   - Wrong: `keyWhile` resolves `stop` only after `setPtt(false)` has started, and `trackRelease` sets `dropping` synchronously. `stopped` true implies `dropping()` true.
   - Fix: delete lines 289 and 290. Replace line 299 with `if (!signalled && !dropping()) identified = true;`
   - Source: code review 10.

5. Always-true condition in keyWhile catch (slop)
   - Files: `src/core/radio.ts:692`
   - Wrong: the catch is reachable only from the failed `setPttWithin(t, true)`, so `!pttAsserted` is always true.
   - Fix: replace the line with `lateAssert = err instanceof BaofengError && err.detail.timedOut === true;`
   - Source: de-slop.

## Open items

Bench work, not findings:

- Phase 1 bench session over the air, then bench item 7. First bench transmission. Bench items 1 to 7 of the plan.
- `say -- TEXT` and the exit on an unknown voice.
- The conditioning chain with `alimiter` at its defaults.
- `astats reset=0` accumulates the sample count.
- `playTo` start latency, tail truncation and level.
- The noise phrase list, which needs recorded traffic.
- Ctrl-C reaching the detached children, and the `listen` and `check` ffmpeg in the uv5r process group.
- Segment timing against bench item 4.
- `say --rehearse` keeps default signal handling because `afplay` is not detached.
