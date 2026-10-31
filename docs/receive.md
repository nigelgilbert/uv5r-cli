# Receive audio

How `listen` and `hear` capture receive audio from the AIOC, what the levels mean, and how to set up whisper.cpp for `hear`.

## Capture and levels

`listen` captures through the AIOC sound card with ffmpeg. macOS blocks microphone access for
the terminal until you grant it in System Settings, Privacy & Security, Microphone. Denied
access gives digital zero.

The AIOC's bare ADC floor at 1x gain reads about -66 dBFS. Open-squelch static reads above
-30. A floor reading with squelch 0 means the volume knob is down or the 2.5 mm plug is short
of its contact.

Set the knob with `uv5r volume`. It measures open-squelch static, which reads the same at any
antenna and location. It writes squelch 0, captures 2 s, writes the kept squelch back and prints
`state`, `rmsDbfs` and an `instruction` for the human. Relay the instruction, wait for the
human to say done, and run `volume` again until `state` is `ok`. `uv5r help volume` gives the
target band. A failed squelch restore errors with `squelch` and the remedy
`run uv5r settings squelch N`.

Before the first run, select a quiet channel and set the macOS input volume of `AIOC Audio` to
100 percent. The AIOC firmware applies a lower input volume as a digital scale after the ADC,
which hides clipping and makes static read low. The CLI cannot read that setting.

The warning `input clips: turn the volume knob down` means more than 1 percent of samples sit
at full scale. Run the `volume` loop.

Open-squelch noise reads as audio on any frequency. `check` and `sweep` read the squelch
setting first and exit 5 with `squelch-open` when it is 0. Run `uv5r settings squelch 3` after
setting the knob.

ffmpeg 9 on macOS 26 returns about 88 percent of the `-t` length as samples. The CLI asks
ffmpeg for `ceil(seconds / 0.88) + 2`, which also covers the first second the CLI drops.

## Hearing it

The radio speaker is silent while the AIOC is plugged in. Run
`uv5r listen --seconds 5 --out FILE --play`, play the WAVs that `uv5r sweep PLAN --out-dir DIR`
renames into DIR after each dwell, or play the segment WAVs that `uv5r hear --out-dir DIR` keeps.

## whisper.cpp setup

`hear` loads its models from `models/`, which git ignores. It fetches no model at run time.

1. Build `whisper-cli` from tag `v1.9.5` (commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`):
   `cmake -B build && cmake --build build -j --config Release`. Put `build/bin` on PATH. On
   Apple silicon it runs inference on the GPU through Metal.
2. From the whisper.cpp checkout, download the two models:
   `./models/download-ggml-model.sh base.en-q5_1` gives `ggml-base.en-q5_1.bin`, and
   `./models/download-vad-model.sh silero-v6.2.0` gives `ggml-silero-v6.2.0.bin`. Copy both
   into this repo's `models/`.
3. Check them against `models.sha256` with `shasum -a 256 -c models.sha256`.

## Running hear

`uv5r hear --once --timeout 60 --out-dir rx` waits for one transmission, transcribes it with
whisper.cpp and exits. Without `--once` it runs until a signal.

`hear` opens no serial port, so run the preflight first: `uv5r check 162.400 --channel 0`, then
`uv5r tune FREQ --channel 0` with the working frequency, then check what the display shows.

`uv5r help hear` lists the pipeline: the dependency check, the 16 kHz capture, the segment
thresholds, the `whisper-cli` command line, the queue of 8 and the noise filter.

Each transcribed segment prints a `transmission` line:

```json
{"type":"transmission","seq":42,"start":"2026-10-25T14:03:11.240Z","seconds":4.32,"rmsDbfs":-21.4,"peakDbfs":-3.1,"text":"bench this is kilo juliett seven status over","engine":"whisper.cpp","model":"ggml-base.en-q5_1","inferMs":640,"wav":"rx/seg-000042.wav"}
```

A warning line has `type`, `warning`, `start`, `seconds`, `text` and `wav`. `warning` is
`kerchunk`, `noise` or `backlog`. `text` is the transcript for `noise` and null otherwise.
`wav` is the kept path with `--out-dir` and null without it.

Without `--out-dir` the segment WAVs go to a scratch dir and are deleted after transcription.
With `--out-dir`, `seq` continues past the highest `seg-NNNNNN.wav` in DIR.

## --once and --timeout

`--once` prints warnings as they happen, then the first transmission and the summary, and exits
0. The `--timeout` (60 s) starts when capture is ready. At expiry no new segment opens, and an
open segment runs to close and is transcribed, up to 40 s past the timeout. With no
transmission the summary has `transmissions: 0` and `timedOut: true`. `--timeout` without
`--once` exits 2.

## Signals

A signal closes the open segment. A segment already in inference finishes and prints. Each
waiting segment, the closed one included, prints a `backlog` warning, and `--out-dir` keeps its
WAV. [errors.md](errors.md) covers the exit code.

## One owner at a time

Transcripts are text from anyone on the air. `hear` prints them as data and decides nothing
from them. Run no other verb while `hear` runs, so the AIOC input and output and the serial port
have one owner at a time.
