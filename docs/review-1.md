# Review 1

Verify and de-slop of `18ebb23..aed4f0b`. `npx vitest run` passes (830 tests in 34 files) and `npm run typecheck` is clean. Items 1 to 11 are bugs, 12 and 13 are gaps, 14 to 18 are slop. Line numbers refer to aed4f0b.

Item 8 moves `execDetached` to `src/cli/audio.ts`. Items 3, 14 and 15 then edit it at its new location.

## Bugs

1. `setPttWithin` leaves a timed-out assert pending
   - Files: `src/core/radio.ts:588`, `src/core/radio.ts` (`keyWhile`), `test/core/radio.test.ts`
   - Problem: after the 3 s bound, `setPtt(true)` stays pending. A late completion keys the radio after `keyWhile` released. The failure message says "check the AIOC cable" with `released` true.
   - Fix: in `setPttWithin`, when `on` is true and the call times out, run `void set.then(() => t.setPtt(false), () => {})` before rethrowing. Give the timeout error detail `{ timedOut: true }`. In `keyWhile`, record `lateAssert = !pttAsserted && err.detail.timedOut === true` and use the unplug remedy and the message `PTT assertion unconfirmed: <cause>; <unplug text>` when it is set. In the "fails a hung assertion" test, resolve the hung assert after the release and expect `pttLog` `[true, false, false]` and the unplug remedy.
   - Source: code review 1, report open item 2

2. `withTransport` awaits an unbounded `close()`
   - Files: `src/cli/main.ts:827`, `src/core/index.ts`, `test/cli/cli.test.ts`
   - Problem: `SerialTransport.close` awaits an unbounded `setPtt(false)` and `port.close`. A hung release ioctl hangs `say`, `key` and `sweep` with PTT possibly high.
   - Fix: export `PTT_CONTROL_TIMEOUT_MS` from `src/core/index.ts`. In `withTransport`, race `transport.close()` against a `PTT_CONTROL_TIMEOUT_MS` timer, in both the success path and the error path. On a timeout in the success path, throw `TransportError('ptt-control-failed', 'the port did not close within 3 s; PTT may be high', {}, { remedy: REASONS['ptt-control-failed'].remedy, retry: 'no' })`. On a timeout in the error path, rethrow the original error. Delete the transport from `openTransports` after either path. Test with a `FakeRadio` whose `close()` never resolves, under fake timers: expect exit 3, the unplug remedy, and the original error on the error path.
   - Source: code review 2, report open item 1

3. `execDetached` never sends SIGKILL
   - Files: `src/speech/output.ts:21` (`src/cli/audio.ts` after item 8), `test/speech/output.test.ts:94`
   - Problem: a child that ignores SIGTERM never calls back, so the verb hangs.
   - Fix: add `let escalate: NodeJS.Timeout | undefined;`. In the timeout handler, after `child.kill('SIGTERM')`, set `escalate = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();`. Add `clearTimeout(escalate);` in `finish`. In the test, advance by `KILL_GRACE_MS` and expect kills `['SIGTERM', 'SIGKILL']`.
   - Source: report open item 5

4. `identified` is set when the player exits 0 inside the release window
   - Files: `src/speech/speak.ts:305`, `test/speech/speak.test.ts`
   - Problem: `keyWhile` drops PTT before it resolves `stop`, so `stopped` is false in that window. A player that exits 0 after PTT dropped or after a signal sets `identified`.
   - Fix: in the `trackRelease` wrapper, set `dropping = true` when `setPtt(false)` is called and expose `dropping()`. At line 305 use `if (!stopped && !signalled && !dropping()) identified = true;`. Test a player that exits 0 after a signal is emitted and before it settles: expect `identified: false`.
   - Source: report open item 3

5. A `ptt-control-failed` after a signal mid-play lacks the result fields
   - Files: `src/speech/speak.ts:290`, `src/speech/speak.ts:319`, `test/speech/speak.test.ts`
   - Problem: after a signal, `playTo` rejects as stopped, so `playFailed` stays false. A later release failure skips the attach of `idOwed`, `playedSeconds`, `pttAsserted` and `released`.
   - Fix: change line 319 to `if (startedAt !== undefined && err instanceof BaofengError) {` and delete `playFailed` (lines 290 and 301). Test a signal mid-play with a failing `setPtt(false)`: expect `idOwed`, `playedSeconds` and `pttAsserted` on the error.
   - Source: report open item 4

6. `speakUtterance` runs the pre-key steps after a signal
   - Files: `src/speech/speak.ts:225`, `test/speech/speak.test.ts`
   - Problem: after a pre-key signal, the `--out` copy, measurement and validation still run. An exit 2 or 3 can replace the interrupted result.
   - Fix: move the `--out` copy after `measureWav`. Hoist `kept` and `unkeyed` above it and compute `measured` right after `measureWav`. Add `if (signalled) return unkeyed(signalled);` after `const levels = await deps.measureWav(wav);`. Run the digital-zero check, the `utterance-too-long` check and the `--out` copy only when no signal arrived. Test SIGINT emitted from the `condition` fake with a WAV that would fail `utterance-too-long`: expect the interrupted result and no throw.
   - Source: report open item 7

