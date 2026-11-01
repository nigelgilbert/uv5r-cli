# Machine results carry integer Hz

**Type**: AFK

**Status:** ✅ Done (4aa99b2)

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, item 11.

## What to build

`read`, `tune` and `load` report `rxHz` and `txHz` as integers. `check` and `sweep` report `requestedHz`. `erase` reports no frequency and no result reports an offset. The text form keeps MHz with three to five decimals. Frequency input is unchanged: MHz, Hz or exponent form. The `verification-failed` field list from #001 uses the new names. The plan file keeps `rxMhz` and `offsetMhz` since humans write it; `load` converts. The fake radio's state file and the PTT file already carry `freq_hz` and stay as they are.

## Acceptance criteria

- [x] `uv5r read 1 --target fake --json` prints `rxHz` and `txHz` as numbers and no `rxMhz`.
- [x] `uv5r read 1 --target fake` prints the frequency in MHz on the terminal.
- [x] `uv5r tune 446.00625 --channel 1 --target fake --json` returns `rxHz: 446006250`.
- [x] `uv5r help read --json | jq .result` shows the integer fields.
- [x] README, SKILL.md and the channel-plan skill match. `npm run typecheck` and `npm test` pass.

## Blocked by

- #001
