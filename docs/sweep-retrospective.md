# Sweep retrospective and CLI suggestions, 2026-10-18

Deferred until after the code review.

On 2026-10-18 at about 00:15 local the bench UV-5R swept the Dallas plan in `channels.json`
and dwelt on the top-ranked channels for about fourteen minutes. NOAA 162.400 and
162.550 carried voice. 462.675 opened for about fifty seconds of unmodulated carrier. Every
other channel stayed at the squelched floor. The run used `tune`, `settings`, `read` and
`listen`, plus shell scripts around ffmpeg and ffplay for recording, playback and
activity detection.

## Suggestions

### Report the live channel and work mode

`status` reads `channelA`, `channelB` and `workmode` from EEPROM. The sweep waited until
the human pressed VFO/MR. Tuning NOAA 162.400 and listening proved the live channel. Add
a `probe` verb that performs that check, or a `status` field that reads the live channel
from the radio.

### Record and play in `listen`

`listen` discards the samples after measuring them. Add `--out file.wav` to keep the
capture and `--play` to send it to the default output device after the capture ends.
Capturing and playing in one ffmpeg process hung on this machine.

### Accept long captures

ffmpeg returns about 88 percent of the requested length, and `listen` fails on the
shortfall above about 6 s. A dwell needs 30 to 60 s. Accept the shorter capture and
report the seconds received, or request `seconds / 0.88`.

### Report activity

Add `activeSeconds`, the seconds above the squelch floor, and a per-second timeline to
the `listen` result. Drop the first second, which always holds a capture-start burst.

### Warn on level

NOAA peaked at 0 dBFS with the knob at the reference position from 2026-10-17. Warn when
the clipped fraction passes 1 percent and when squelch-0 RMS sits below -50 dBFS.

### Load a channel plan

Programming `channels.json` took thirteen `tune` calls driven by a node snippet and a TSV.
Add `load channels.json` that writes every channel in the file and reads each one back.
The `channel-plan` skill writes that file.

### Sweep in one session

Each `tune` opens a clone session and waits 3 s to apply. The sweep spent about 8 s per
channel on handshake and settle for 6 s of listening. Add a `sweep` verb that takes a
plan file, a scratch channel and a dwell time. It tunes each entry, captures, reports
activity and plays the active captures.

### Separate receive and transmit tones

`--tone` writes the transmit tone. Receive-only channels 10 and 12 in the Dallas plan now
hold a transmit tone the radio never uses. Nothing gates their squelch. Add `--rx-tone`.
Accept the `D606N` form that RepeaterBook and the plan file use.

## Process notes

- Echo `read 0` after each tune in sweep scripts. The first dwell pass matched the wrong
  TSV column, tuned nothing, and listened to 154.995 for the whole pass.
- Run the channel research before the sweep. The dwell ranking arrived after the first
  pass started.
- Tell voice from noise by spectrum shape and envelope modulation. Transcription is
  unavailable from the terminal: the macOS Speech framework aborts any process without
  the speech-recognition usage entitlement, and whisper is not installed.
