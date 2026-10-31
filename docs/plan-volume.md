# Plan: `uv5r volume`

A one-shot reading of open-squelch static that tells the human which way to turn the volume
knob. Issue [001](../issues/001-receive-level-calibration.md) holds the observations behind
it. Astra reviewed the first draft on 2026-10-31; its ten findings are folded in below.

## Why a verb

The knob is the only control over the level the AIOC ADC sees. The recipe in
[receive.md](receive.md) sets it against open-squelch static, which reads the same at any
antenna and location, so it works where NOAA does not reach. On the 2026-10-25 bench both
stations followed the recipe, landed static near -10 dBFS RMS, and live speech then peaked at
full scale and clipped. The band in the recipe sits too high. Speech RMS lands near static RMS
and speech peaks about 15 dB above its RMS.

An agent runs the verb and relays its sentence to the human. The agent reads output after the
command exits, so the verb takes one reading per call and the loop runs in the conversation:
run, relay, human turns the knob and says done, run again.

## Behaviour

`uv5r volume [--device NAME] [--target PATH] [--json]`

1. Run the ffmpeg check first, as `check` does.
2. Install the signal handlers before the port opens, through the `signals` dependency that
   `sweep` takes, and keep them until the restore in step 6 is done.
3. In one clone session read the settings and keep the squelch value. When it is 0, skip
   steps 4 and 6. Otherwise write squelch 0 with `writeSettings`.
4. Verify the write with `verifySettingsInFreshSession`. That call waits for the reload and
   reads the block back, so the capture can start as soon as it returns.
5. Capture `VOLUME_SECONDS` (2) with the stoppable capture `sweep` uses, at
   `DEFAULT_FLOOR_DBFS`. A signal stops the capture.
6. Write the kept squelch back in a fresh session and verify it the same way. Arm this step as
   soon as step 3 has the value, so it runs after a write that lost its ack, a capture error, a
   signal, or a verification failure in step 4.
7. Judge the capture and print one result. After a signal, print no result and exit 128 plus
   the signal number, as `sweep` does.

Steps 3, 4 and 6 open the serial port and step 5 opens the sound card. They run in sequence,
so the one-owner rule holds.

### States

Judged from the `ListenResult`. The rows apply in order, so the clip warning wins over every
RMS reading. Clipping is counted before the high-pass and RMS after it, and an input stuck at a
rail reads as clipped with a low RMS. `TARGET_LOW_DBFS` and `TARGET_HIGH_DBFS` are named
constants next to `VOLUME_SECONDS`, set to -28 and -22 until the measurement in "Setting the
band" replaces them.

| state | condition | instruction |
|---|---|---|
| `too-loud` | clip warning present | Turn the volume knob down about a half turn, then say done. |
| `silent` | mean RMS null, digital zero | The Mac is sending the radio tool silence. In System Settings, Privacy & Security, Microphone, allow the terminal, and check that AIOC Audio is not muted. Then say done. |
| `silent` | mean RMS under the floor | Turn the volume knob up a little. If it is already up, push the plug all the way in. Then say done. |
| `too-loud` | mean RMS more than 6 dB above `TARGET_HIGH_DBFS` | Turn the volume knob down about a quarter turn, then say done. |
| `too-loud` | mean RMS above `TARGET_HIGH_DBFS` | Turn the volume knob down a little, then say done. |
| `too-quiet` | mean RMS more than 6 dB below `TARGET_LOW_DBFS` | Turn the volume knob up about a quarter turn, then say done. |
| `too-quiet` | mean RMS below `TARGET_LOW_DBFS` | Turn the volume knob up a little, then say done. |
| `ok` | mean RMS inside the band | The volume knob is set. Leave it there. |

The turn sizes are estimates. The loop corrects them, and the measurement pass can tune the
6 dB step and the words.

### Result

```json
{"state":"too-loud","rmsDbfs":-10.4,"instruction":"Turn the volume knob down about a quarter turn, then say done."}
```

Three keys. `state` is for the agent's branching, `instruction` is relayed word for word, and
`rmsDbfs` is the mean RMS for bench logs and the measurement pass. The band lives in
`uv5r help volume`. The squelch restore is an effect, and a failed restore is an error.

