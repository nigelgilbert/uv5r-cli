# Swarm report 1: review 1

Work file: `docs/review-1.md`. Branch `feature/speech-plan`, base 01b8ae5. Reviewer: GPT-6.1
Sol through the `codex` skill, exchange cap 3. Test command `npx vitest run`, typecheck
`npm run typecheck`.

Final state: 848 tests in 34 files pass (830 at the base). Typecheck is clean.

## Items

All 18 items landed. Shared files merged them into three agents: core, speak and main
(items 1, 2, 4 to 7, 9 to 12, 16, 18), the detached runner (items 3, 8, 14, 15, 17) and the
station tests (item 13).

### Items 1, 2, 4 to 7, 9 to 12, 16, 18

Commits 5fd8626, 29d6c30, 8a61021, 59d022b, 097a581. Tests: 839 pass on the agent branch.

- Item 1: the `setPttWithin` timeout throws `ptt-control-failed` with `timedOut: true`. A
  late assertion drops PTT again. `keyWhile` sets `lateAssert`, gives the unplug remedy and
  strips `timedOut` from the thrown detail. When the release also fails, "PTT assertion and
  release unconfirmed" keeps precedence.
- Item 2: `closeWithin` races `close()` against `PTT_CONTROL_TIMEOUT_MS` on both paths of
  `withTransport`. A close that rejects without timing out propagates as before.
- Item 4: `trackRelease` exposes `dropping()`; `identified` needs no signal and no drop.
- Item 5: `playFailed` is gone. Any `BaofengError` after the player starts gains the result
  fields.
- Item 6: a pre-key signal returns right after `measureWav`. `kept` is set only after the
  `--out` copy succeeds, so the early result names no unwritten file. The second `signalled`
  check before `resolveOutput` was redundant and is removed.
- Item 7: the watchdog check is `held.timedOut && !held.interrupted`.
- Item 9: `activeFlags` drives the `fatal()` format.
- Item 10: `prepareOutDir` checks `R_OK`.
- Item 11: the `say` text line prints `not asserted` when PTT never rose.
- Item 12: the stall cap is in README "Receive audio", the `hear` help rule, the `hear.ts`
  docstring and constant comment, and the SKILL.md Bash-timeout bullet. The 180 s default
  still covers the cap.
- Item 16: `wait` is exported from `radio.ts` and `src/core/index.ts`; the copy in
  `speak.ts` is gone.
- Item 18: the `parseArgs` docstring is rewrapped and the `deadlineStop` JSDoc removed.

Files: `src/core/{radio,index}.ts`, `src/cli/{main,args}.ts`, `src/speech/{speak,hear}.ts`,
`test/core/radio.test.ts`, `test/cli/{cli,hear-cli,say-cli}.test.ts`,
`test/speech/speak.test.ts`, README, SKILL.md.

### Items 3, 8, 14, 15, 17

Commits f5dada1, cf96da1, 9d3acc9, 483243d, 7977a5c. Tests: 832 pass on the agent branch.

- Item 8: `execDetached` and `STDERR_KEEP` (64 MiB) live in `src/cli/audio.ts`. The capture
  runs through `execDetached`. `test/cli/listen-cli.test.ts` mocks `spawn` as well, since its
  capture tests mocked only `execFile`.
- Item 3: a timeout sends SIGTERM, then SIGKILL after `KILL_GRACE_MS`.
- Item 14: `ffmpegFailure` holds the mapping, ENOENT included. `runFfmpeg` uses
  `execDetached`; `condition` and `measureWav` call it. `listOutputDevices` keeps its partial
  listing.
- Item 15: `transcribeWav` runs through `execDetached` and takes an optional `timeoutMs`. The
  stt stand-in script gains a `FAKE_WHISPER_SLEEP` branch for the timeout test. A whisper-cli
  timeout now sends SIGTERM before SIGKILL.
- Item 17: `play` casts to `ExecError | null`.

Files: `src/cli/audio.ts`, `src/speech/{output,tts,levels,stt}.ts`,
`test/cli/{audio,listen-cli}.test.ts`, `test/speech/{output,stt}.test.ts`.

### Item 13

Commit b62fb4e. Tests: 832 pass on the agent branch.

Two tests check the exact messages for `parseStation([])` and a `KJ7-ABC` callsign.

Files: `test/speech/station.test.ts`.

## Consensus findings fixed

One dispute exchange settled every disputed finding. Both models agreed that all 18 items
landed as written and that the implementers' deviations above are correct.

1. A close timeout left the process hung on the stuck port. `closeHung` is set on either
   path and the main block exits. Commit a5e23c8.
2. After a release and a hung close, the item 5 catch replaced the unplug remedy with the ID
   remedy. The ID remedy now skips `ptt-control-failed`. Commit fb78f15.
3. `listen` and `check` left ffmpeg running after Ctrl-C, since item 8 detached every
   capture. `execDetached` takes `detached`; `capture` detaches only with `stop`. Commit
   828b0c1.
4. No test covered the `dropping()` guard. A watchdog test with no signal now does. Commit
   f15341a.
5. The `transcribeWav` docstring tied the timeout to the segment. Commit 4e336da.
6. README lacked the timed-out assertion and hung-close unplug cases. Commit 4502e3e.

## Unreviewed fixes

The six fixes above. Tests: 848 pass after the merge.

## Findings dropped

- `execDetached` accepts exit 0 after a timeout SIGTERM. Sol raised it and withdrew it: the
  branch predates this run and matches `execFile`.

## Disagreements

None.

## Open items

Verified on the bench by the orchestrator on 2026-10-25, closed:

- `models.sha256` reports OK for `ggml-base.en-q5_1.bin` and `ggml-silero-v6.2.0.bin`.
- The audiotoolbox listing exits 0 and `parseDeviceList` parses all six devices.
  `pickOutput(devices, 'AIOC Audio')` returns index 0 with UID suffix `:1`; the AIOC input is
  index 1 with `:2`. Both are named "AIOC Audio".
- The listing sends one frame of silence to the default output.
- The avfoundation listing shows `[2] AIOC Audio` among the audio inputs.
- whisper.cpp at `~/Desktop/bench/whisper.cpp` is tag v1.9.5, commit d1be6fd, matching the
  README pin. `whisper-cli` is at `build/bin/whisper-cli` on the human's login PATH.
- `transcribeWav` with the `whisperArgs` argv exited 0 on a 16 kHz mono WAV. The `-oj` file
  had the `transcription[].text` shape, and the JSON was deleted afterwards.
- Model load time: 274 ms wall per segment, load included. One process per segment holds up.

Still open, all bench work:

- Step 5: the phase 1 bench session runs the operator loop over the air, then bench item 7.
- Step 3: the first bench transmission.
- Bench items 1 to 7 of the plan.
- `say -- TEXT` and the exit on an unknown voice.
- The conditioning chain with `alimiter` at its defaults.
- `astats reset=0` accumulates the sample count.
- `playTo` start latency, tail truncation and level.
- The noise phrase list, which needs recorded traffic from the air.
- Ctrl-C reaching the detached children, and reaching the `listen` and `check` ffmpeg now in
  the uv5r process group.
- Segment timing against bench item 4.
- `say --rehearse` keeps default signal handling because `afplay` is not detached.
