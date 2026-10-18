# listen keeps and plays the capture

**Type**: AFK

**Status:** 🔲 Not started

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", listen.

## What to build

`listen --out FILE` writes the capture as a 48 kHz mono WAV while still reporting levels. `--play` runs `afplay` on that file after ffmpeg exits and needs `--out`; `--play` without `--out` exits 2. The result reports `out` with the path. Capturing and playing in one ffmpeg process hung on the bench, so playback is a second process that starts after the capture ends. A missing `afplay` or a non-zero exit from it is a transport error that names the file.

Update the README listen section, the help text and the uv5r skill so the record-and-listen step is one command.

## Acceptance criteria

- [ ] `uv5r listen --seconds 3 --out /tmp/x.wav` writes a WAV that `afinfo` reports as 48000 Hz mono, about 3 s long
- [ ] `uv5r listen --seconds 3 --out /tmp/x.wav --play` plays the file after the capture; a test asserts afplay is spawned with the path after ffmpeg resolves
- [ ] `uv5r listen --seconds 3 --play` exits 2 with a message naming `--out`
- [ ] The JSON result carries `out` when `--out` is given
- [ ] README, help text and `.claude/skills/uv5r/SKILL.md` document `--out` and `--play`
- [ ] `npm test` and `npm run typecheck` pass

## Blocked by

- #001
