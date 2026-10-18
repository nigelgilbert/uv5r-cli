# sweep in knob mode

**Type**: AFK

**Status:** 🔲 Not started

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", sweep.

## What to build

`sweep channels.json --seconds S` without `--scratch` dwells on the plan's own slots and writes nothing to the radio. Before the loop it reads every plan slot in one session and compares each with the plan entry. Any mismatch exits 5 with the channel, the plan record and the radio record, and names `load` as the fix. For each entry it then prints `turn the knob to channel N (NAME) and press Enter` on stderr, waits for a line on stdin, and runs the same dwell, capture, play and reporting as scratch mode. stdin that is not a TTY exits 2 with a message naming `--scratch`.

Update the README and the uv5r skill so a human or a small model can run the preloaded plan with one command.

## Acceptance criteria

- [ ] `uv5r sweep channels.example.json --seconds 2` against a fake loaded with the plan prompts once per entry and prints one summary object
- [ ] A fake with one slot differing from the plan exits 5 before any prompt, naming the channel and both records
- [ ] The fake's memory is byte-identical before and after a knob-mode sweep
- [ ] Piped stdin exits 2 and names `--scratch`
- [ ] README, help text and `.claude/skills/uv5r/SKILL.md` describe knob mode
- [ ] `npm test` and `npm run typecheck` pass

## Blocked by

- #006
