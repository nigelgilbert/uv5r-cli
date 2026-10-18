# rxTone in the plan file

**Type**: AFK

**Status:** ✅ Done

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", Plan file.

## What to build

Plan fields map one to one onto `tune` flags. Add an optional `rxTone` field that maps to `--rx-tone`, in the same `82.5`, `D606N`, `D023I` forms `parseTone` accepts. `tone` stays the transmit tone. Document the mapping as a table in the README next to the plan file description.

Update the channel-plan skill: the candidate format gains `rxTone`, and the public-safety brief tells the subagent to put a listed tone on a receive-only entry in `rxTone` and leave `tone` off. Update `channels.example.json` so the receive-only SHERIFF entry shows the field, and move the tones on Dallas entries 10 and 12 in `channels.json` to `rxTone`.

## Acceptance criteria

- [ ] `channels.example.json` has a receive-only entry with `rxTone` and no `tone`
- [ ] The README lists every plan field beside its `tune` flag
- [ ] `.claude/skills/channel-plan/SKILL.md` candidate format and public-safety brief mention `rxTone`
- [ ] Dallas `channels.json` entries 10 and 12 carry `rxTone` and no `tone`

## Blocked by

None - can start immediately