7. A watchdog plus a signal loses `interrupted`
   - Files: `src/speech/speak.ts:326`, `test/speech/speak.test.ts:256`
   - Problem: when both fire, `held.timedOut` is checked first and `speakUtterance` throws `audio-process-failed` (exit 3) in place of the documented 128 plus the signal number.
   - Fix: change line 326 to `if (held.timedOut && !held.interrupted) {`. Test a player run past `maxMs` with SIGINT emitted during the grace: expect `interrupted: 'SIGINT'` and no throw.
   - Source: code review 4

8. The sweep capture ffmpeg shares the terminal process group
   - Files: `src/cli/audio.ts:348`, `src/speech/output.ts`, `src/speech/tts.ts`, `src/speech/levels.ts`, `test/cli/audio.test.ts`
   - Problem: Ctrl-Z also stops the `execFile` ffmpeg, so the SIGTERM stays pending until the SIGKILL escalation and the interrupted summary arrives about 2 s late.
   - Fix: move `execDetached`, `STDERR_KEEP` and the `ChildProcess` import from `src/speech/output.ts` to `src/cli/audio.ts` and export `execDetached`. Import it from `../cli/audio.ts` in `output.ts`, `tts.ts` and `levels.ts`. Replace the `execFile` at `audio.ts:348` with `child = execDetached('ffmpeg', ffmpegArgs(device, seconds, out), timeoutMs, (e, stderr) => {`. Set `STDERR_KEEP` to `64 * 1024 * 1024` so the astats parse sees the whole stderr. Rewrite the `listen` and `capture` cases in `test/cli/audio.test.ts` to mock `spawn` with `spawnThen` and `fakeChild` from `test/speech/fakes.ts`, and add one test that `spawn` gets `{ detached: true }` for the capture.
   - Source: code review 6

9. `fatal()` picks JSON mode from raw `process.argv`
   - Files: `src/cli/main.ts:867`, `test/cli/cli.test.ts`
   - Problem: `uv5r say -- --json` on a terminal prints a fatal error as JSON while `cli()` uses text.
   - Fix: add `let activeFlags = new Map<string, string | true>();` near `fatalRun`. Set `activeFlags = flags;` in `cli()` after each assignment of `flags`. Replace the line 867 condition with `if (wantsJson(activeFlags))`. Test with `process.stdout.isTTY = true` and `say -- --json`: expect stderr to start with `uv5r: boom`.
   - Source: code review 7

10. `prepareOutDir` does not check read access
   - Files: `src/cli/main.ts:1318`, `test/cli/hear-cli.test.ts`
   - Problem: `nextSeq` calls `readdirSync`, which needs `R_OK`. A `--out-dir` with mode 0300 throws a raw EACCES and exits 1.
   - Fix: change line 1318 to `accessSync(outDir, fsConstants.W_OK | fsConstants.X_OK | fsConstants.R_OK);`. Test `chmodSync(dir, 0o300)`, expect exit 2 with `cannot write to`, and restore the mode in `finally`.
   - Source: code review 8

11. `speakText` prints "asserted for 0 s" when PTT never rose
   - Files: `src/cli/main.ts:1108`, `test/cli/say-cli.test.ts`
   - Problem: `unkeyed()` in `speak.ts` returns `pttAsserted: false`, and the text line still says "asserted for 0 s; released".
   - Fix: replace the `ptt` line with `const ptt = r.rehearsed ? \`not asserted; rehearsed ${r.seconds} s with the port closed\` : r.pttAsserted ? \`asserted for ${r.seconds} s; released\` : 'not asserted';`. Test a signal during synthesis on a TTY: expect `PTT        not asserted\n` and no `asserted for`.
   - Source: report open item 6

## Gaps

12. The `hear --once` stall cap is undocumented
   - Files: `README.md:202`, `src/cli/main.ts:657`, `src/speech/hear.ts:17`, `src/speech/hear.ts:141`
   - Problem: capture stops at `--timeout` plus 40 s even while frames arrive, and the open segment is transcribed as it stands. README and help say an open segment runs to close. The report says the middle path documents the cap and no text does.
   - Fix: in `README.md:202` and the `main.ts:657` string, replace `and an open segment runs to close and is transcribed.` with `and an open segment runs to close and is transcribed, up to 40 s past the timeout.` In the `hear.ts` docstring at line 141, replace `an open one runs to close, and the queue drains.` with `an open one runs to close or until MAX_SEGMENT_SECONDS plus STALL_SLACK_SECONDS past the deadline, and the queue drains.` Replace the comment at `hear.ts:17` with `/** Seconds added to --timeout and the longest segment before hear --once stops capture, even while frames arrive. */`.
   - Source: verify (disagreement 2)

