# Code review 1

Review of `18ebb23..aed4f0b` by the `code-review` skill at effort high, against `docs/speech-plan.md` and `docs/swarm-report-0.md`.

The review gave each finding a category and no confidence score. Its summary counts seven correctness bugs and three cleanups. Its finding text reads as eight bugs (1 to 8) and two cleanups (9 and 10), with finding 10 covering two duplications. The review proposed the fixes for findings 7, 9 and 10. The fixes for the other findings are inferred from the failure scenario the review gave.

1. `src/core/radio.ts:593`
   - Problem: `setPttWithin` gives up on a slow `setPtt(true)` after 3 s and leaves it running. A late assertion can land after `keyWhile` releases, so DTR stays high while the result reports a release. A stalled 4 s DTR-high ioctl completes after the low call and keys the radio, and the remedy text says "check the AIOC cable" without telling the operator to unplug it.
   - Fix (inferred): after a timed-out assert, wait for the pending `setPtt(true)` to settle, then drive DTR low again. If it never settles, report PTT as possibly held and give the unplug remedy.
   - Verdict: correctness bug. Matches swarm report open item 2.

2. `src/cli/main.ts:833`
   - Problem: `withTransport` cleanup awaits an unbounded `transport.close()`. `SerialTransport.close` awaits an unbounded `setPtt(false)` and `port.close`. A hung release ioctl during `say` hangs the process with no error while PTT may be high, which undoes the 3 s bound in `keyWhile`.
   - Fix (inferred): bound `close()` with the PTT control timeout and report `ptt-control-failed` with the unplug remedy when it expires.
   - Verdict: correctness bug. Matches swarm report open item 1.

3. `src/speech/hear.ts:233`
   - Problem: with `--once`, the 30 s split head of a long transmission is transcribed and printed, then `halt()` drops the open remainder. The agent gets the first 30 s without the "over" and replies over a station that is still talking.
   - Fix (inferred): under `--once`, wait for the transmission to end and transcribe the remainder before halting.
   - Verdict: correctness bug.

4. `src/speech/speak.ts:326`
   - Problem: when the watchdog and a signal both fire, `speakUtterance` checks `held.timedOut` first and throws `audio-process-failed` (exit 3). The `interrupted` signal is lost, and the documented exit is 128 plus the signal number.
   - Fix (inferred): check `held.interrupted` before `held.timedOut`.
   - Verdict: correctness bug.

5. `src/speech/hear.ts:245`
   - Problem: on a capture or transcription failure, `kick()` stops starting work and `halt()` empties the queue. Queued segments vanish with no backlog warning and no WAV in `--out-dir`. The signal path warns for each segment and keeps its WAV.
   - Fix (inferred): on failure, drain the queue through the same backlog path the signal handler uses.
   - Verdict: correctness bug.

6. `src/cli/audio.ts:345`
   - Problem: `SIGTSTP` is in `KEY_SIGNALS`, so `sweep` handles Ctrl-Z. The sweep capture ffmpeg runs through `execFile` in the terminal's process group, so Ctrl-Z also stops ffmpeg and the SIGTERM stays pending until the SIGKILL escalation. The interrupted summary arrives about 2 s late.
   - Fix (inferred): start the sweep and check capture ffmpeg in its own process group, as the speech children do.
   - Verdict: correctness bug.

7. `src/cli/main.ts:867`
   - Problem: `fatal()` picks JSON output from `process.argv.includes('--json')` and ignores the `--` rule that `cli()` follows. `uv5r say -- --json` on a terminal prints a fatal error as JSON while `cli()` uses text.
   - Fix: compute the JSON mode once in `cli()` and read it in `fatal()`.
   - Verdict: correctness bug.

8. `src/cli/main.ts:1359`
   - Problem: `prepareOutDir` checks `W_OK|X_OK`, and `nextSeq` then calls `readdirSync`, which needs `R_OK`. A `--out-dir` with mode 0300 throws a raw EACCES and exits 1 as an unexpected error. The expected result is exit 2 with "pass --out-dir with a writable directory".
   - Fix (inferred): add `R_OK` to the `accessSync` check.
   - Verdict: correctness bug.

9. `src/cli/audio.ts:287`
   - Problem: `runFfmpeg` is exported and unused. `condition` in `tts.ts`, `measureWav` in `levels.ts` and `listOutputDevices` in `output.ts` each repeat its error mapping around `execDetached`. A change such as the SIGKILL escalation from open item 5 has to land in each copy.
   - Fix: have `runFfmpeg` call `execDetached`, call it from `condition`, `measureWav` and the device listing, and drop the copies.
   - Verdict: cleanup.

10. `src/speech/stt.ts:113`
    - Problem: `transcribeWav` repeats `execDetached` (detached spawn, stderr tail, timeout, error and close handling, the never-spawned case) with SIGKILL on timeout where `execDetached` uses SIGTERM. `speak.ts:127` copies `wait()` from `radio.ts:604`.
    - Fix: use `execDetached` in `transcribeWav`, and export `wait` from core for `speak.ts`.
    - Verdict: cleanup. The duplicated `wait` matches Review 2 finding S9 in the swarm report.
