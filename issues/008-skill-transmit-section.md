# The uv5r skill carries one transmit section

**Type**: AFK

**Status:** Done, 7c61c3a

## Parent

`../bench-operator/docs/decisions-2026-11-01.md`, item 3.

## What to build

`.claude/skills/uv5r/SKILL.md` spreads the transmit rules over lines 24 to 26 and 39. Gather them under one `## Transmit` heading and add the two missing points:

- `key`, `say` and `id` transmit on run. Run them only when the human asked and on a frequency they may use. Ask what the display shows first. The human stays at the radio.
- Stop a transmission with Ctrl-C and report it.
- `say` and `id` end with the callsign. `key` sends a carrier and no ID. After a `key`, send the callsign with `uv5r id` or ask the human to identify by voice, and on `idOwed: true` do the same.
- Run `say --rehearse` before the first transmission of a session.

The section matches the reworded `rules.transmit` from #010. bench-operator links this skill folder and its agent file links the section in bench-operator #020. Keep the line 24 clause "Ask which channel the radio shows whenever it matters" under `## Ask the human`. SKILL.md stays at most 60 lines, as `test/cli/cli.test.ts` checks.

## Acceptance criteria

- [ ] SKILL.md has a `## Transmit` section naming the three verbs, Ctrl-C and `uv5r id` after a key, and the old bullets are gone.
- [ ] `npm test` passes.

## Blocked by

- #010, for the rule wording
