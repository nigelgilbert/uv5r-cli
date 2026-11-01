# Transmit audio

How `say` and `id` turn text into a transmission that ends with the station callsign, and how the station config works. The transmit rule and the pipeline steps are in `uv5r help` and `uv5r help say`.

## say and id

`uv5r say "bench check, over"` speaks the text and ends with the ID sentence, as in "This is
Kilo, Juliett, Seven, Alfa, Bravo, Charlie". `uv5r id` sends the ID sentence alone, in about
5 s. `id` runs the `say` checks with no clear check. A receive-only slot radiates nothing.

- The 300 Hz high-pass keeps energy out of the CTCSS band. The pass also has a 3 kHz low-pass,
  `alimiter`, `leadMs` of leading silence and 0.3 s of trailing silence.
- The output index comes from the audiotoolbox device list by name or UID. When the AIOC input
  and output share a name, the output is the one whose UID ends in `:1`.
- `say --clear S` exits 5 with `channel-busy` when a 20 ms frame reads above -50 dBFS.
- A player failure while keyed exits 3 with `audio-process-failed`, `retry: no`, `pttAsserted`,
  `released`, `playedSeconds` and `idOwed`. A player that runs past the padded WAV plus `tailMs`
  plus 5 s loses PTT at the watchdog and exits 3 the same way.

## Rehearse

`say --rehearse` runs the config, synthesis, filter and measurement steps, then plays the WAV
through the system default output with `afplay` and the port closed. With PTT low and VOX off it
radiates nothing. Run it before the first transmission of a session. `--out FILE` keeps the
conditioned WAV.

`--rehearse`, `--clear` and `--out` belong to `say`. `id` takes `--output` and `--config`.

## Level and timeout

The AIOC applies the macOS output volume of its device before the DAC, so the transmit level
follows that volume.

The `maxSeconds` cap assumes the UV-5R default TOT of 60 s. Lower it on a radio set to a
shorter TOT.

## Station config

`say` and `id` read the callsign and their transmit settings from `uv5r.json` at the repo root,
laid out as in `uv5r.example.json`.

```json
{
  "callsign": "KJ7ABC",
  "outputDevice": "AIOC Audio",
  "inputDevice": "AIOC Audio",
  "model": "models/ggml-base.en-q5_1.bin",
  "voice": "Samantha",
  "leadMs": 300,
  "tailMs": 400,
  "maxSeconds": 30
}
```

`--config FILE` names another file, then `UV5R_CONFIG`, then `uv5r.json`. A file named by
`--config` or `UV5R_CONFIG` has to exist. Unknown keys are ignored. A file that fails to parse,
a key of the wrong type, or a number outside its range exits 2 with `invalid-argument` naming
the field. No callsign exits 2 with `station-unconfigured`. The values above are the defaults.
`uv5r help say` lists the ranges under `fields`. `callsign` takes letters and digits.
`outputDevice` is the `--output` default and `inputDevice` the device `say --clear` and `hear`
listen on.

`hear` reads `inputDevice`, `model` and `callsign` and runs without a config file. The callsign
is the whisper prompt. With no callsign the prompt is empty.
