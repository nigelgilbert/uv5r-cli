# Code review 2

Review of `01b8ae5..c7b5ca1` by the `code-review` skill at effort high. The review ran in recall mode: it deduplicated findings without verifying them and ran no tests. Findings 1 to 6 are correctness bugs. Findings 7 to 10 are cleanups.

1. `src/cli/main.ts:870`
   - Problem: a port close that hangs after a successful `fn` throws `ptt-control-failed` and discards the result. The catch in `backupVerb` (main.ts ~1238) then runs `rmSync(out)` and deletes a complete backup image. `write`, `erase` and `restore` report failure after the radio already changed.
   - Fix: keep the result of a successful `fn` when only the close hangs, and report the hung close as a warning with the unplug remedy.
   - Verdict: correctness bug, unverified.

2. `src/cli/main.ts:858`
   - Problem: when `fn` fails and the close also hangs, `closeHung` is set and the error output never mentions the hung port or that PTT may be high. On `say`, a player failure rethrows with `ID_OWED_REMEDY` or no remedy, and the human gets no unplug instruction.
   - Fix: attach the "PTT may be high; unplug the AIOC" remedy to the rethrown error when `closeHung` is set.
   - Verdict: correctness bug, unverified.

3. `src/cli/main.ts:1515`
   - Problem: `process.exit` right after `cli()` returns can cut off the JSON error or result just written to piped stdout or stderr. This contradicts the `cli()` docstring that piped output arrives whole. An agent can see exit 3 with no error body or unplug remedy.
   - Fix: wait for stdout and stderr to drain before exiting, or set `process.exitCode` and let the process end.
   - Verdict: correctness bug, unverified. The review is uncertain whether Node writes piped output asynchronously on macOS.

4. `src/cli/audio.ts:242`
   - Problem: `exitHow` reports a timeout only when a signal is set. `execDetached` sends SIGTERM on timeout, ffmpeg traps it and exits 255 with `signal` null and `killed` true. Timeouts in `runFfmpeg`, `capture` and `listOutputDevices` read as "ffmpeg exited with code 255". `stt.ts` dropped its explicit `timedOut` message and relies on `exitHow`.
   - Fix: check `e.killed` in `exitHow` to report "timed out after Ns" for every caller.
   - Verdict: correctness bug, unverified.

5. `src/cli/main.ts:868`
   - Problem: `openTransports.delete` runs when the close hung. If an `uncaughtException` or `unhandledRejection` fires before `process.exit`, `fatal()` finds an empty set and reports the error without `FATAL_UNCONFIRMED` or the unplug remedy while the port is still open.
   - Fix: leave the transport in `openTransports` when the close hung.
   - Verdict: correctness bug, unverified.

6. `src/cli/audio.ts:248`
   - Problem: the shared `execDetached` keeps 64 MB of stderr for every child. whisper-cli kept 8 KB and listing and measure kept 1 MB. Past the cap it trims stderr from the front on each chunk, where `execFile`'s `maxBuffer` failed the run. A capture whose astats output passes 64 MB loses its earliest frames, and `parseAstats` yields wrong or missing seconds and a false `capture-incomplete`. Each chunk past the cap also costs a 64 MB slice.
   - Fix: pass a per-caller keep size to `execDetached`.
   - Verdict: correctness bug, unverified.

7. `src/cli/audio.ts:355`
   - Problem: `checkFfmpeg` and the capture callback at line 398 re-implement the ENOENT, stderr tail and `exitHow` mapping that `ffmpegFailure` centralizes. A fix such as finding 4 has to land in three places.
   - Fix: use `ffmpegFailure(e, stderr, '-version', VERSION_TIMEOUT_MS).attach(...)` in `checkFfmpeg` and ``ffmpegFailure(e, stderr, `capturing from …`, timeoutMs)`` in the non-stopped branch of `capture`.
   - Verdict: cleanup, unverified.

8. `src/cli/main.ts:833`
   - Problem: `closeWithin` adds a third copy of the race-a-promise-against-a-cleared-timer pattern already in `setPttWithin` (radio.ts) and `fatal()` (main.ts), each with its own catch handling.
   - Fix: export a shared `within(promise, ms)` helper from core and use it in all three places.
   - Verdict: cleanup, unverified.

9. `src/cli/main.ts:1357`
   - Problem: `prepareOutDir` now requires `R_OK`, and the failure still reads "cannot write to <dir>" with the remedy "pass --out-dir with a writable directory". A directory with mode 0333 gets a misleading diagnosis.
   - Fix: say "cannot read or write <dir>" and ask for a readable and writable directory.
   - Verdict: cleanup, unverified.

10. `src/speech/speak.ts:290`
    - Problem: the local `stopped` flag is redundant. `keyWhile` calls `resolveStop` only after it starts `setPtt(false)`, which already sets `dropping`. The extra `stop.then` subscription adds a condition to `if (!stopped && !signalled && !dropping())` that never decides the outcome.
    - Fix: drop the flag and the subscription, and test `!signalled && !dropping()`.
    - Verdict: cleanup, unverified.
