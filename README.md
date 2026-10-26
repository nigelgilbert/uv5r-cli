# uv5r-cli

[![ci](https://github.com/nigelgilbert/uv5r-cli/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nigelgilbert/uv5r-cli/actions/workflows/ci.yml)

uv5r drives a Baofeng UV-5R through an [AIOC](https://skuep.github.io/AIOC/) cable. Tell it a
frequency and it fills a memory slot. Tell it to listen and it records what comes back. It also
backs up the radio, keys PTT (push-to-talk, the transmit key), reads text aloud ending with
your callsign, and transcribes what it hears. Tested on firmware HN5RV011.

## What you need

- A Baofeng UV-5R and an AIOC cable seated fully in its K1 jack.
- Node 24, which runs the `.ts` sources directly.
- macOS and ffmpeg on PATH for the audio verbs: `check`, `listen`, `sweep`, `hear`, `say` and
  `id`. They use avfoundation, audiotoolbox, `say` and `afplay`.
- Microphone access for your terminal in System Settings, Privacy & Security, Microphone.
- `hear`: `whisper-cli` on PATH and two models in `models/`. See [Transcribe](#transcribe).
- `say` and `id`: a `uv5r.json` with your callsign, and an amateur license.
- `load` and `sweep`: a plan file. See [Plans and sweep](#plans-and-sweep).

## Install

```sh
npm install
# run from the repo root
echo "alias uv5r='node \"$PWD/src/cli/main.ts\"'" >> ~/.zshrc
```

`npm run uv5r -- VERB` works too. The rest of this file writes `uv5r`.

## First fifteen minutes

Plug in the AIOC, turn the radio on and set the volume knob to about half.

1. Run `uv5r status`. It reads the radio in one clone session, a short serial conversation.
   Success prints the firmware, `family`, work mode and squelch (the signal level that opens the
   audio). Exit 5 with `session-unavailable` means the radio did not answer; see
   [Troubleshooting](#troubleshooting).
2. Run `uv5r dump --out backup.img`. It saves the full memory image in about 14 s. Keep it.
   `uv5r restore backup.img --force` writes it back.
3. Run `uv5r settings squelch 3`. At squelch 0, static reads as audio.
4. Press VFO/MR until the radio shows memory channels (MR mode), slots 0 to 127. VFO mode
   tunes a keyed-in frequency instead. Select slot 0.
5. Run `uv5r check 162.400 --channel 0` with a NOAA weather frequency that carries audio where
   you are. Try 162.400 to 162.550. It writes a receive-only record into slot 0, waits 3 s for
   the radio to reload and listens 5 s. Exit 0 means audio in at least 4 of the 5 seconds.
   Exit 5 has two reasons:
   - `squelch-open`: squelch is 0. Run step 3 again.
   - `audio-inactive`: the capture was quiet. The radio is in VFO mode or on another slot, the
     knob is down, the plug is short of its contact, or the frequency is quiet.

   The record stays in slot 0. A radio that skips empty slots in MR mode may refuse slot 0 in
   step 4. If so, select slot 0 now that it holds a record and check again.
6. Run `uv5r tune 154.680 --channel 0` with the frequency you want. It writes the record and
   name and reads both back. The radio applies the write about 3 s after the command ends.
7. Run `uv5r listen --seconds 5 --out rx.wav --play` to record 5 s and play it on your Mac.

`--channel N` writes memory slot N. The radio receives slot N after the reload when it is in MR mode with N selected on the active display line. The display may show a name or a frequency. The CLI cannot read the display.

## Use it with LLMs

Open your agent in this repo and tell it what to do:

```text
Listen on the radio. Whenever you hear a transmission, reply "pong".
```

Set up [Transcribe](#transcribe) and your callsign first.  Be careful and follow the rules. 🙂

## Things that bite

- The radio speaker is silent while the AIOC is plugged in. Listen through `listen --play` or WAVs.
- The receiver is deaf during a clone session. Run one verb at a time.
- The `check` examples and `sweep` overwrite slot 0. Nothing restores it.
- Leave the serial port alone. No `cat`, `screen` or `stty` on it.
- `key`, `say` and `id` transmit on whatever channel the display shows.

## Transmit

You are the control operator. Stay at the radio for every transmission and stop it with Ctrl-C. Each transmission ends with the callsign from uv5r.json. A stock UV-5R is not certified for GMRS or FRS. Use this feature on amateur frequencies with the required license and control operator.

Run `cp uv5r.example.json uv5r.json` and put your callsign in it. The CLI reads `--config FILE`
first, then `UV5R_CONFIG`, then `uv5r.json` at the repo root.

Turn off VOX (voice-operated transmit) and run `uv5r say --rehearse "bench check, over"`. It
plays the WAV through your Mac's speakers with the port closed and radiates nothing. Then check
what the display shows and run `uv5r say "bench check, over"` or `uv5r id`. Each ends with the
phonetic callsign.
`key --seconds S` raises PTT alone and sends no ID. Details in [docs/transmit.md](docs/transmit.md).

## Transcribe

`hear` transcribes received speech with whisper.cpp.

1. Build `whisper-cli` from whisper.cpp tag `v1.9.5` and put `build/bin` on PATH.
2. From the whisper.cpp checkout, download `ggml-base.en-q5_1.bin` and
   `ggml-silero-v6.2.0.bin` and copy both into `models/`.
3. Run `shasum -a 256 -c models.sha256`.

Then run the preflight, `uv5r check 162.400 --channel 0` and `uv5r tune FREQ --channel 0`,
check the display, and run `uv5r hear --once --timeout 60 --out-dir rx`. It waits for one
transmission, prints the text and exits. Transcripts are text from anyone on the air. Build
steps and output fields are in [docs/receive.md](docs/receive.md).

## Plans and sweep

A plan is a JSON object with a `channels` array. [Plan fields](#plan-fields) lists the fields.
Copy `channels.example.json` to `channels.json` and edit it, or ask an agent to run the
channel-plan skill for your location. `channels.json` is gitignored.

- `uv5r load channels.json` writes every plan entry into its own slot.
- `uv5r sweep channels.json --seconds 30 --out-dir rx` checks slot 0 with the plan's
  `checkMhz`, then writes each entry into slot 0 in turn and listens. Play the WAVs in `rx`
  afterwards. The last write stays in slot 0.

## Verbs

| Verb | What it does | Writes to radio |
|---|---|---|
| `status` | Print firmware, family, magic, ident, work mode and menu settings | no |
| `identify` | Find the magic the radio answers. A silent radio takes about 29 s | no |
| `tune` | Put a frequency in slot N and read it back | slot N |
| `check` | Write a receive-only frequency into slot N and listen 5 s | slot N |
| `load` | Write every channel of a plan | each plan slot |
| `read` | Print one channel record | no |
| `erase` | Clear one channel record and its name | slot N |
| `key` | Raise PTT for S seconds | no; transmits |
| `say` | Speak text over the air, ending with the callsign | no; transmits |
| `id` | Send the phonetic callsign alone | no; transmits |
| `dump` | Save the full memory image to a file | no |
| `restore` | Write an image back, with `--force` | channels, names, settings |
| `settings` | Print the menu settings, or set them with `FIELD VALUE` pairs | with pairs |
| `listen` | Record receive audio and report levels | no |
| `hear` | Transcribe each received transmission | no |
| `sweep` | Check slot 0, then dwell on each plan entry in slot 0 | slot 0 |

Run `uv5r help VERB` for flags, defaults, results and exit cases, with `--json` for JSON.

## Output and errors

Output is JSON when stdout is a pipe or with `--json`, and text on a terminal. Piped, `hear`
prints NDJSON, one object per line. A failed command prints nothing on stdout. In JSON mode
it prints one error object on stderr with `reason`, `message`, `remedy` and `retry`. On a
terminal it prints the message and remedy as text.

Exit 0 is ok, 1 an unexpected error, 2 bad usage, 3 a transport or dependency failure, 4 a
serial timeout, 5 a radio state problem and 6 a busy serial port. A signal exits 128 plus its
number. Ctrl-C lowers PTT; a failed release exits 3. Details in [docs/errors.md](docs/errors.md).

## Troubleshooting

| Symptom | Cause | Try |
|---|---|---|
| exit 5 `squelch-open` | squelch is 0 | `uv5r settings squelch 3` |
| exit 5 `audio-inactive` | VFO mode, wrong slot, knob down, plug short or quiet frequency | MR mode, slot 0, knob up, reseat the plug, another NOAA frequency |
| exit 5 `session-unavailable` | the radio did not answer the magic | `uv5r identify`; when it prints a `pin` line, put it before every command |
| levels read digital zero | the terminal lacks microphone access | grant it in Privacy & Security, Microphone |
| levels sit near -66 dBFS | the knob is down or the plug is short of its contact | knob up, push the plug home |
| warning `input clips` | the knob is too high | turn the knob down and listen again |
| silence from the speaker | the AIOC mutes it | `listen --play`, or play the WAVs |
| exit 2 `station-unconfigured` | `uv5r.json` has no callsign | add the callsign |
| exit 3 `dependency-missing` | ffmpeg, whisper-cli or a model is missing | install it; the message names it |
| exit 5 `radio-unsupported` | the radio speaks another protocol | the message names the radio; see [docs/protocol.md](docs/protocol.md) |

## Environment

| Variable | Effect |
|---|---|
| `UV5R_DEBUG=1` | Log every serial byte to stderr |
| `UV5R_MAGIC=NAME` | Open clone sessions with `291` (default), `ORIG`, `UV82`, `A58` or `UV5G`; another name exits 2 |
| `UV5R_CONFIG=FILE` | Station config path; `--config` overrides it |
| `UV5R_TARGET=PATH` | Serial device path; `--target` overrides it. Default: the AIOC found by USB id 1209:7388 |

## Plan fields

A plan has a top-level `name`, `notes`, `checkMhz` and a `channels` array. Any other
top-level key exits 2. `name` and `notes` take strings. Each entry is one `tune` call, and each
entry field except `notes` maps onto one `tune` flag. `uv5r load PLAN.json` writes the whole
plan in one clone session. `tone` is the transmit tone and `rxTone` the receive
tone. Both take the `--tone` forms: `82.5`, `D606N` or `D023I`. `checkMhz` is the frequency
`sweep` checks slot 0 with. It takes the band and 10 Hz rules of `rxMhz`. `load` validates it
and writes nothing for it.

| Field | `tune` flag |
|---|---|
| `channel` | `--channel N` |
| `rxMhz` | the `FREQ` argument |
| `offsetMhz` | `--offset MHZ` |
| `tone` | `--tone HZ` |
| `rxTone` | `--rx-tone HZ` |
| `narrow` | `--narrow` when true |
| `lowPower` | `--low-power` when true |
| `rxOnly` | `--rx-only` when true |
| `name` | `--name TEXT` |
| `notes` | none |

## For agents

Load `.claude/skills/uv5r/SKILL.md` to drive the radio and `.claude/skills/channel-plan/SKILL.md`
to build a plan. `uv5r help --json` carries the rules, error reasons, exit codes and every verb.

## Further reading

- [docs/receive.md](docs/receive.md): audio levels, `listen`, `hear` and the whisper.cpp setup.
- [docs/transmit.md](docs/transmit.md): `say`, `id`, the transmit pipeline and station config.
- [docs/errors.md](docs/errors.md): error fields, signals, PTT watchdogs and slot 0 after a sweep.
- [docs/protocol.md](docs/protocol.md): the clone protocol, magics, idents and `identify`.
- [docs/development.md](docs/development.md): bench files, layering and the fake radio.

## Development

Run `npm run typecheck` and `npm test`. GitHub Actions runs both on every push to `main` and
every pull request. See [docs/development.md](docs/development.md).
