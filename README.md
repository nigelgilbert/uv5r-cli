# uv5r-cli

[![ci](https://github.com/nigelgilbert/uv5r-cli/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nigelgilbert/uv5r-cli/actions/workflows/ci.yml)

Control a Baofeng UV-5R through an [AIOC](https://skuep.github.io/AIOC/) cable from the
command line: put a frequency in a memory channel, read the radio's state, back up and
restore its memory, listen to receive audio, key PTT, speak text over the air ending
with the station callsign, and transcribe received speech.

Phase 1 of the sweep-and-listen bench: the sibling `tinysa-cli` sweeps, this CLI points the
radio at what the sweep finds. The phase 2 sequencer lives on top of both.

## Quickstart

Requires Node 24, which runs the `.ts` sources directly. `uv5r` below means
`node src/cli/main.ts`, also `npm run uv5r --`.

```sh
npm install
node src/cli/main.ts status
```

1. Ask the human to set MR mode with the VFO/MR key and select slot 0.
2. Run `uv5r check 162.400 --channel 0` once per session with a NOAA weather frequency that
   carries audio at the location. Exit 0 means audio above the floor after writing slot 0,
   consistent with the radio receiving slot 0. Exit 5 lists the causes: VFO mode, another
   slot selected, volume knob down, plug unseated, quiet frequency. Ask the human to set MR
   mode and select slot 0, then check again.
3. Run `uv5r tune 154.680 --channel 0`. The CLI writes the record and name and reads both
   back. The radio applies the write about 3 s after the command ends.
4. Run `uv5r sweep channels.json --seconds 30 --out-dir rx`. It checks slot 0 with
   the plan's `checkMhz`, then writes each plan entry into slot 0 with its own TX setting
   and listens. The human plays the WAVs in `rx` after the run. Each WAV holds a full
   dwell; a dwell cut short by a signal or a failed capture leaves no WAV.

**Channel rule.** `--channel N` writes memory slot N. The radio receives slot N after the reload when it is in MR mode with N selected on the active display line. The display may show a name or a frequency. The CLI cannot read the display, so ask the human when it matters which channel the radio is on.

Slot 0 is the scratch slot. `check` examples use slot 0 and `sweep` writes only slot 0.
`tune` and `load` write any slot. Once the `check` write succeeds, the slot keeps the
receive-only record, also after a capture failure. A failure before or during the write
leaves the slot state unknown. After `sweep`, slot 0 keeps the last write and the summary's
`slot0` names it: `{channel, name}` of the last verified entry write, `{channel: null, name}`
after only the check write, or `null` when unknown. Nothing restores slot 0. Run
`uv5r load PLAN.json` to put a plan in its own slots.

The radio speaker is silent while the AIOC is plugged in. The human hears receive audio only
through `uv5r listen --seconds 5 --out FILE --play`, by playing the WAVs that
`uv5r sweep PLAN --out-dir DIR` renames each capture into DIR after its dwell, or by playing
the segment WAVs `uv5r hear --out-dir DIR` keeps.

A radio verb runs one or more short clone sessions. `sweep` runs one per write, `settings`
with pairs and `restore` add a verification session, and `key`, `say`, `id` and `hear` open
no session. The receiver is deaf during a clone session. Back-to-back verbs take about 3 s
longer for the handshake retry. Run one verb at a time. Do not open, `cat`, `screen` or
`stty` the serial port.

`key`, `say` and `id` raise PTT on the channel the radio display shows. The CLI cannot read
that channel, and a receive-only slot radiates nothing. Key only when the human asked and the
frequency is one they may transmit on, after asking the human what the display shows.

## Verbs

| Verb | Writes to radio | Time | Result keys |
|---|---|---|---|
| `status` | no | one clone session | `firmware`, `firmwareHex`, `family`, `magic`, `ident`, `workmode`, `squelch`, `voice`, `beep`, `abr` |
| `identify` | no | one clone session when the first magic answers; about 29 s on a silent radio | `magic`, `ident`, `firmware`, `firmwareHex`, `family`, `flags`, `droppedByte`, `pin` |
| `tune` | record and name of slot N | one clone session | `channel`, record keys, `appliesAfterSeconds` |
| `check` | receive-only record and name of slot N | one clone session, 3 s reload, 5 s listen | `slot`, `requestedMhz`, `listen` keys |
| `load` | record and name of each plan slot | one clone session | array of `tune` results |
| `read` | no | one clone session | `channel`, record keys; `empty` for an empty slot; `malformed` and `raw`, the record bytes as hex, for a record whose frequency bytes are not valid BCD |
| `erase` | 0xFF over the record and name of slot N | one clone session | `channel`, `empty`, `appliesAfterSeconds` |
| `key` | no; raises PTT | `--seconds` | `pttAsserted`, `seconds`, `released`; `interrupted` on a signal |
| `say` | no; raises PTT | synthesis, then the padded WAV plus `--tail` | `text`, `spoken`, `identified`, `seconds`, `peakDbfs`, `rmsDbfs`, `device`, `pttAsserted`, `released`; `interrupted` and `idOwed` on a signal |
| `id` | no; raises PTT | about 5 s | the `say` keys with `spoken` set to the phonetic callsign |
| `dump` | no; writes the image file | about 14 s | `out`, `bytes`, `firmware`, `family`, `magic` |
| `restore` | channels, names and settings from the image. On post-291 firmware the ident encodes the band limits, so a restore after a band-limit change exits 5 with `image-incompatible`; dump again first | about 30 s | `file`, `blocks`, `verifiedBlocks`, `settings` |
| `settings` | the menu settings block, only with `FIELD VALUE` pairs | one clone session; with pairs, two and the 3 s reload | `squelch`, `save`, `abr`, `beep`, `timeout`, `voice`, `mdfa`, `mdfb` |
| `listen` | no; opens no serial port | `--seconds` | `device`, `seconds`, `rmsDbfs`, `zeroSeconds`, `meanRmsDbfs`, `peakDbfs`, `active`, `activeSeconds`, `warnings`, `out` |
| `hear` | no; opens no serial port | until a signal; with `--once`, until the first transmission or `--timeout` | one `transmission` line per segment, a `warning` line per kerchunk, noise or backlog segment, then a `summary` line: `transmissions`, `seconds`, `device`, `warnings` (count); `interrupted`; `timedOut` with `--once` |
| `sweep` | slot 0, once for the check and once per entry | the check, then the dwell plus about 3 s per entry | `swept`, `seconds`, `device`, `active`, `warnings`, `slot0`; `interrupted` on a signal |

Record keys are `rxMhz`, `txMhz`, `txTone`, `rxTone`, `bandwidth`, `power` and `name`.
Run `uv5r help VERB` for a verb's flags, defaults, effects, preconditions, result example and
the exit cases it adds to the table in `uv5r help`, and `uv5r help VERB --json` for the same
as JSON.

Output is JSON when stdout is a pipe or with `--json`, and text on a terminal. `hear` prints
NDJSON: one object per line, each with `type` set to `transmission`, `warning` or `summary`.
In JSON mode a failed command prints nothing on stdout and one error object on stderr. The
lines `hear` printed before a failure stay on stdout, and the error exits with its reason's
code. The object has `reason`, `message`, `remedy` and `retry`, and each detail field below
sits at its top level beside them. On a terminal it prints the message and a remedy line as text. Act on `reason`, `remedy`
and `retry`; `uv5r help --json` lists the reasons with their exit codes and the retry meanings under `errors`.
A `load` error from a plan entry write adds `slot`. A `sweep` error after the port is
requested adds `summary`, the sweep result so far. An error inside the sweep loop adds
`phase` (`check`, `entry` or `dwell`), `slot` (0), `channel` (the plan channel, `null`
during the check) and `requestedMhz` (the entry frequency, or the `checkMhz` frequency during
the check). `summary.slot0` says whether a write landed. A failed check also carries
the check result fields.

On SIGINT, SIGTERM, SIGHUP or SIGTSTP (Ctrl-Z) once `key`, `say`, `id` or `sweep` has opened
the port, the verb prints its result on stdout with `interrupted` and no error, and exits 128
plus the signal number. SIGTSTP exits 146 on macOS and 148 on Linux. A `say` or `id` result
after a signal adds `idOwed`; `true` means audio went out without the full ID, so identify by
voice or run `uv5r id`. A failed PTT release after the signal exits 3 with `interrupted` in
the error. On the same signals `hear` stops capture, lets the segment in inference finish and
print, prints the summary with `interrupted` and exits 128 plus the signal number. Other verbs
end on a signal with no output.
An uncaught error lowers PTT on any open port and exits 1.

`UV5R_DEBUG=1` logs every serial byte to stderr.

`UV5R_MAGIC=NAME` opens every clone session with another classic magic: `291`, the default,
`ORIG`, `UV82`, `A58` or `UV5G`. An unknown or unsupported name exits 2 before the port
opens. `key`, `say`, `id`, `listen`, `hear` and `help` ignore it. `status` and `dump` report the `magic` that
answered and the radio `family`, which reads `unknown` when the magic and firmware string
do not settle it.

Run `uv5r identify` with no `UV5R_MAGIC` prefix when `status` exits 5 with `session-unavailable`
and the human confirms the radio is on and the cable is seated. It tries each classic magic, then five foreign
magics at 9600, then two UV17Pro magics at 115200. In text mode it prints one line per
attempt with the baud on stderr. Put the `pin` line it prints before every later `uv5r`
command, as in `UV5R_MAGIC=ORIG uv5r status`. `pin` is `null` when the verbs already open with the magic that
answered; keep the `UV5R_MAGIC` setting identify ran with. An F11, UV6 or UV6_ORIG answer, a BF-A58 version under A58, or an answer to a foreign or 115200 magic,
exits 5 with `radio-unsupported` naming the radio. A 115200 answer adds `powerCycle: true`;
the radio stays in program mode until the human power-cycles it.

## How the radio takes a frequency

The radio speaks the CHIRP clone protocol over the AIOC's serial port at 9600 baud.
On firmware HN5RV011 the radio acks writes to channel select, work mode and the VFO, then
ignores them. The CLI does not offer those writes, so the human selects the channel. A clone
session ends after 2.5 s of silence. The radio then reloads from EEPROM and the new
frequency is live about 3 s after the command ends. When the handshake gets no ack, the CLI
waits 3 s and retries it once, which covers a session still closing from the previous verb.
A 14-byte ident names a UV-5X3-type radio, which speaks another protocol, and a `BFT515` or
`BFT517` version under A58 names a BF-A58. Either exits 5 with `radio-unsupported`.

Name the channel after the frequency; with menu 21 MDF-A on NAME the display then shows it.

`settings` writes only its eight fields. Bring back a zeroed settings block in full with
`restore` from an image.

## Receive audio

`listen` captures through the AIOC sound card with ffmpeg. macOS blocks microphone access
for the terminal until it is granted in System Settings, Privacy & Security, Microphone.
Denied access gives digital zero.

The AIOC's bare ADC floor at 1x gain reads about -66 dBFS; open-squelch static reads
above -30. A floor reading with squelch 0 means the volume knob is down or the 2.5 mm plug
is short of its contact. Set the knob so static reads around -20 to -12. The `input clips:
turn the volume knob down` warning means more than 1 percent of samples sit at full scale;
ask the human to turn the knob down, then listen again.

Open-squelch noise reads as audio on any frequency. `check` and `sweep` read the squelch
setting first and exit 5 with `squelch-open` when it is 0. Run `uv5r settings squelch 3`
after setting the knob.

ffmpeg 9 on macOS 26 returns about 88 percent of the `-t` length as samples. The CLI asks
ffmpeg for `ceil(seconds / 0.88) + 2`, which also covers the first second the CLI drops.

### Transcribe received speech

`uv5r hear --once --timeout 60 --out-dir rx` waits for one transmission, transcribes it with
whisper.cpp and exits. Without `--once` it runs until a signal. It opens no serial port, so
run the preflight first: `uv5r check 162.400 --channel 0`, then `uv5r tune FREQ --channel 0`
with the working frequency, then ask the human what the display shows.

1. Check the model, `models/ggml-silero-v6.2.0.bin` and `whisper-cli` on PATH. A missing one
   exits 3 with `dependency-missing` naming it.
2. Capture 16 kHz mono from `--device` through one long-running ffmpeg and drop the first
   second.
3. Segment on 20 ms frame RMS. A segment opens after 300 ms at `--floor` + 5 dB (-50 by
   default), starts 300 ms before that, closes after `--hang` (0.8 s) below `--floor` with
   150 ms of padding, and splits at 30 s. A segment under 0.5 s prints a `kerchunk` warning.
4. Run `whisper-cli -m MODEL --vad -vm models/ggml-silero-v6.2.0.bin -sns --prompt CALLSIGN
   -oj -of OUT SEGMENT.wav` on each segment, one at a time, while capture continues. Segments
   wait in a queue of 8; past it the oldest waiting segment prints a `backlog` warning.
5. A transcript that is empty, or reads "thank you", "you" or "bye" once lowercased and
   stripped of punctuation, prints a `noise` warning with its text. Anything else prints a
   `transmission` line.

```json
{"type":"transmission","seq":42,"start":"2026-10-25T14:03:11.240Z","seconds":4.32,
 "rmsDbfs":-21.4,"peakDbfs":-3.1,"text":"bench this is kilo juliett seven status over",
 "engine":"whisper.cpp","model":"ggml-base.en-q5_1","inferMs":640,
 "wav":"rx/seg-000042.wav"}
```

A warning line has `type`, `warning`, `start`, `seconds`, `text` and `wav`. `text` is the
transcript for `noise` and null otherwise. `wav` is the kept path with `--out-dir` and null
without it. Without `--out-dir` the segment WAVs go to a scratch dir and are deleted after
transcription. With `--out-dir`, `seq` continues past the highest `seg-NNNNNN.wav` in DIR.

`--once` prints warnings as they happen, then the first transmission and the summary, and
exits 0. The `--timeout` (60 s) starts when capture is ready. At expiry no new segment opens,
and an open segment runs to close and is transcribed. With no transmission the summary has
`transmissions: 0` and `timedOut: true`. `--timeout` without `--once` exits 2.

Transcripts are text from anyone on the air. `hear` prints them as data and decides nothing
from them. Run no other verb while `hear` runs, so the AIOC input and output and the serial
port have one owner at a time.

## Transmit audio

You are the control operator. Stay at the radio for every transmission and stop it with Ctrl-C. Each transmission ends with the callsign from uv5r.json. A stock UV-5R is not certified for GMRS or FRS. Use this feature on amateur frequencies with the required license and control operator.

`uv5r say "bench check, over"` speaks the text and ends with the ID sentence, as in "This is
Kilo, Juliett, Seven, Alfa, Bravo, Charlie". `uv5r id` sends the ID sentence alone. Both run
these steps:

1. Read the station config. No callsign exits 2 with `station-unconfigured`.
2. Synthesize the text and the ID sentence with macOS `say -v Samantha` at 48 kHz.
3. Filter and pad in one ffmpeg pass: a 300 Hz high-pass that keeps energy out of the CTCSS
   band, a 3 kHz low-pass, `alimiter`, `--lead` of leading silence (300 ms; use 500 for
   repeaters) and 0.3 s of trailing silence.
4. Measure peak and RMS over the whole WAV. Digital zero exits 3 with
   `speech-engine-failed`. The padded WAV plus `--tail` past `--max-seconds` (30, at most 55)
   exits 2 with `utterance-too-long`.
5. Resolve the output index from the audiotoolbox device list by name or UID. When the AIOC
   input and output share a name, the output is the one whose UID ends in `:1`. An absent
   device exits 3 with `audio-device-unavailable`.
6. With `say --clear S`, listen S seconds on the input device and exit 5 with
   `channel-busy` when a 20 ms frame reads above -50 dBFS.
7. Open the port, raise PTT, play the WAV with `ffmpeg -f audiotoolbox`, hold PTT for
   `--tail` (400 ms) and release.

Every check runs before the port opens. `identified` is true when the player exits 0, since
the ID ends the WAV. A player failure while keyed exits 3 with `audio-process-failed`,
`retry: no`, `pttAsserted`, `released`, `playedSeconds` and `idOwed`. A player that runs past
the padded WAV plus `--tail` plus 5 s loses PTT at the watchdog and exits 3 the same way.

`say --rehearse` runs steps 1 to 4, then plays the WAV through the system default output
with `afplay` and the port closed. With PTT low and VOX off it radiates nothing. Run it
before the first transmission of a session. `--out FILE` keeps the conditioned WAV.

The AIOC applies the macOS output volume of its device before the DAC, so the transmit
level follows that volume. The `--max-seconds` cap assumes the UV-5R default TOT of 60 s;
lower it on a radio set to a shorter TOT.

## Station config

`say` and `id` read the callsign from `uv5r.json` at the repo root. `uv5r.example.json`
shows the shape:

```json
{
  "callsign": "KJ7ABC",
  "outputDevice": "AIOC Audio",
  "inputDevice": "AIOC Audio",
  "model": "models/ggml-base.en-q5_1.bin"
}
```

`hear` reads `inputDevice`, `model` and `callsign` and runs without a config file. `model`
names the whisper.cpp model relative to the repo root, `models/ggml-base.en-q5_1.bin` by
default. The callsign is the whisper prompt; with no callsign the prompt is empty.

`--config FILE` names another file, then `UV5R_CONFIG`, then `uv5r.json`. A file named by
`--config` or `UV5R_CONFIG` has to exist. Unknown keys are ignored. A file that fails to
parse, or a key of the wrong type, exits 2 with `invalid-argument`. `callsign` takes letters
and digits. `outputDevice` sets the `--output` default and `inputDevice` the device
`say --clear` and `hear` listen on; both default to `AIOC Audio`.

## Protocol notes from the bench

Measured on a UV-5R with firmware HN5RV011, ident `aa 30 76 04 00 05 20 dd`, AIOC 1209:7388.

- Handshake: magic `50 bb ff 20 12 07 25` one byte at a time, ack `06`, `02` returns the 8
  byte ident, `06` returns `06`. Then read `0x1E80` (discarded), `0x1EC0` (firmware string at
  offset 48) and `0x1FC0` (dropped-byte flag at offset 15), as CHIRP does.
- Reads: `S addr16 len`; reply `X addr16 len data`, then send `06`. Reads of the second and
  later blocks start with an `06` from the radio. The radio serves 16 byte aligned blocks and
  echoes the requested address in the header.
- Writes: `X addr16 len data` in one burst, 16 bytes, aligned; reply `06`. Every write is
  acked. Writes land in channel memory and names. Writes to the VFO region at
  `0x0F08..0x0F3F` and the channel selection at `0x0E4C`, `0x0E76..0x0E77` are ignored.
- Settings block `0x0E20..0x0E3F`: 16-byte writes at `0x0E20` and `0x0E30` go into a
  32-byte staging buffer that starts zero-filled each session. A 16-byte write at `0x0E40`
  commits the buffer to EEPROM. A lone write at `0x0E20`, `0x0E30`, a 32-byte write at
  `0x0E20` or a 64-byte write at `0x0E00` is acked and dropped. Writing one half and then
  `0x0E40` commits zeros over the other half. `restore` writes the page in order, so it
  commits; `settings` writes both halves then `0x0E40` unchanged. `Session.writeBlock`
  refuses a write at `0x0E40` with exit 2 unless both halves were acked since the last
  commit, handshake or failed write, and takes one aligned 16-byte block below `0x2000`
  per write.
- Reads of `0x0E00..0x0E7F` during a session return the values the radio loaded at its
  last reload. A 16-byte read at `0x0E10`, `0x0E20`, `0x0E30` or `0x0E40` returns the
  `0x0E40` record. `radio.ts` reads the settings block and the state record as 64-byte
  pages. The page still holds the reload snapshot, so a settings write reads back unchanged
  until the next session.
- After a reload the settings page reads back the written channel A/B value while the
  display shows the knob channel.
- The session drops after 2.5 s without a command. A second handshake inside a live
  session fails; wait for the drop.
- Memory layout is the CHIRP `uv5r.py` layout with image offsets minus 8: channels at
  `0x0000 + 16n`, names at `0x1000 + 16n`, settings at `0x0E20`, work mode at `0x0E4C`,
  display line bit 7 of `0x0E4A`, channel A/B at `0x0E76`/`0x0E77`, VFO A/B at
  `0x0F08`/`0x0F28`.
- PTT on the AIOC is DTR high with RTS low. Opening the port raises DTR, so the transport
  drops both lines before anything else.

### Ident

- On firmware BFB291 and later the 8-byte ident holds the band limits in BCD. Byte 1 is the
  VHF lower limit minus 100 MHz, byte 2 the VHF upper limit minus 100 MHz, bytes 3-4 the
  second-band lower limit and bytes 5-6 its upper limit. The bench ident reads 130-176 MHz
  and 400-520 MHz.
- Byte 3 equal to `02` marks a 220-260 MHz second band. `flags.band220` reports it on radios
  that are not orig.
- Orig radios, before BFB291, spell the version in ASCII: `aa 42 46 42 32 33 31 dd` reads
  `BFB231`.
- Different models return identical idents. `family` comes from the magic that answered and
  the firmware string at `0x1EF0`.

### Classic magics

`identify` tries them in table order, with the magic `UV5R_MAGIC` names first.

| Name | Bytes | Answered by |
|---|---|---|
| `291` | `50 bb ff 20 12 07 25` | UV-5R, UV-5G Pro, UV-5RX3, GT-5R, KT-980HP, BF-F8HP; UV-S9X3 and 5RX of the WP970I family |
| `ORIG` | `50 bb ff 01 25 98 4d` | UV-5R, UV-5G Pro, UV-5RX3, GT-5R |
| `UV82` | `50 bb ff 20 13 01 05` | UV-82, UV-82X3, UV-82HP |
| `A58` | `50 bb ff 20 14 04 13` | BF-F8HP; WP970I and BF-A58 |
| `UV5G` | `50 bb ff 20 12 06 25` | Radioddity UV-5G |
| `F11` | `50 bb ff 13 a1 11 dd` | F-11 |
| `UV6` | `50 bb ff 20 12 08 23` | UV-6 |
| `UV6_ORIG` | `50 bb ff 12 03 98 4d` | UV-6 |

### Foreign radios

A reply to one of these magics at 9600 names a radio with its own protocol and memory
layout.

| Bytes | Radio |
|---|---|
| `50 0d 0c 20 16 03 28` | BTECH UV-5X3 |
| `50 0d 0c 20 17 09 19` | MTC UV-5R-3 |
| `50 bb ff 20 14 11 22` | UV-6R |
| `50 bb ff 20 12 05 25` | UV-9G |
| `50 bb dd 55 63 98 4d` | Baojie BJ-UV55 |

Radios sold as UV-5RH, UV-5RM Plus or UV-5R Mini speak the UV17Pro protocol at
115200. Each model group answers its 16-byte ASCII magic, sent in one write, with one `06`.

| Magic | Model group |
|---|---|
| `PROGRAMBFNORMALU` | UV-17Pro, UV-21ProV2, UV-25, 5RM, P15, MT-5RM, K5-Plus, UV-5RM Plus, UV-17R-Plus, UV-5RH |
| `PROGRAMCOLORPROU` | UV-17ProGPS, GM-21, GM-30 Plus/Pro, UV-32, UV-21ProGPS, UV-28Plus, UV-5R Mini |

### `identify` timing

| Phase | Attempts | Each silent attempt | Pause after each |
|---|---|---|---|
| Classic magics at 9600 | 13, each supported magic twice | 1.27 s | 3 s after the first attempt, none after the rest |
| Foreign magics at 9600 | 5 | 1.27 s | none |
| UV17Pro magics at 115200 | 2 | 1.2 s | 1 s, none after the last |

A silent radio takes about 29 s: 20 s for the classic magics, 6 s for the foreign magics
and 3 s at 115200. A wrong ack to the first magic pauses 3 s before its second attempt.
Other wrong acks pause 2 s. An invalid ident or a refused closing `06` pauses 3 s before
the next magic.

## Bench files

- `fixtures/golden/`: CHIRP images of the reference radios, `unit-<n>.img`. Slots 22-127
  of `unit-1.img` hold a 155.700 record behind an FF first byte and decode as empty.
  - `manifest.json`: each unit's ident, firmware, magic, aux hash and the slots its display
    showed.
  - `unit-<n>.json`: the decoded settings and all 128 slots, written by
    `test/core/golden.test.ts`.
- `scenarios/big-sky-2026-10.json`: test data, channels and sweep windows from the Big Sky
  SITREP. Nothing reads it.
- `channels.example.json`: the reference shape for generated plans.
- `channels.json`: the plan the `channel-plan` skill writes for the current location.
  Ignored by git.
- `uv5r.example.json`: the reference shape for the station config.
- `uv5r.json`: the station config with the callsign. Ignored by git.
- `models/`: the whisper.cpp models `hear` loads. Ignored by git. `hear` fetches no model at
  run time. Download `ggml-base.en-q5_1.bin` with `./models/download-ggml-model.sh base.en-q5_1`
  and `ggml-silero-v6.2.0.bin` with `./models/download-vad-model.sh silero-v6.2.0` from the
  whisper.cpp checkout, then copy both into `models/`.
- `models.sha256`: the SHA-256 of both models. Check them with `shasum -a 256 -c models.sha256`.
- whisper.cpp: build `whisper-cli` from tag `v1.9.5` (commit
  `d1be6fde11ac6e0407606b4e42fe72d34add8037`) with `cmake -B build && cmake --build build -j
  --config Release`, and put `build/bin` on PATH. On Apple silicon it runs inference on the
  GPU through Metal.
- `.claude/skills/uv5r/SKILL.md`: the operating rules an agent loads to drive the radio.
- `.claude/skills/channel-plan/SKILL.md`: the research recipe an agent loads to build a
  channel plan for a new location into `channels.json`, shaped like `channels.example.json`.

### Plan fields

A plan has a top-level `name`, `notes`, `checkMhz` and a `channels` array. Any other
top-level key exits 2. `name` and `notes` take strings. Each entry is
one `tune` call, and each entry field maps onto one `tune` flag. `uv5r load PLAN.json` writes
the whole plan in one clone session. `tone` is the transmit tone and `rxTone` the receive
tone. Both take the `--tone` forms: `82.5`, `D606N` or `D023I`.

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
| `checkMhz` | none; top level. `sweep` runs `check` on slot 0 with it. It takes the band and 10 Hz rules of `rxMhz`. `load` validates it and writes nothing for it |

## Development

```sh
npm run typecheck
npm test
```

GitHub Actions runs both commands on every push to `main` and every pull request.

`src/core/` talks to the radio: transport, protocol, codec, radio, plan and errors.
`src/cli/` parses arguments, prints and exits. `cli` imports `core` through
`src/core/index.ts`; `core` imports nothing from `cli`. `test/core/imports.test.ts` fails on
any import path under `src/core/` that contains `cli/`, and on any `core/` import from
`src/cli/` or `test/cli/` other than `src/core/index.ts` and `test/core/fake.ts`.

`src/speech/` holds the speech code. It imports `core` through `src/core/index.ts` and
nothing from `cli` but `src/cli/audio.ts`, and `test/core/imports.test.ts` checks
`src/speech/` and `test/speech/` for both rules.

`test/core/fake.ts` is an in-memory radio with the bench behaviour: aligned reads, acked writes,
VFO writes ignored, settings reload on session drop, the 16-byte read alias in
`0x0E10..0x0E4F`, and the staged settings block committed by a write at `0x0E40`.
