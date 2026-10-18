# sweep in scratch mode

**Type**: AFK

**Status:** ✅ Done

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", sweep.

## What to build

`sweep channels.json --scratch N --seconds S` dwells on every plan entry through one slot. Scratch mode requires `--check MHZ`, which runs the `check` step on N before the loop, or `--no-check`; neither exits 2. For each entry it writes the record into N in a fresh session, waits the settle, captures S seconds with the listen pipeline, and records the result. Default dwell is 30 s. `--out-dir DIR` keeps each capture as a WAV named by channel and start time. `--play` plays each active capture through `afplay` after its dwell. `--floor` and `--device` pass through to listen.

stdout gets one object at the end: `swept`, `seconds`, `active` with channel, name, rxMhz, activeSeconds and out file for each active entry, and `warnings` collected across dwells. `--verbose` writes one JSON line per channel to stderr as each dwell ends. Ctrl-C ends the loop and still prints the summary for the entries finished so far.

Update the README verb list, help text and the uv5r skill with a sweep recipe that replaces the shell loop from the 2026-10-18 run.

## Acceptance criteria

- [ ] `uv5r sweep channels.json --scratch 0 --check 162.400 --seconds 2` against the fake radio with listen stubbed writes each entry to slot 0 in turn and prints one summary object
- [ ] `--scratch 0` without `--check` or `--no-check` exits 2
- [ ] `--verbose` produces one stderr line per entry and leaves stdout as one object
- [ ] `--out-dir` yields one WAV per entry with the channel number in the file name
- [ ] With `--play`, afplay is spawned only for entries whose activeSeconds is above 0
- [ ] README, help text and `.claude/skills/uv5r/SKILL.md` describe scratch mode
- [ ] `npm test` and `npm run typecheck` pass

## Blocked by

- #001
- #002
- #003
- #005
