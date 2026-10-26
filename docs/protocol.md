# Protocol notes

How the CLI talks to the radio over the AIOC serial port, which magics and idents it knows, and how `identify` finds a radio that does not answer.

## How the radio takes a frequency

The radio speaks the CHIRP clone protocol over the AIOC's serial port at 9600 baud. On firmware
HN5RV011 the radio acks writes to channel select, work mode and the VFO, then ignores them. The
CLI offers none of those writes, so you select the channel on the radio.

A clone session ends after 2.5 s of silence. The radio then reloads from EEPROM and the new
frequency is live about 3 s after the command ends. When the handshake gets no ack, the CLI waits
3 s and retries it once, which covers a session still closing from the previous verb.

A radio verb runs one or more short clone sessions. `sweep` runs one per write. `settings` with
pairs and `restore` add a verification session. `key`, `say`, `id` and `hear` open no session.
The receiver is deaf during a clone session. Back-to-back verbs take about 3 s longer for the
handshake retry.

Name the channel after the frequency. With menu 21 MDF-A on NAME the display then shows it.

`settings` writes its eight fields and leaves the rest of the block alone. Bring back a zeroed
settings block in full with `uv5r restore IMAGE --force` from an image. On post-291 firmware the
ident encodes the band limits, so a restore after a band-limit change exits 5 with
`image-incompatible`. Dump again first.

## UV5R_MAGIC

`UV5R_MAGIC=NAME` opens every clone session with another classic magic: `291`, the default,
`ORIG`, `UV82`, `A58` or `UV5G`. An unknown or unsupported name exits 2 before the port opens.
`key`, `say`, `id`, `listen`, `hear` and `help` ignore it.

`status` and `dump` report the `magic` that answered and the radio `family`. `family` reads
`unknown` when the magic and firmware string do not settle it.

## When the radio does not answer

Run `uv5r identify` with no `UV5R_MAGIC` prefix when `status` exits 5 with `session-unavailable`
and the radio is on with the cable seated. It tries each classic magic, then five foreign magics
at 9600, then two UV17Pro magics at 115200. In text mode it prints one line per attempt with the
baud on stderr.

Put the `pin` line it prints before every later `uv5r` command, as in
`UV5R_MAGIC=ORIG uv5r status`. `pin` is `null` when the verbs already open with the magic that
answered. Keep the `UV5R_MAGIC` setting identify ran with.

These exit 5 with `radio-unsupported` naming the radio:

- an F11, UV6 or UV6_ORIG answer;
- a BF-A58, which shows as a `BFT515` or `BFT517` version under A58;
- a 14-byte ident, which names a UV-5X3-type radio speaking another protocol;
- an answer to a foreign magic or a 115200 magic.

A 115200 answer adds `powerCycle: true`. The radio stays in program mode until you power-cycle it.

## Bench measurements

Measured on a UV-5R with firmware HN5RV011, ident `aa 30 76 04 00 05 20 dd`, AIOC 1209:7388.

- Handshake: magic `50 bb ff 20 12 07 25` one byte at a time, ack `06`, `02` returns the 8 byte
  ident, `06` returns `06`. Then read `0x1E80` (discarded), `0x1EC0` (firmware string at offset
  48) and `0x1FC0` (dropped-byte flag at offset 15), as CHIRP does.
- Reads: `S addr16 len`; reply `X addr16 len data`, then send `06`. Reads of the second and later
  blocks start with an `06` from the radio. The radio serves 16 byte aligned blocks and echoes
  the requested address in the header.
- Writes: `X addr16 len data` in one burst, 16 bytes, aligned; reply `06`. Every write is acked.
  Writes land in channel memory and names. Writes to the VFO region at `0x0F08..0x0F3F` and the
  channel selection at `0x0E4C`, `0x0E76..0x0E77` are ignored.