Text mode prints `state`, `rms` and `instruction` on three lines in the `listen` layout.

### Exits

- 0 for every state. A knob that needs turning is the expected result.
- The existing mapping for everything else: 3 for transport, which covers serial I/O, a missing
  or failing ffmpeg and a short capture; 4 for a serial timeout; 5 for device state, which
  covers a refused write and a failed verification; 128 plus the signal after an interrupt.
- Any error raised after step 3, including one from the restore itself, carries `squelch` with
  the kept value and the remedy `run uv5r settings squelch N`. The error that caused the failure
  keeps its kind and exit code.

### Preconditions for the help text

- The radio is on a quiet channel. A carrier during the capture reads as the signal instead of
  static. Open squelch shows the human nothing on the display, so the agent names the channel
  the display shows before running.
- The macOS input volume of `AIOC Audio` is at 100 percent. The AIOC firmware applies a lower
  host input volume as a digital scale after the ADC, which hides clipping and makes static
  read low. The verb cannot read that setting.
- The AIOC is plugged in and macOS microphone access is granted, as `listen`.

## Setting the band

Before merging, run one pass on the bench with unit 1 and the handheld on 446.525, with the
`AIOC Audio` input volume at 100 percent:

1. At three knob positions, record `uv5r volume --json` for the static RMS.
2. At each position, have the second station transmit live speech close to the mic and
   capture it with `uv5r listen --seconds 10`. Record the peak.
3. Pick the band where speech peaks land between -12 and -6 dBFS, and set the two constants.
4. At the chosen position, have the second station run `say` with a sentence and capture it
   with `uv5r hear --once`. Record RMS, peak and the transcript. Do the same for NOAA on slot 0
   when it reaches the bench that day.
5. Note the rows in issue 001. Steps 2 to 4 answer its first open question. Step 4 leaves the
   second question, where the gap between live speech and `say` comes from, open.

## Files

- `src/cli/volume.ts`: `judgeVolume(heard: ListenResult): VolumeResult` as a pure function,
  and `readVolume(t, options)` that runs steps 2 to 6. Mirror [check.ts](../src/cli/check.ts)
  for the session and capture flow and [sweep.ts](../src/cli/sweep.ts) for the signal handlers.
- `src/cli/main.ts`: the `volume` entry in `verbs` with summary, effects, preconditions,
  `writesToRadio` (squelch, restored before exit), the example result and exits; `volumeVerb`.
- `test/cli/volume.test.ts`: every state row through `judgeVolume`, including a clip warning
  with low RMS and null RMS; the squelch write, verify and restore against `FakeRadio` with
  `listen` mocked, as `check.test.ts` does; restore after a mocked capture error, after a
  verification failure in step 4 and after a signal; no write when squelch is already 0; the
  `squelch` detail and remedy on a restore failure.
- `README.md`: verb table row and step 3 of the setup, which gains `uv5r volume` before
  `settings squelch 3`.
- `docs/receive.md`: replace the knob paragraph with the `volume` loop and the input volume
  precondition, and keep the floor and clip explanations.
- `docs/bench-two-station.md`: step 4 becomes `uv5r volume` until `ok`.
- `.claude/skills/uv5r/SKILL.md`: a line that runs `volume` at setup and on `input clips`,
  relaying `instruction` to the human and rerunning after they say done.
- `issues/001-receive-level-calibration.md`: add the measurement rows and the new band.

## Brief for the implementation agent

- Base commit `23c6ee8` on `main`. Branch `feature/volume-verb`. Reset the worktree to the base
  before editing.
- Keep decision logic out of the verb. It prints the state, the number and the sentence. Retries
  and relaying belong to the agent above it.
- Run `npm test` and `npm run lint` before each commit. End each commit with the session's
  co-author line.
- Leave the band constants at -28 and -22 and mark them in the help text as provisional until
  the bench pass sets them.

## Open items

- The macOS output volume of `AIOC Audio` on the sending station. It shapes the `say` level the
  other station hears and the CLI does not record it. Transmit side, separate issue.
- Where the level gap between live speech and `say` comes from. Issue 001's second question.