13. `parseStation` branches without tests
   - Files: `test/speech/station.test.ts`, `src/speech/station.ts:24`, `src/speech/station.ts:34`
   - Problem: a non-object or array input and a callsign with characters other than letters and digits have no test.
   - Fix: add `expect(() => parseStation([])).toThrow()` and `expect(() => parseStation({ callsign: 'KJ7-ABC' })).toThrow()` with the messages the code throws.
   - Source: verify

## Slop

14. `runFfmpeg` is unused and three callers repeat its error mapping
   - Files: `src/cli/audio.ts:287`, `src/speech/tts.ts:79`, `src/speech/levels.ts:55`, `src/speech/output.ts:101`, `test/cli/audio.test.ts:377`
   - Problem: `condition`, `measureWav` and `listOutputDevices` each repeat the ENOENT, stderr tail and `exitHow` mapping around `execDetached`.
   - Fix: after item 8, add `export function ffmpegFailure(e: ExecError, stderr: string, what: string, timeoutMs: number): TransportError` holding the mapping. Rewrite `runFfmpeg` to call `execDetached` and reject with `ffmpegFailure`. In `tts.ts`, `condition` becomes `await runFfmpeg(conditionArgs(input, output, leadMs), \`conditioning ${input}\`, CONDITION_TIMEOUT_MS);`. In `levels.ts`, `measureWav` becomes `return parseWavLevels(await runFfmpeg(measureArgs(file), \`measuring ${file}\`, MEASURE_TIMEOUT_MS));`. In `output.ts`, `listOutputDevices` keeps its partial listing and rejects with `ffmpegFailure(e, stderr, 'listing audiotoolbox devices', LIST_TIMEOUT_MS)`. Rewrite the `runFfmpeg` tests with the spawn fakes.
   - Source: code review 9

15. `transcribeWav` repeats `execDetached`
   - Files: `src/speech/stt.ts:108`, `test/speech/stt.test.ts`
   - Problem: it repeats the detached spawn, stderr tail, timeout, error and close handling, and kills with SIGKILL where `execDetached` uses SIGTERM. `STDERR_KEEP` is defined a second time.
   - Fix: build the promise with `execDetached('whisper-cli', whisperArgs(wav, out, options), WHISPER_TIMEOUT_MS, (e, stderr) => { ... })`. In the callback map ENOENT to `whisperMissing()`. Map other errors to `speech-engine-failed` with the message `whisper-cli ${typeof e.code === 'string' ? e.message : exitHow(e, WHISPER_TIMEOUT_MS)} on ${wav}` plus the stderr tail. Read and parse the JSON as today, attach `{ wav }, WHISPER_FAILED` to a `speech-engine-failed` error, and `rmSync(json, { force: true })` in `finally`. Drop the `spawn` import and `STDERR_KEEP`. Add a test with a small timeout that expects "timed out after".
   - Source: code review 10

16. `wait` is copied from `radio.ts`
   - Files: `src/speech/speak.ts:127`, `src/core/radio.ts:604`, `src/core/index.ts`
   - Problem: `speak.ts` holds a verbatim copy of `wait`.
   - Fix: change `function wait` to `export function wait` in `radio.ts`, add `wait` to the radio exports in `src/core/index.ts`, import it in `speak.ts`, and delete the copy at lines 126 to 135.
   - Source: code review 10

17. `play` casts to an inline copy of `ExecError`
   - Files: `src/cli/audio.ts:254`
   - Problem: the cast repeats the `ExecError` shape.
   - Fix: replace `err as (NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals | null }) | null` with `err as ExecError | null`.
   - Source: de-slop

18. Comment and docstring cleanup
   - Files: `src/cli/args.ts:15`, `src/speech/hear.ts:166`
   - Problem: the `parseArgs` docstring has a broken wrap, and the JSDoc on `deadlineStop` restates the name.
   - Fix: rewrite the `parseArgs` docstring as `Split argv into a verb, positionals and \`--flag [value]\` pairs. \`-h\` stands for \`--help\`. Every argument after the first \`--\` is a positional, so text may start with a dash. Throw UsageError on a value given to a boolean flag and on a flag given twice, except \`--help\`.` Delete the JSDoc line above `let deadlineStop`.
   - Source: de-slop

## Open items

Bench items that need the radio:

- Step 5: the phase 1 bench session runs the operator loop over the air, then bench item 7.
- Step 3: the first bench transmission.
- Bench items 1 to 7 of the plan.
- Parse of the audiotoolbox device-list format `[N] name, UID` against real output.
- The listing command sends one frame of silence to the default output.
- Both AIOC entries are named "AIOC Audio".
- `say -- TEXT` and the exit on an unknown voice.
- The conditioning chain with `alimiter` at its defaults.
- `astats reset=0` accumulates the sample count.
- `playTo` start latency, tail truncation and level.
- The whisper-cli argv and the `transcription[].text` JSON shape.
- The whisper.cpp v1.9.5 pin.
- `models.sha256` against downloaded files.
- The noise phrase list.
- Model load time against inference.
- Ctrl-C reaching the detached children.
- Segment timing against bench item 4.
- `say --rehearse` keeps default signal handling because `afplay` is not detached.
