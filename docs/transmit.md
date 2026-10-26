# Transmit audio

How `say` and `id` turn text into a transmission that ends with the station callsign, and how the station config works.

## Control operator

You are the control operator. Stay at the radio for every transmission and stop it with Ctrl-C.
Each transmission ends with the callsign from uv5r.json. A stock UV-5R is not certified for
GMRS or FRS. Use this feature on amateur frequencies with the required license and control
operator.

`key`, `say` and `id` raise PTT on the channel the radio display shows. The CLI cannot read
that channel, and a receive-only slot radiates nothing. Key when you mean to and the frequency
is one you may transmit on, after checking what the display shows.

## say and id

`uv5r say "bench check, over"` speaks the text and ends with the ID sentence, as in "This is
Kilo, Juliett, Seven, Alfa, Bravo, Charlie". `uv5r id` sends the ID sentence alone, in about
5 s. `id` runs the `say` checks with `--max-seconds 30` and no clear check.

`uv5r help say` lists the steps: config read, synthesis with macOS `say -v Samantha` at 48 kHz,
the filter pass, the level and length checks, device lookup, the optional clear check, then
PTT.

### Pipeline details

- The 300 Hz high-pass keeps energy out of the CTCSS band. The pass also has a 3 kHz low-pass,
  `alimiter`, `--lead` of leading silence and 0.3 s of trailing silence. `--lead` defaults to
  300 ms; use 500 for repeaters.
- The output index comes from the audiotoolbox device list by name or UID. When the AIOC input
  and output share a name, the output is the one whose UID ends in `:1`. An absent device exits
  3 with `audio-device-unavailable`.
- `say --clear S` listens S seconds on the input device and exits 5 with `channel-busy` when a
  20 ms frame reads above -50 dBFS.
- The player is `ffmpeg -f audiotoolbox`. PTT holds for `--tail` (400 ms) after it ends, then
  drops.
- Digital zero exits 3 with `speech-engine-failed`. The padded WAV plus `--tail` past
  `--max-seconds` (30, at most 55) exits 2 with `utterance-too-long`.

Every check runs before the port opens. `identified` is true when the player exits 0, since the
ID ends the WAV. A player failure while keyed exits 3 with `audio-process-failed`, `retry: no`,
`pttAsserted`, `released`, `playedSeconds` and `idOwed`. A player that runs past the padded WAV
plus `--tail` plus 5 s loses PTT at the watchdog and exits 3 the same way.

`idOwed: true` means the player ran past `--lead` without finishing the ID. Identify by voice or
run `uv5r id`.

## Rehearse

`say --rehearse` runs the config, synthesis, filter and measurement steps, then plays the WAV
through the system default output with `afplay` and the port closed. With PTT low and VOX off it
radiates nothing. Run it before the first transmission of a session. `--out FILE` keeps the
conditioned WAV.

`--rehearse`, `--clear` and `--max-seconds` belong to `say`. `id` takes none of them.

## Level and timeout

The AIOC applies the macOS output volume of its device before the DAC, so the transmit level
follows that volume.

The `--max-seconds` cap assumes the UV-5R default TOT of 60 s. Lower it on a radio set to a
shorter TOT.

## Station config

`say` and `id` read the callsign from `uv5r.json` at the repo root, laid out as in
`uv5r.example.json`.

```json
{
  "callsign": "KJ7ABC",
  "outputDevice": "AIOC Audio",
  "inputDevice": "AIOC Audio",
  "model": "models/ggml-base.en-q5_1.bin"
}
```

`--config FILE` names another file, then `UV5R_CONFIG`, then `uv5r.json`. A file named by
`--config` or `UV5R_CONFIG` has to exist. Unknown keys are ignored. A file that fails to parse,
or a key of the wrong type, exits 2 with `invalid-argument`. No callsign exits 2 with
`station-unconfigured`.

- `callsign` takes letters and digits.
- `outputDevice` sets the `--output` default. It defaults to `AIOC Audio`.
- `inputDevice` sets the device `say --clear` and `hear` listen on. It defaults to `AIOC Audio`.
- `model` names the whisper.cpp model relative to the repo root,
  `models/ggml-base.en-q5_1.bin` by default.

`hear` reads `inputDevice`, `model` and `callsign` and runs without a config file. The callsign
is the whisper prompt. With no callsign the prompt is empty.
