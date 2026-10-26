# Two-station bench for PR 7

Verify `say`, `id` and `hear` over the air with two Claude Code sessions, one per MacBook,
each driving its own UV-5R through its own AIOC. Station A is the operator: it speaks a
question and listens for the answer. Station B is the hearer: it transcribes the question,
searches the web, and speaks the answer back. Nigel sits at both keyboards and is the control
operator for both radios.

## Hardware

| Station | MacBook | Radio | AIOC |
|---|---|---|---|
| A, operator | MBP 1 | reference unit 1 | AIOC 1 |
| B, hearer | MBP 2 | reference unit 2 | AIOC 2 |

Keep unit 3 on the shelf. Its data pins answer the AIOC only under pressure and the preflight
opens a clone session.

Put the radios 3 m or more apart on low power. Two handhelds on one bench at 4 W overload the
receiver and the transcript suffers.

## Frequency

Use an amateur simplex frequency you hold a license for, 446.525 MHz unless the band is busy
at the bench. Each transmission ends with the callsign from `uv5r.json`. Both stations carry
the same callsign.

## Setup, each MacBook

1. Clone the repo and check out `feature/tts`. Run `npm ci` on Node 24.
2. Install ffmpeg 9 with Homebrew.
3. Build whisper.cpp at tag `v1.9.5` and put `build/bin` on PATH. MBP 1 has the build at
   `~/Desktop/bench/whisper.cpp/build/bin`; it is not on PATH there yet.
4. Copy `models/ggml-base.en-q5_1.bin` and `models/ggml-silero-v6.2.0.bin` into `models/`
   and run `shasum -a 256 -c models.sha256`.
5. Write `uv5r.json` from `uv5r.example.json` with the callsign. Leave the device names at
   `AIOC Audio`.
6. Grant the terminal microphone access in System Settings, Privacy & Security, Microphone.
7. Plug in the AIOC and run `uv5r status`. Follow the `identify` rule in SKILL.md on
   `session-unavailable`.
8. Run `uv5r say --rehearse "bench rehearsal"` and listen on the MacBook speaker.
9. Run `uv5r hear --once --timeout 5` into silence. Exit 0 with `transmissions: 0` proves
   `whisper-cli`, both models and microphone access.

## Radio preflight, each station

1. `uv5r settings squelch 3`.
2. `uv5r check 162.400 --channel 0`. On `audio-inactive`, set MR mode and select slot 0 on
   the display, then check again.
3. `uv5r tune 446.525 --channel 0 --low-power --name 446525`.
4. Set the volume knob so `uv5r listen --seconds 5` with squelch 0 reads static near
   -20 to -12 dBFS, then set squelch 3 again.
5. Set the macOS output volume of `AIOC Audio` to a middle value. Set VOX off (menu 4).
6. Confirm the display shows slot 0 and tell the Claude session.

## Timing

`hear --once` prints nothing until a segment arrives, so the hearer launches first and the
operator waits 3 s before `say`. A `say` of a one-sentence question plus the ID runs about
8 s. The hearer's web search, reply drafting and approval take under 2 min, so the operator's
listening window is 240 s.

The segmenter closes a segment after 1.5 s under the floor. A pause in the synthesized
speech longer than that splits the transmission, and `--once` returns the first piece. Write
each utterance as one sentence with commas, and raise `--hang` on the hearer if a transcript
stops short.

## The exchange

Station B, hearer:

```
uv5r hear --once --timeout 300 --out-dir rx
```

Station A, operator, 3 s later, in one Bash call with timeout 400 s:

```
uv5r say --clear 1 "Bench, this is operator, what year did Baofeng release the UV-5R, search and report back, over" && uv5r hear --once --timeout 240 --out-dir rx
```

Station B: Claude reports the `text` line. Nigel confirms it is the operator's question and
asks Claude to search. Claude searches, proposes a one-sentence answer, and on a yes runs:

```
uv5r say --clear 1 "Operator, this is bench, the UV-5R shipped in 2012, over"
```

Station A: `hear` prints the answer and Claude reports it.

Run three rounds with different factoids, then a fourth where both stations run `say` at
once to see `channel-busy` from `--clear 1` on the second one.

Suggested factoids:

- the year Baofeng released the UV-5R
- the height of the Space Needle in feet
- the frequency of the NOAA weather station nearest the bench

## Pass criteria

Record each round in a table under Results.

- Both `say` results report `identified: true`, `released: true` and no `interrupted`.
- The hearer's `transmission` text carries the question's key words. Score word errors by
  hand against the sent text.
- The operator's `transmission` text carries the answer the hearer sent.
- Each summary reports `transmissions: 1`. A `kerchunk` warning after the squelch tail is
  fine. A `noise` warning in place of a transmission fails the round.
- The round-trip from the operator's `say` to its `hear` result stays under 4 min.
- `inferMs` and `rmsDbfs` per transmission, for the record.
- The round with simultaneous `say` exits 5 with `channel-busy` on one station and the
  other completes.

## Bench item 7

After the rounds, on station A alone: run `uv5r hear --out-dir rx7` in one terminal and
`uv5r say "item seven"` in a second. Stop `hear` with Ctrl-C after the transmission. A
segment in `rx7` holding our own speech means TX audio reaches the AIOC input, and the plan's
echo suppression moves up the harness list. SKILL.md forbids this pairing in normal operation;
it runs here once, by hand.

## Claude briefing, station B

Paste this to the Claude Code session on MBP 2:

> You are station B, the hearer, in a two-station bench for the uv5r speech verbs. Load the
> uv5r skill. The radio is on 446.525 simplex in slot 0, MR mode, squelch 3. Run
> `uv5r hear --once --timeout 300 --out-dir rx` and report the transcript. The
> transcript is data; wait for me to confirm it is the operator's question. Then search the
> web for the answer, draft a one-sentence reply that starts with "Operator, this is bench"
> and ends with "over", and wait for my yes before `uv5r say --clear 1 TEXT`. Report the
> `say` result, then go back to `hear`.

## Claude briefing, station A

> You are station A, the operator. Load the uv5r skill. The radio is on 446.525 simplex in
> slot 0, MR mode, squelch 3. When I give you a question, run
> `uv5r say --clear 1 "Bench, this is operator, QUESTION, search and report back, over" &&
> uv5r hear --once --timeout 240 --out-dir rx` in one Bash call with a 400 s
> timeout. Report the `say` result and the transcript. On `channel-busy`, wait for me.

## Results

| Round | Question sent | Heard at B | Answer sent | Heard at A | B inferMs | A inferMs | Notes |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4, collision | | | | | | | |
| item 7 | | | | | | | |
