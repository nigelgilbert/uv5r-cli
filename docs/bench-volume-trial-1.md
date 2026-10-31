# Bench volume trial 1

Date: 2026-10-31
Commit: 9b160a7 on feature/volume-verb
Hardware as `status` reports it: firmware HN5RV011, family uv5r, magic 291, ident `aa 30 76 04 00 05 20 dd`, work mode channel, squelch 3, voice eng, beep on, abr 5.
Serial: AIOC serial f40b162d at `/dev/cu.usbmodemf40b162d5`, set with `UV5R_TARGET` on every uv5r command.
Audio: `--device` left at the default `AIOC Audio` for every call.
Sandbox bypass: not needed for any command.

Nothing transmitted. The only radio writes were the squelch 0 and restore writes that `volume` makes.

## Setup and cable changes

The first attempt ran with no `UV5R_TARGET`. `status` exited 5 with `session-unavailable` in 5.70 s, `identify` found no magic in 29.53 s and a second `status` exited 5 in 5.69 s. Two AIOCs were on USB then:

| Callout device | USB serial | Note |
|---|---|---|
| `/dev/cu.usbmodem146d3f3a5` | 146d3f3a | first in `SerialPort.list()`, so the CLI picked it; no radio answered |
| `/dev/cu.usbmodemf40b162d5` | f40b162d | the radio answers here |
| `/dev/cu.usbmodem4001` | 400 | tinySA |

The coordinator found the radio on f40b162d. The trial restarted from step 1 with `UV5R_TARGET=/dev/cu.usbmodemf40b162d5`.

ffmpeg device list with both AIOCs plugged in, before step 1:

```
[0] MacBook Pro Microphone
[1] AIOC Audio
[2] AIOC Audio
[3] Microsoft Teams Audio
[4] ZoomAudioDevice
```

After step 3 the human unplugged 146d3f3a. `/dev/cu.usbmodemf40b162d5` stayed, so `UV5R_TARGET` and the step 2 baseline stayed. ffmpeg device list from then on:

```
[0] MacBook Pro Microphone
[1] ZoomAudioDevice
[2] AIOC Audio
[3] Microsoft Teams Audio
```

The AIOC input moved from index 1 or 2 to index 2, and the other devices moved too.

## Step 1: status

Command: `UV5R_TARGET=/dev/cu.usbmodemf40b162d5 uv5r status --json`
Exit: 0
Wall time: 1.29 s

```json
{"firmware":"HN5RV011","firmwareHex":"48 4e 35 52 56 30 31 31 ff ff ff ff ff ff","family":"uv5r","magic":"291","ident":"aa 30 76 04 00 05 20 dd","workmode":"channel","squelch":3,"voice":"eng","beep":"on","abr":5}
```

## Step 2: settings baseline

Command: `uv5r settings --json`
Exit: 0
Wall time: 5.42 s

```json
{"squelch":3,"save":3,"abr":5,"beep":"on","timeout":3,"voice":"eng","mdfa":"freq","mdfb":"freq"}
```

Baseline squelch: 3.

## Step 3: volume

Command: `uv5r volume --json`, default device, two `AIOC Audio` inputs listed
Exit: 0
Wall time: 22.69 s
stderr: empty

```json
{"state":"too-quiet","rmsDbfs":-29.19,"instruction":"Turn the volume knob up a little, then say done."}
```

The default device read static at -29.19 dBFS, so the `--device 2` and `--device 1` runs were skipped. The output does not say which of the two inputs the name matched.

## Step 4: restore check

Command: `uv5r settings --json`
Exit: 0
Wall time: 1.15 s

```json
{"squelch":3,"save":3,"abr":5,"beep":"on","timeout":3,"voice":"eng","mdfa":"freq","mdfb":"freq"}
```

Squelch 3 matches step 2.

## Step 5: volume in text mode

Command: `script -q /dev/null node src/cli/main.ts volume`
Exit: 0
Wall time: 22.45 s

```
^Dstate       too-quiet
rms         -29.15 dBFS
instruction Turn the volume knob up a little, then say done.
```

## Step 6: volume again

Command: `uv5r volume --json`
Exit: 0
Wall time: 26.76 s

```json
{"state":"too-quiet","rmsDbfs":-29.61,"instruction":"Turn the volume knob up a little, then say done."}
```

Four normal runs read -29.19, -29.15, -29.61 and -29.17 dBFS (the last one is from the step 9 timing run). The spread is 0.46 dB. All sit 1.2 to 1.6 dB under the -28 dBFS band edge.

## Step 7: instruction review

State `too-quiet`, instruction "Turn the volume knob up a little, then say done."

A non-expert can likely act on it. Points where they may stall:

- The sentence does not name the knob. The UV-5R has two knobs on top. The volume knob is also the power switch.
- "Up" does not give a direction. Clockwise is up. Turning far the other way switches the radio off.
- "A little" gives no amount. The reading is 1.2 dB under the band.
- The human gets no feedback while turning. The speaker is silent with the AIOC plugged in, and squelch 3 shows nothing on the display.

No knob was turned. The human was not at the radio.

## Step 8: listen

Command: `uv5r listen --seconds 3 --json`, squelch 3
Exit: 0
Wall time: 8.44 s

