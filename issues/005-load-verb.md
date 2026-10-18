# load verb writes a channel plan

**Type**: AFK

**Status:** ✅ Done

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", load.

## What to build

`load channels.json` writes every entry of a plan file in one clone session, reads each slot back and returns the list of written records with `appliesAfterSeconds`. Each entry maps onto the `tune` flags one to one: `channel`, `rxMhz`, `offsetMhz`, `tone`, `rxTone`, `narrow`, `lowPower`, `rxOnly`, `name`. The plan parser validates every entry before the port opens; a bad field exits 2 naming the channel and field. Slots absent from the plan stay as they are. A read-back mismatch exits 5 naming the channel. The same parser serves `sweep`.

Text output prints one `channelText` line per entry. Update the README verb list, the help text, the uv5r skill and the channel-plan skill's hand-off step so a plan goes onto the radio with one command.

## Acceptance criteria

- [ ] `uv5r load channels.example.json --json` against the fake radio writes 7 records and returns 7 entries; a `read` of each slot matches
- [ ] A plan with a bad tone or a channel outside 0..127 exits 2 before the port opens, naming the channel
- [ ] A fake that corrupts one write makes `load` exit 5 naming that channel
- [ ] Slots outside the plan are byte-identical before and after `load` in the test
- [ ] README, help text, `.claude/skills/uv5r/SKILL.md` and `.claude/skills/channel-plan/SKILL.md` describe `load`
- [ ] `npm test` and `npm run typecheck` pass

## Blocked by

- #004
