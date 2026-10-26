# Swarm report 0: speech plan

Work file: `docs/speech-plan.md`. Branch `feature/speech-plan`, base 18ebb23. Reviewer: GPT-6.1
Sol through the `codex` skill, exchange cap 3. Test command `npx vitest run`, typecheck
`npm run typecheck`.

Final state: 830 tests in 34 files pass (601 in 20 at the base). Typecheck is clean.

## Items

The five steps of "Order of work" are the items. Steps 1 to 4 landed. Step 5 is a bench
session and stays open. Step 4 ran as two agents: the monitor and segmenter touch only new
files, so they ran beside step 2.

### Step 1: `keyWhile`, SIGTSTP, fatal-error release, `--` in `parseArgs`

Commit d5b62bd. Tests: 618 pass.

- `keyWhile(t, body, { maxMs }, signals)` in `src/core/radio.ts`. `body` gets a `stop`
  promise. On a signal or `maxMs` it drops PTT, resolves `stop` and waits up to 2 s for the
  body. The first failure wins. `HoldResult` gains `timedOut`. `holdPtt` wraps it.
- `KEY_SIGNALS` gains SIGTSTP. `signalExitCode('SIGTSTP')` gives 146 on macOS and 148 on Linux.
- `fatal(err)` in `src/cli/main.ts` lowers PTT on every open transport on an uncaught error
  and exits 1. The port opens with `hupcl: true`.
- `parseArgs` treats everything after the first `--` as positional. `test/core/fake.ts`
  gains `pttLog`.
- Docs: README signals paragraph, `ERROR_GUIDANCE`, `EXIT_CODES['128+signal']`, SKILL.md
  signals bullet.

Files: `src/core/{radio,index,transport}.ts`, `src/cli/{args,exit,sweep,main}.ts`,
`test/core/{fake,radio.test,transport.test}.ts`,
`test/cli/{key,sweep,args,cli,parse}.test.ts`, README, SKILL.md.

### Step 2: config loader and phonetic table

Commit 0ce5cde. Tests: 649 pass on the agent branch.

- `src/speech/station.ts`: `Station` and `parseStation`. Unknown keys are ignored. A key of
  the wrong type exits 2 `invalid-argument`.
- `src/speech/phonetic.ts`: the plan's table, `phonetic()` and `idSentence()`.
- `src/cli/config.ts`: `resolveConfigPath` (`--config`, `UV5R_CONFIG`, repo `uv5r.json`) and
  `readStation`.
- `uv5r.example.json`. `.gitignore` gains `uv5r.json`, `models/` and `rx/`.
- `test/core/imports.test.ts` scans `src/speech` and `test/speech`.
- Docs: README Bench files and Development.

### Step 3: transmit path, `say`, `id`, `say --rehearse`

Commit 5e2f3c3. Tests: 757 pass.

- `src/speech/{tts,levels,output,speak}.ts`. `speakUtterance` runs the plan's transmit
  steps 1 to 8 with every check before the port opens.
- `SpeechDeps` is injected through `cli(argv, open, deps)`. It adds `condition` and `play`
  to the plan's list so tests run no ffmpeg or afplay.
- `src/core/errors.ts` gains the five reasons. `UsageError` takes an optional reason. The
  error count goes from nineteen to twenty-four.
- `src/cli/audio.ts` factors out the astats filter and an ffmpeg runner.
- `say --clear` uses the step 4 monitor and `frameLevels`.
- `identified` is true when the player exits 0, since the ID ends the WAV.
- Docs: README intro, verb table, clone-session, `key`, signals and `UV5R_MAGIC`
  paragraphs, the new "Transmit audio" and "Station config" sections; help `RULES.transmit`
  and `RULES.station`; SKILL.md description, transmit and control-operator bullets.

Files: the four speech modules, `src/core/{errors,index}.ts`, `src/cli/{audio,main}.ts`,
`test/speech/{fakes,speak.test,levels.test,output.test}.ts`,
`test/cli/{say-cli,id-cli,cli,parse,audio}.test.ts`, `test/core/errors.test.ts`, README,
SKILL.md.

The first bench transmission is open.

### Step 4: monitor, segmenter, `hear` with `whisper-cli`

Commits dde84d8 (monitor and segmenter, 645 tests on the agent branch) and efb2785 (`hear`,
807 tests).

- `src/speech/monitor.ts`: `FrameAccumulator`, `startMonitor` with the plan's ffmpeg argv,
  and a 50-frame first-second drop.
- `src/speech/segment.ts`: a pure `Segmenter` with the plan's open, close, pre-roll,
  post-pad, kerchunk and 30 s split values. Kerchunk length is measured on the active span.
- `src/speech/stt.ts`: the whisper-cli argv and JSON parser. whisper-cli runs detached.
- `src/speech/hear.ts`: `runHear` with the queue of 8, the noise list, `--once`,
  `--timeout` and the summary.
- `src/speech/wav.ts`: a WAV writer.
- `help.ts` gains the `lines` array.
- `models.sha256` carries both hashes, read from the Hugging Face LFS pointers.
- README pins whisper.cpp v1.9.5 (d1be6fd), read from the GitHub releases API.
- Docs: README Receive audio, Bench files, signals and NDJSON; help `RULES.hear`,
  `OUTPUT_RULE` and `ERROR_GUIDANCE`; SKILL.md transcript, preflight, operator loop and
  Bash timeout bullets.

Changes from the brief:

- `SpeechDeps.transcriber` builds `transcribe` after checking the model files and whisper-cli.
- Model paths are absolute.
- An empty prompt drops `--prompt`.
- `hear` takes `--json` and no `--target`.
- `seq` continues past the highest kept WAV in `--out-dir`.

