# The audio input flag is --input

**Type**: AFK

**Status:** 🔲 Not started

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, item 8.

## What to build

`check`, `listen`, `hear`, `sweep` and `volume` take `--input NAME` for the avfoundation input. `--device` exits 2 with a message naming `--input`. The result field `device` becomes `input`. The config field stays `inputDevice`. In tinysa-cli `--device` names a serial path, so the two CLIs stop sharing a flag name with two meanings.

## Acceptance criteria

- [ ] `uv5r listen --seconds 1 --input "AIOC Audio" --json` runs and the result has `input`.
- [ ] `uv5r listen --seconds 1 --device x` exits 2 and the message names `--input`.
- [ ] `uv5r help --json` shows no `--device` under any verb.
- [ ] README, SKILL.md, `docs/receive.md` and `docs/errors.md` use `--input`. `npm run typecheck` and `npm test` pass.

## Blocked by

None - can start immediately
