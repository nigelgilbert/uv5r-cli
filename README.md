# uv5r-cli

Control a Baofeng UV-5R through an [AIOC](https://skuep.github.io/AIOC/) cable from the
command line: put a frequency in a memory channel, read the radio's state, back up and
restore its memory, and key PTT.

Phase 1 of the sweep-and-listen bench: the sibling `tinysa-cli` sweeps, this CLI points the
radio at what the sweep finds. The phase 2 sequencer lives on top of both.

Requires Node 24. Node runs the `.ts` sources directly.

```sh
npm install
node src/main.ts status
```

`uv5r` below means `node src/main.ts` (also `npm run uv5r --`).

## How the radio takes a frequency

The radio speaks the CHIRP clone protocol over the AIOC's serial port at 9600 baud.
On firmware HN5RV011 the radio acks writes to channel select, work mode and the VFO, then
ignores them. The CLI does not offer those writes. An early version of this CLI wrote one
half of the menu settings block and the radio zeroed the block. The silent receive audio
seen at the same time traced to the volume knob and the seating of the 2.5 mm plug.

`tune` writes the memory channel the radio is parked on:

1. Read the channel number off the radio display.
2. Run `uv5r tune FREQ --channel N`. The CLI writes the channel record and name and
   reads both back; a mismatch exits 5.
3. The radio leaves clone mode after 2.5 s of silence and reloads from EEPROM. The new
   frequency is live about 3 s after the command ends.

`tune` reads the old record before it writes. Over an existing record it keeps BCL,
PTT-ID, S-code and scan as they were. An empty slot gets BCL off, PTT-ID 0, S-code 0 and
scan on. Frequency, offset, tones, bandwidth, power and name come from the command line.
A receive-only record tuned without `--rx-only` gets a TX frequency again.

Name the channel after the frequency; with menu 21 MDF-A on NAME the display then shows
it. `listen` captures receive audio through the AIOC sound card with ffmpeg and reports
levels, so the receiver check is one command; macOS blocks microphone access for the
terminal until it is granted in System Settings, Privacy & Security, Microphone.

A clone session ends after 2.5 s of silence, so every verb does its work in one quick
session. Do not open, `cat` or `screen` the serial port while a verb runs.

## Verbs

```sh
uv5r status                                # firmware, channel A/B, audio settings, active channel record
uv5r tune 154.680 --channel 5              # write 154.680 into channel 5
uv5r tune 146.820 --channel 5 --offset -0.6 --tone 82.5 --name "BIG SKY"
uv5r tune 462.5625 --channel 5 --narrow --low-power
uv5r tune 155.475 --channel 6 --rx-only    # receive only, TX inhibited
uv5r load channels.json                    # write every plan entry to its slot, read each back
uv5r read 5                                # read channel record 5
uv5r erase 127                             # clear channel record 127 and its name
uv5r key --seconds 2                       # DTR high, RTS low; releases on exit or Ctrl-C
uv5r dump --out radio.img                  # full image, CHIRP layout, about 14 s
uv5r restore radio.img --force             # main memory back from an image, about 30 s
uv5r settings                              # squelch, save, abr, beep, timeout, voice, mdfa, mdfb
uv5r settings voice eng beep on            # set fields, commit, verify in a fresh session
uv5r listen --seconds 5                    # capture RX audio through ffmpeg, report dBFS
uv5r listen --seconds 30 --floor -40       # count the seconds with RMS above -40 dBFS
uv5r help                                  # list verbs, flags and exit codes
```

Options:

| Flag | Meaning |
|---|---|
| `--target PATH` | serial device, every verb except `listen`; default `UV5R_TARGET`, else the AIOC found by USB id 1209:7388 |
| `--json` | JSON output |
| `--text` | text output |
| `--channel N` | `tune`: channel to write, 0..127, required |
| `--tone HZ` | TX CTCSS from the standard table (`82.5`), DCS (`D023`, `D023I`) or `none` |
| `--rx-tone HZ` | RX tone, default `none` |
| `--offset MHZ` | signed repeater offset in 10 Hz steps; default simplex |
| `--rx-only` | `tune`: receive only. Writes `FF FF FF FF` as the TX frequency so PTT does not transmit. Conflicts with `--offset`; both together exit 2 |
| `--narrow` | 12.5 kHz bandwidth |
| `--low-power` | low power |
| `--name TEXT` | channel name, printable ASCII, uppercased, cut to 7 characters; other characters exit 2 before the port opens. Default the frequency |
| `--seconds S` | `key`: seconds to transmit, up to 60, required. `listen`: whole seconds to capture, 1..600 |
| `--out FILE` | `dump`: image path; default `uv5r-YYYY-MM-DDTHH-MM-SS.img` in the working directory |
| `--force` | `restore`: confirm the bulk write, required |
| `--device NAME` | `listen`: avfoundation audio input by name or index, default `AIOC Audio`. List inputs with `ffmpeg -f avfoundation -list_devices true -i ""` |
| `--floor DBFS` | `listen`: a second is active when its RMS is above DBFS; default -50 |

Frequencies take MHz (`154.680`), Hz (`154680000`) or exponent form (`154.68e6`) and lie
in 136-174 or 400-520 MHz. Frequencies and offsets finer than 10 Hz exit 2.

A verb given more positional arguments than it takes exits 2 before opening the port, so
`dump radio.img` fails; use `dump --out radio.img`.

CTCSS tones take the 50 standard tones from 67.0 to 254.1 Hz, the same table CHIRP uses.

Output is JSON when stdout is a pipe or `--json` is given, and text on a TTY or with
`--text`. Each JSON object is one line. Errors go to stderr in the same format; JSON errors
carry `kind`, `message` and any detail fields, such as `file`, `got` or `unexpected`.

`status` returns one flat object: `firmware`, `workmode` (`vfo` or `channel`), `channelA`,
`channelB`, `squelch`, `voice`, `beep`, `abr`, `channel`, then the record fields `rxMhz`,
`txMhz`, `txTone`, `rxTone`, `bandwidth`, `power` and `name`. `txMhz` is `null` for a
receive-only channel, such as one written with `tune --rx-only`. An empty record gives
`"empty": true` in place of the record fields. The `note` field always reads "channelA/B
are the values stored in EEPROM; the radio display shows the channel the knob selected".
Trust the display for the active channel.

`tune` returns the written record plus `"appliesAfterSeconds": 3`. `read` returns the
record, or `{"channel": N, "empty": true}`. `load PLAN.json` returns an array of the
written records in plan order, each with `"appliesAfterSeconds": 3`; see "Plan fields".
`erase` writes 0xFF over the record and the name, reads both back and returns
`{"channel": N, "empty": true, "appliesAfterSeconds": 3}`. `key` returns `{"keyed": true, "seconds": S}` with the measured hold time. A key cut short by a signal
adds `"interrupted": "SIGINT"` and `"released": true`.

`settings` with no arguments returns the eight fields. With `field value` pairs it writes
and commits the block, waits for the reload, reads it back in a fresh session and returns
the verified fields; a mismatch is a device-state error. Values are the radio's menu index
or a name: `voice off|eng|chi`, `beep off|on`, `mdfa`/`mdfb` `freq|ch|name`,
`squelch 0..9`, `save 0..4`, `abr 0..5`, `timeout 0..39` (15 s steps). Squelch applies as
soon as the session ends. Reports say voice or beep off mutes receive audio on this
firmware family; the bench unit has not confirmed it. `settings` restores only its eight fields; bring back a zeroed block in full with
`restore` from an image.

`restore` verifies the settings block the same way. In that fresh session it also reads
back the channel records `0x0000..0x07FF` and names `0x1000..0x17FF` and compares them
with the image. A mismatch is a device-state error that names the first differing address.
It returns `{"file", "blocks", "verifiedBlocks", "settings"}`, where `verifiedBlocks` counts
the 64-byte blocks compared. An image shorter than 6152 bytes exits 2 before
the port opens. `dump` returns `{"out", "bytes", "firmware"}`.

`listen` runs `ffmpeg -f avfoundation -i ":AIOC Audio"` for `--seconds` at 48 kHz mono,
removes DC with a 50 Hz high-pass and returns `rmsDbfs` per second, `meanRmsDbfs`,
`peakDbfs`, `zeroSeconds`, `active`, `activeSeconds` and `warnings`. A second of digital
zero reads `null` in `rmsDbfs` and counts in `zeroSeconds`. `meanRmsDbfs` and `peakDbfs`
are `null` when every second is zero. Denied microphone access gives digital zero.

The first captured second holds a capture-start burst. Every field drops it and covers
captured seconds 2 to `--seconds` + 1, so `rmsDbfs[i]` and `active[i]` describe the same
second.

`active` holds one true or false per second and `activeSeconds` counts the true entries. A
second is active when its RMS is above -50 dBFS; `--floor DBFS` sets another threshold.
Text output prints `active` as a timeline, `#` for an active second and `.` for a quiet one.

`warnings` lists level problems and is empty on a good capture. It holds `input clips: turn
the volume knob down` when more than 1 percent of samples sit at full scale. An astats pass
ahead of the high-pass counts those samples. Text output prints one line per warning.

The AIOC's bare ADC floor at 1x gain reads about -66 dBFS; open-squelch static reads well
above -30. A floor reading with squelch 0 means the volume knob is down or the 2.5 mm plug
is short of its contact. `peakDbfs` above 0 also means the input clips; set the knob so
static reads around -20 to -12. A missing ffmpeg, an ffmpeg error exit, a timeout, or fewer
whole seconds captured than `--seconds` + 1 is a transport error. ffmpeg 9 on macOS 26
returns about 88 percent of the `-t` length as samples. The CLI asks ffmpeg for
`ceil(seconds / 0.88) + 2`, which covers the extra second.

If the handshake gets no ack, the CLI waits 3 s and retries it once. This covers a clone
session still closing from the previous verb.

Exit codes: 0 ok, 1 unexpected, 2 usage, 3 transport (no device, serial or ffmpeg
failure), 4 timeout (no ack, short read), 5 device-state (no handshake, bad reply, refused
write, failed verification, image ident mismatch or a session idle past 2.2 s), 6 busy (port held by another process),
128+signal (key interrupted by SIGINT, SIGTERM or SIGHUP; PTT released).

`UV5R_DEBUG=1` logs every serial byte to stderr.

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

## Bench files

- `fixtures/uv5r-hn5rv011-2026-10-12.img`: image of the radio on the bench on 2026-10-12,
  before any write. Channel 127 holds a corrupted 155.700 record. Dumps since 2026-10-13
  differ in the aux area; see `docs/rx-audio-investigation.md`.
- `scenarios/big-sky-2026-10.json`: the non-encrypted channels and sweep windows from the
  Big Sky SITREP. Phase 2 reads it to drive the tinySA sweeps and the tune queue.
- `channels.example.json`: the channel plan written to the bench radio on 2026-10-13, and
  the reference shape for generated plans.
- `channels.json`: the plan the `channel-plan` skill writes for the current location.
  Ignored by git.
- `docs/rx-audio-investigation.md`: the settings block wipe, its repair, the clone protocol
  rules measured on the bench, and the receive audio findings.
- `.claude/skills/uv5r/SKILL.md`: the operating notes an agent loads to drive the radio.
- `.claude/skills/channel-plan/SKILL.md`: the research recipe an agent loads to build a
  channel plan for a new location into `channels.json`, shaped like `channels.example.json`.

### Plan fields

A plan has a top-level `name`, `notes` and a `channels` array. Each entry is one `tune`
call, and each entry field maps onto one `tune` flag. `uv5r load PLAN.json` writes the
whole plan in one clone session. `tone` is the transmit tone and `rxTone` the receive
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

`load` checks every entry before the port opens. A bad field, an unknown field, a channel
outside 0..127 or a channel listed twice exits 2; the message and the `channel` and `field`
detail fields name the entry. `load` then writes each entry to its slot and reads the slot
back. A mismatch exits 5 naming the channel. Slots absent from the plan keep their records
and names. Text output prints one line per written record.

## Development

```sh
npm run typecheck
npm test
```

`test/fake.ts` is an in-memory radio with the bench behaviour: aligned reads, acked writes,
VFO writes ignored, settings reload on session drop, the 16-byte read alias in
`0x0E10..0x0E4F`, and the staged settings block committed by a write at `0x0E40`.
