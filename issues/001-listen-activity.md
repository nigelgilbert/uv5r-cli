# listen reports activity and clipping

**Type**: AFK

**Status:** 🔲 Not started

## Parent

docs/sweep-retrospective.md, "Decisions, 2026-10-18", listen.

## What to build

`listen` tells the caller which seconds carried audio and whether the input clips. A second is active when its RMS sits above -50 dBFS. `--floor DBFS` overrides the threshold. The result gains `active`, a per-second true/false list, and `activeSeconds`, the count of true entries. The first captured second is dropped from both, since it always holds the capture-start burst. `rmsDbfs` keeps its current shape.

The result gains `warnings`, a list of strings. When more than 1 percent of samples sit at full scale, the list holds `input clips: turn the volume knob down`. Take the full-scale count from the astats peak count ffmpeg already prints. Text output prints the active timeline and any warnings.

Update the README listen section, the help text and the uv5r skill's level notes so a reader learns the -50 dBFS rule and the two new fields in one place.

## Acceptance criteria

- [ ] `uv5r listen --seconds 5 --json` returns `active` with 5 entries, `activeSeconds`, and `warnings`
- [ ] `uv5r listen --seconds 5 --floor -40` shifts the threshold; a unit test on `summarize` covers both the default and an override
- [ ] A capture whose first second is loud and the rest silent reports `activeSeconds` 0
- [ ] A fixture with more than 1 percent full-scale samples yields the clipping warning; one with less yields an empty list
- [ ] README, help text and `.claude/skills/uv5r/SKILL.md` name `--floor`, `active`, `activeSeconds` and `warnings`
- [ ] `npm test` and `npm run typecheck` pass

## Blocked by

None - can start immediately
