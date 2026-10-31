# Machine results carry integer Hz

**Type**: AFK

**Status:** 🔲 Not started

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, item 11.

## What to build

`read`, `tune`, `load`, `erase` and the `sweep` summary report `rxHz` and `txHz` as integers in place of the `rxMhz` and `txMhz` strings, and `offsetHz` where an offset is reported. The text form keeps MHz with three to five decimals. Frequency input is unchanged: MHz, Hz or exponent form. The `verification-failed` field list from #001 uses the new names. The plan file keeps `rxMhz` and `offsetMhz` since humans write it; `load` converts. The fake radio's state file and the PTT file already carry `freq_hz` and stay as they are.

## Acceptance criteria

- [ ] `uv5r read 1 --target fake --json` prints `rxHz` and `txHz` as numbers and no `rxMhz`.
- [ ] `uv5r read 1 --target fake` prints the frequency in MHz on the terminal.
- [ ] `uv5r tune 446.00625 --channel 1 --target fake --json` returns `rxHz: 446006250`.
- [ ] `uv5r help read --json | jq .result` shows the integer fields.
- [ ] README, SKILL.md and the channel-plan skill match. `npm run typecheck` and `npm test` pass.

## Blocked by

- #001