## Consensus findings fixed

Review 1 diffed 18ebb23..efb2785. It took one exchange with Sol to settle the disputed
findings. All 13 findings are low severity.

| # | Finding | Fix commit |
|---|---|---|
| 1 | Player and capture ffmpeg get terminal signals | 7ee9064 (player, say, conditioning, listing), 1d30f61 (monitor), 791fb62 (measureWav) |
| 2 | A pre-key SIGTSTP keys on a stale clear check | 7ee9064 |
| 3 | `hear --once` drops a split remainder after the deadline | 1d30f61 |
| 4 | `idOwed` set when no audio went out | 7ee9064 |
| 5 | PTT assert and release awaits unbounded | 7ee9064 (3 s bound) |
| 6 | The fatal handler hides a failed release | 7ee9064 |
| 7 | A signal discards the open receive segment | 1d30f61, 791fb62 (README) |
| 8 | Transcription failures after a signal swallowed | 1d30f61 |
| 9 | `--timeout` needs frames to arrive | 1d30f61 |
| 10 | No end-to-end "say with no config" test | 7ee9064 |
| 11 | NDJSON wording leaves out the terminal case | 1d30f61 |
| 12 | Two README sentences announce what follows | 7ee9064 |
| 13 | Two test comments with no verb | 7ee9064, 1d30f61 |

791fb62 also wires `deps.defaultConfig` into `hear`.

Review 2 ran on 18ebb23..791fb62 before the skill changed to a single review. It took one
exchange. It confirmed fixes 6 to 13 as correct and complete. It found gaps in fixes 1, 2, 4
and 5, listed under Open items. Exchanges run: 2, one per review.

## Unreviewed fixes

None. Review 2 covered 7ee9064, 1d30f61 and 791fb62.

## Findings dropped

- Review 2, Sol S7: the docstrings on the `TX` and `KERCHUNK` test constants. Sol withdrew
  it because `/** */` docstrings match the codebase.
- Review 1, Sol's kerchunk-duration finding on `src/speech/segment.ts:157`. Sol withdrew it
  because every emitted segment carries at least 0.75 s of padding.
- Review 1, finding 10 was first tagged as a user-config guard. Both models then agreed it is
  a test the plan names. No finding was dropped as "user decision: batteries included".

## Disagreements

- A second Ctrl-C leaves `hear` waiting on whisper-cli, which runs up to 120 s. Opus rates
  it low and wants a second signal to kill whisper-cli. Sol says the plan requires finishing
  inference and names no override.
- The `hear --once` stall guard stops capture at `--timeout` + 40 s even while frames
  arrive. Sol (medium) wants a frame-inactivity watchdog, because the plan says an open
  segment runs to close. Opus (low) keeps the guard as the only bound on squelch 0, inside
  the SKILL.md Bash timeout. The middle path documents the cap in README and help.

## Open items

Review 2 consensus findings, unfixed:

1. Medium. `withTransport` cleanup at `src/cli/main.ts:833` awaits an unbounded `close()`
   after the 3 s release timeout, and `SerialTransport.close` at `src/core/transport.ts:133`
   awaits an unbounded `setPtt(false)` and `port.close`. Bound release and close with
   `PTT_CONTROL_TIMEOUT_MS`, then propagate the original error.
2. Low. `setPttWithin` at `src/core/radio.ts:651` does not cancel a timed-out assert. Send
   one more `setPtt(false)` once the late assert settles.
3. Low. `src/speech/speak.ts:305` sets `identified` for a player that exits 0 inside the
   release window. Set it only when neither the stop nor a signal came first.
4. Low. `src/speech/speak.ts:318` leaves `idOwed`, `playedSeconds`, `pttAsserted` and
   `released` off a `ptt-control-failed` error after a signal mid-play. Attach them whenever
   playback started.
5. Low. `execDetached` at `src/speech/output.ts:27` sends SIGTERM at its timeout and never
   SIGKILL. Escalate after `KILL_GRACE_MS`.
6. Low. `speakText` at `src/cli/main.ts:1108` prints "asserted for 0 s" for a result with
   `pttAsserted: false`. Build the line from `pttAsserted` and `released`, and add a test.
7. Low. `src/speech/speak.ts:225-271` runs conditioning, the `--out` copy, measurement and
   validation after a pre-key signal. An exit 2 or 3 can then replace the interrupted
   result. Check for a signal after each pre-key await.

The two disagreements above.

Bench, from the plan and the agents' checks:

- Step 5: the phase 1 bench session runs the operator loop over the air, then bench item 7.
- Step 3: the first bench transmission.
- Bench items 1 to 7 of the plan, unrun.
- The audiotoolbox device-list format is parsed as `[N] name, UID` and the parser has never
  seen real output.
- The listing command sends one frame of silence to the default output.
- Confirm both AIOC entries are named "AIOC Audio".
- `say -- TEXT` and the exit on an unknown voice.
- The conditioning chain, with `alimiter` at its defaults.
- That `astats reset=0` accumulates the sample count.
- `playTo` start latency, tail truncation and level.
- The whisper-cli argv and the `transcription[].text` JSON shape.
- Confirm or replace the whisper.cpp v1.9.5 pin.
- Check `models.sha256` against downloaded files.
- Calibrate the noise phrase list.
- Measure model load time against inference.
- Ctrl-C reaching the detached children.
- Segment timing against bench item 4.
- `say --rehearse` keeps default signal handling because `afplay` is not detached. It
  never keys PTT.
