# check verb confirms the live channel

**Type**: AFK

**Status:** 🔲 Not started

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", check.

## What to build

`check FREQ --channel N` proves the radio is parked on slot N in MR mode. It writes FREQ into N the way `tune` does, waits the 3 s settle, listens for 5 s and reports the listen result plus `channel` and `rxMhz`. `activeSeconds` above 0 exits 0. Silence exits 5 with `no audio on channel N: set MR mode and select N`. The verb takes the common flags, `--device` and `--floor`; `--seconds` overrides the 5 s listen.

Replace the uv5r skill rule about asking the human for the channel number with a step that runs `check` against a known-live frequency such as NOAA, and asks the human only when it exits 5. Update the memory note workflow in the README's verb table.

## Acceptance criteria

- [ ] `uv5r check 162.400 --channel 0` on the bench with the radio on slot 0 in MR mode exits 0 and returns `activeSeconds` above 0
- [ ] The same command with the radio in VFO mode exits 5 with the message above
- [ ] A CLI test against the fake radio asserts the slot write and the listen call order, with listen stubbed
- [ ] `uv5r check` with no frequency or no `--channel` exits 2
- [ ] README verb list, help text and `.claude/skills/uv5r/SKILL.md` describe `check` and the skill's live-channel step uses it
- [ ] `npm test` and `npm run typecheck` pass

## Blocked by

- #001
