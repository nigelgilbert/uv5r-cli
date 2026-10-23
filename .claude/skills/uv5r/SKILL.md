---
name: uv5r
description: Operate the Baofeng UV-5R on the bench through the `uv5r` CLI and the AIOC cable, with JSON output. Use when the user mentions the Baofeng, the UV-5R, the AIOC, tuning or keying the radio, a memory channel, MR or VFO mode, checking the live channel, loading or sweeping a channel plan, CTCSS or DCS tones, repeater offsets, PTT, backing up the radio, menu settings, voice or beep, squelch, listening to receive audio, or audio levels.
---

# uv5r

Run commands from the repo root. `uv5r` means `node src/main.ts`.

## Find help

- `uv5r help` lists the verbs, the operating rules and the exit codes.
- `uv5r help VERB` prints a verb's flags, defaults, effects, preconditions, result example
  and exit cases. `uv5r help VERB --json` prints the same as JSON.
- Read `uv5r help VERB --json` before the first run of a verb in a session.

## Operating rules

- Do not open, `cat`, `screen` or `stty` the serial port.
- Run one verb at a time. Start a task with `uv5r status`.
- `--channel N` writes memory slot N. The radio receives slot N after the reload when it is in MR mode with N selected on the active display line. The display may show a name or a frequency. The CLI cannot read the display, so ask the human when it matters which channel the radio is on.
- Slot 0 is the scratch slot. `check` examples use slot 0 and `sweep` writes only slot 0.
  `tune` and `load` write any slot.
- Run `uv5r check 162.400 --channel 0` once per session before tuning slot 0, with a NOAA
  frequency that carries audio at the location. Exit 0 means audio above the floor after
  writing slot 0, consistent with the radio receiving slot 0. Exit 5 lists the causes: VFO
  mode, another slot selected, volume knob down, plug unseated, quiet frequency. Ask the
  human to set MR mode and select slot 0, then check again.
- After a `check` write, the slot keeps the receive-only record. After `sweep`, slot 0
  keeps the write that `slot0` names; `null` means unknown. Nothing restores slot 0.
- Ask the human to set MR mode and select slot 0 before a sweep, then run
  `uv5r sweep channels.json --seconds 30 --out-dir rx --play`.
- Write a plan to its own slots with one `uv5r load PLAN.json`.
- Write public-safety listening channels with `--rx-only`.
- Trust the display for the active channel. `status` reads `channelA` and `channelB` from
  EEPROM.
- The radio speaker is silent while the AIOC is plugged in. The human hears receive audio
  only through `uv5r listen --seconds 5 --out FILE --play` or
  `uv5r sweep PLAN --out-dir DIR --play`.
- The receiver is deaf during a clone session. Back-to-back verbs take about 3 s longer for
  the handshake retry.
- On the `input clips` warning, ask the human to turn the volume knob down, then listen
  again.
- `key` raises PTT on the channel the radio display shows. The CLI cannot read that
  channel, and a receive-only slot radiates nothing. Key only when the human asked and the
  frequency is one they may transmit on, after asking the human what the display shows.

## On a failed command

- A failed command prints nothing on stdout and one error object on stderr with `kind`,
  `reason`, `message`, `remedy`, `retry` and detail fields when output is JSON, piped or
  with `--json`, and the message plus a remedy line as text on a terminal. An exit of 128 plus a signal number
  prints the result on stdout with `interrupted` and no error. Act on `reason`, `remedy`
  and `retry`; `uv5r help --json` lists each reason and retry value under `errors`.
- `retry: no`: do not rerun; follow the remedy and report to the human. `once`: rerun the
  same command once. `after-remedy`: rerun after doing the remedy.
- A `load` error carries `slot`, the plan entry that failed. A `sweep` error carries
  `summary`, the sweep result so far.
- After a failed `key`, report and wait for the human.