- Settings block `0x0E20..0x0E3F`: 16-byte writes at `0x0E20` and `0x0E30` go into a 32-byte
  staging buffer that starts zero-filled each session. A 16-byte write at `0x0E40` commits the
  buffer to EEPROM. A lone write at `0x0E20`, `0x0E30`, a 32-byte write at `0x0E20` or a 64-byte
  write at `0x0E00` is acked and dropped. Writing one half and then `0x0E40` commits zeros over
  the other half. `restore` writes the page in order, so it commits. `settings` writes both
  halves then `0x0E40` unchanged. `Session.writeBlock` refuses a write at `0x0E40` with exit 2
  unless both halves were acked since the last commit, handshake or failed write, and takes one
  aligned 16-byte block below `0x2000` per write.
- Reads of `0x0E00..0x0E7F` during a session return the values the radio loaded at its last
  reload. A 16-byte read at `0x0E10`, `0x0E20`, `0x0E30` or `0x0E40` returns the `0x0E40`
  record. `radio.ts` reads the settings block and the state record as 64-byte pages. The page
  still holds the reload snapshot, so a settings write reads back unchanged until the next
  session.
- After a reload the settings page reads back the written channel A/B value while the display
  shows the knob channel.
- The session drops after 2.5 s without a command. A second handshake inside a live session
  fails; wait for the drop.
- Memory layout is the CHIRP `uv5r.py` layout with image offsets minus 8: channels at
  `0x0000 + 16n`, names at `0x1000 + 16n`, settings at `0x0E20`, work mode at `0x0E4C`, display
  line bit 7 of `0x0E4A`, channel A/B at `0x0E76`/`0x0E77`, VFO A/B at `0x0F08`/`0x0F28`.
- PTT on the AIOC is DTR high with RTS low. Opening the port raises DTR, so the transport drops
  both lines before anything else.

## Ident

- On firmware BFB291 and later the 8-byte ident holds the band limits in BCD. Byte 1 is the VHF
  lower limit minus 100 MHz, byte 2 the VHF upper limit minus 100 MHz, bytes 3-4 the second-band
  lower limit and bytes 5-6 its upper limit. The bench ident reads 130-176 MHz and 400-520 MHz.
- Byte 3 equal to `02` marks a 220-260 MHz second band. `flags.band220` reports it on radios that
  are not orig.
- Orig radios, before BFB291, spell the version in ASCII: `aa 42 46 42 32 33 31 dd` reads
  `BFB231`.
- Different models return identical idents. `family` comes from the magic that answered and the
  firmware string at `0x1EF0`.

## Classic magics

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

## Foreign radios

A reply to one of these magics at 9600 names a radio with its own protocol and memory layout.

| Bytes | Radio |
|---|---|
| `50 0d 0c 20 16 03 28` | BTECH UV-5X3 |
| `50 0d 0c 20 17 09 19` | MTC UV-5R-3 |
| `50 bb ff 20 14 11 22` | UV-6R |
| `50 bb ff 20 12 05 25` | UV-9G |
| `50 bb dd 55 63 98 4d` | Baojie BJ-UV55 |

Radios sold as UV-5RH, UV-5RM Plus or UV-5R Mini speak the UV17Pro protocol at 115200. Each
model group answers its 16-byte ASCII magic, sent in one write, with one `06`.

| Magic | Model group |
|---|---|
| `PROGRAMBFNORMALU` | UV-17Pro, UV-21ProV2, UV-25, 5RM, P15, MT-5RM, K5-Plus, UV-5RM Plus, UV-17R-Plus, UV-5RH |
| `PROGRAMCOLORPROU` | UV-17ProGPS, GM-21, GM-30 Plus/Pro, UV-32, UV-21ProGPS, UV-28Plus, UV-5R Mini |

## identify timing

| Phase | Attempts | Each silent attempt | Pause after each |
|---|---|---|---|
| Classic magics at 9600 | 13, each supported magic twice | 1.27 s | 3 s after the first attempt, none after the rest |
| Foreign magics at 9600 | 5 | 1.27 s | none |
| UV17Pro magics at 115200 | 2 | 1.2 s | 1 s, none after the last |

A silent radio takes about 29 s: 20 s for the classic magics, 6 s for the foreign magics and 3 s
at 115200. A wrong ack to the first magic pauses 3 s before its second attempt. Other wrong acks
pause 2 s. An invalid ident or a refused closing `06` pauses 3 s before the next magic.
