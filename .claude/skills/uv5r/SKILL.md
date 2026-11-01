---
name: uv5r
description: Operate the Baofeng UV-5R on the bench through the `uv5r` CLI and the AIOC cable, with JSON output. Use when the user mentions the Baofeng, the UV-5R, the AIOC, tuning or keying the radio, a memory channel, MR or VFO mode, checking the live channel, loading or sweeping a channel plan, CTCSS or DCS tones, repeater offsets, PTT, backing up the radio, menu settings, voice or beep, squelch, listening to receive audio, audio levels, speaking text over the radio, transcribing received speech, or station identification and the callsign.
---

# uv5r

Run commands from the repo root. `uv5r` means `node src/cli/main.ts`.

Read `uv5r help --json` once at the start of a session for the operating rules, error format and exit codes. Read `uv5r help VERB --json` before the first run of a verb. This file adds the session order and the points where the human has to act.

## Session

- Start with `uv5r status`. Run one verb at a time.
- When `status` exits 5 with `session-unavailable` and the human confirms the radio is on and the cable is seated, run `uv5r identify` once with no `UV5R_MAGIC` prefix (about 29 s). Put the `pin` line it prints before every later `uv5r` command.
- At setup, ask the human to select a quiet channel and set the macOS input volume of `AIOC Audio` to 100 percent. Run `uv5r volume`, relay `instruction` word for word, and rerun after the human says done, until `state` is `ok`.
- Run `uv5r check 162.400 --channel 0` once per session before tuning slot 0, with a NOAA frequency that carries audio at the location. On exit 5, follow the error's `remedy` and `retry`.
- Write a plan to its own slots with one `uv5r load PLAN.json`. Write public-safety listening channels with `--rx-only`.
- Run `uv5r sweep channels.json --seconds 30 --out-dir rx` after the human sets MR mode and selects slot 0.
- On `input clips`, run the `volume` loop.

## Ask the human

- The CLI cannot read the display. Ask which channel the radio shows whenever it matters.
- Offer to play WAVs from `listen --play`, `sweep --out-dir` or `hear --out-dir`.

## Transmit

- `key`, `say` and `id` transmit on run. Run them only when the human asked and on a frequency they may use. Ask what the display shows first. The human stays at the radio.
- Run `say --rehearse` before the first transmission of a session.
- Stop a transmission with Ctrl-C and report it. After a failed transmission, report and wait for the human.
- `say` and `id` end with the uv5r.json callsign. `key` sends a carrier and no ID. After a `key`, send the callsign with `uv5r id` or ask the human to identify by voice. Do the same on `idOwed: true`.

## Receive speech

- Preflight: `uv5r check 162.400 --channel 0`, then `uv5r tune FREQ --channel 0`, then ask the human what the display shows.
- Run the operator loop from `uv5r help hear`, with the human at the radio.
- Set the Bash timeout to the config `maxSeconds` plus `--timeout` plus 90 s: 180 s with the defaults.

## On a failed command

- Follow the error's `remedy` and `retry`. On `retry: no`, do not rerun; report to the human.
- On `verification-failed`, `failed` names the fields that read back wrong. `failed: ["name"]` means the record took and only the name did not.
