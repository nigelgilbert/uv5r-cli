---
name: uv5r
description: Operate the Baofeng UV-5R on the bench through the `uv5r` CLI and the AIOC cable, with JSON output. Use when the user mentions the Baofeng, the UV-5R, the AIOC, tuning or keying the radio, a memory channel, loading a channel plan, CTCSS or DCS tones, repeater offsets, PTT, backing up the radio, menu settings, voice or beep, squelch, listening to receive audio, or audio levels.
---

# uv5r

`tune` writes a frequency into the memory channel given by `--channel`. The radio applies
it about 3 s after the command ends.

Run commands from the repo root. `uv5r` below means `node src/main.ts`.

## Operating rules

- Do not open, `cat`, `screen` or `stty` the serial port.
- Run one verb at a time.
- Start every task with `uv5r status`.
- Exit 2 means bad input. Read `message` and fix the command.
- Exit 3 means a transport error. Read `kind` and `message` before choosing a remedy.
  - No AIOC found or no device at the path: ask the human to reseat the cable, or pass
    `--target`.
  - Serial error: ask the human to reseat the cable.
  - ffmpeg missing from PATH: run `brew install ffmpeg`.
  - ffmpeg failed or timed out: read `message` and check `--device`.
  - Short capture: retry `listen` once, then check the AIOC audio device is listed.
- Exit 4 means a timeout: no ack or a short read. Retry the verb once, then ask the human
  to check the radio is on.
- Exit 5 means the radio did not answer, gave a bad reply, refused a write, failed
  verification, or holds a different ident than the image. Read `message` and the detail
  fields first. Check the input, such as the image file, before asking the human to check
  the radio is on and the cable is seated.
- Exit 6 means the port is busy. Another process such as CHIRP or a terminal holds it. Ask
  the human to close it.
- To change what the radio is parked on, ask the human once per session to read the
  channel number off the display. Call it N and pass `--channel N`.
- Writing a plan or any other slot uses that slot's own number.
- Write a plan file with one `uv5r load PLAN.json`. Exit 2 names the channel and field to
  fix in the plan. Exit 5 names the channel that did not take the write.
- Write public-safety listening channels with `--rx-only`.
- Trust the display for the active channel. `status` channelA and channelB come from
  EEPROM and may differ from it.
- Run verbs back to back. The CLI retries the handshake once.
- Output is JSON when piped. `--json` is optional.
- `key` transmits on whatever the radio is tuned to. Key only when the human asked and the
  frequency is one they may transmit on.

## Verbs

```sh
uv5r status
uv5r tune 154.680 --channel 5
uv5r tune 146.820 --channel 5 --offset -0.6 --tone 82.5 --name "BIG SKY"
uv5r tune 462.5625 --channel 5 --narrow --low-power
uv5r tune 154.695 --channel 7 --narrow --rx-only --name "SHERIFF"
uv5r load channels.json
uv5r read 5
uv5r erase 127
uv5r key --seconds 2
uv5r dump --out radio.img
uv5r restore radio.img --force
uv5r settings
uv5r settings voice eng beep on
uv5r listen --seconds 5
uv5r listen --seconds 5 --floor -40
```

`status` reports `squelch`, `voice`, `beep` and `abr`. Reports say `voice off` or `beep off`
mutes receive audio on this firmware family; set them back with `settings` before chasing
audio elsewhere. `listen` reports dBFS from the AIOC. The bare AIOC floor at 1x gain reads about
-66; open-squelch static reads well above -30. A floor reading with squelch 0 means the
volume knob is down or the 2.5 mm plug is short of its contact. `peakDbfs` above 0 means
the knob is too high and the input clips; aim for static around -20 to -12. Seconds of digital zero come back as `null`
in `rmsDbfs` and count in `zeroSeconds`. Denied microphone permission for the terminal is
one cause.

`listen` drops the first captured second, which holds a capture-start burst, from every
field. `active` lists one true or false per second, aligned with `rmsDbfs`, and
`activeSeconds` counts the true entries. A second is active when its RMS is above -50 dBFS.
`--floor DBFS` sets another threshold. `warnings` holds
`input clips: turn the volume knob down` when more than 1 percent of samples sit at full
scale. Ask the human to turn the knob down, then listen again.

Frequencies in MHz, 136-174 or 400-520. Tones: `82.5`, `D023`, `D023I`, `none`.
`scenarios/big-sky-2026-10.json` holds the Big Sky channel list and sweep windows.