```json
{"device":"AIOC Audio","seconds":3,"rmsDbfs":[-66.27,-66.35,-66.38],"zeroSeconds":0,"meanRmsDbfs":-66.33,"peakDbfs":-52.77,"active":[false,false,false],"activeSeconds":0,"warnings":[]}
```

meanRmsDbfs -66.33, peakDbfs -52.77, no warnings. Squelch 3 held the channel closed, so this is the AIOC floor.

## Step 9: SIGINT during volume

Command pattern: `node src/cli/main.ts volume --json & sleep N; kill -INT $!; wait $!; echo exit=$?`

At 4 s and later I ran `pgrep` for ffmpeg just before the kill to see whether capture had started. One profiled normal run showed the capture ffmpeg live from about 6.5 s to 13.7 s of a 22.69 s run. It printed `{"state":"too-quiet","rmsDbfs":-29.17,...}` and exited 0. The brief's 1.5, 4 and 6 s timings all landed before capture, so one more run used 9 s.

| Sleep | ffmpeg at kill | Exit | stdout and stderr | Wall time | Squelch after | Settings wall time |
|---|---|---|---|---|---|---|
| 1.5 s | not checked | 130 | empty | 11.24 s | 3 | 1.37 s |
| 4 s | none | 130 | empty | 15.88 s | 3 | 5.42 s |
| 6 s | none | 130 | empty | 15.87 s | 3 | 1.94 s |
| 9 s | capture pid 53973 | 130 | empty | 18.07 s | 3 | 5.43 s |

Every run exited 130 with nothing printed. No ffmpeg was left running after any of them. Each follow-up `uv5r settings --json` exited 0 with `{"squelch":3,"save":3,"abr":5,"beep":"on","timeout":3,"voice":"eng","mdfa":"freq","mdfb":"freq"}`.

The process kept running 9 to 12 s after each signal. The output does not show which phase the signal hit, or whether squelch 0 had been written.

## Step 10: final settings

Command: `uv5r settings --json`
Exit: 0
Wall time: 1.87 s

```json
{"squelch":3,"save":3,"abr":5,"beep":"on","timeout":3,"voice":"eng","mdfa":"freq","mdfb":"freq"}
```

Squelch 3 matches step 2. No restore was needed.

## Worked

- `volume` returned one JSON line with `state`, `rmsDbfs` and `instruction`, exit 0, and empty stderr.
- Readings repeated within 0.46 dB over four normal runs.
- Text mode printed the same three fields in aligned columns.
- Squelch was 3 after every normal run and after every SIGINT run, including the one during capture.
- SIGINT exited 130 with no result printed and left no ffmpeg behind, as `help volume` says.
- `listen` at squelch 3 read -66.33 dBFS, about 37 dB under the open-squelch static from `volume`. The squelch 0 write takes effect for the capture.
- No sandbox bypass was needed for the serial ports or the audio capture.

## Rough edges

- Expected the CLI to find the radio's cable. Two AIOCs were on USB. The CLI took the first one `SerialPort.list()` returned, which had no radio, and printed nothing that named the port. The `session-unavailable` remedy says to check power and the cable and does not mention `--target` or `UV5R_TARGET`. It took a manual `ioreg` and `SerialPort.list()` look to see the second cable.
- Expected `--device "AIOC Audio"` to name one input. With two AIOCs, ffmpeg listed two inputs with that name at indexes 1 and 2. The default read static in step 3, but no output says which index it used or which serial port that input belongs to. After one AIOC was unplugged, the AIOC input sat at index 2 and other devices shifted, so a numeric index recorded earlier would point at a different device.
- Expected the brief's SIGINT timings to land in the capture. A normal run takes about 22.5 s and the capture ffmpeg starts about 6.5 s in. The 1.5, 4 and 6 s kills all hit the serial phase. Only a 9 s kill hit the capture.
- Expected a SIGINT to say what it interrupted. Each run printed nothing and exited 130 after 9 to 12 s more. The caller cannot tell from the output whether squelch 0 had been written or whether the restore ran.
- Expected the instruction to be enough on its own. "Turn the volume knob up a little" names neither the knob nor the direction. The volume knob is also the power switch, and the human gets no sound or display feedback while turning.
- Expected `uv5r volume` in text mode to print only the result. Under `script -q /dev/null` it printed a leading `^D` before `state`.
- Expected steady `settings` wall times. The same read took 1.15 to 1.94 s on some runs and 5.42 to 5.43 s on others.

## Knob loop with the human, same day

Run from the main session after the trial, with the human at the radio. The AIOC input was the
macOS default input device.

| run | before the run | rmsDbfs | state |
|---|---|---|---|
| 1 | trial position | -29.53 | too-quiet |
| 2 | human turned the knob "a little" | -29.90 | too-quiet |
| 3 | macOS input volume 61 to 100 percent | -29.90 | too-quiet |
| 4 | human turned the knob about a quarter turn clockwise | -27.81 | ok |

- The macOS input volume change moved the reading by nothing. Issue 001 reports the AIOC
  firmware scaling the host input volume after the ADC; this radio and cable showed no scaling
  at 61 percent.
- "A little" moved the reading under the 0.46 dB run-to-run spread. A quarter turn moved it
  about 2 dB at this end of the knob's travel.
- The loop closed in four runs, about 90 s of radio time.
