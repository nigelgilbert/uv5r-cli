# Lower `SCAN_SILENT_PAUSE_MS` to 0

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[docs/clone-protocol-plan.md](../docs/clone-protocol-plan.md), open question for the bench 1, answered in issue 004. Read nothing under `docs/chirp-notes/` and nothing from the Chirp repo.

## Evidence

Bench UV-5R, firmware HN5RV011, AIOC on `/dev/cu.usbmodemf40b162d5`, 2026-10-24. The unit does not ack `ORIG`. `UV5R_MAGIC=ORIG uv5r identify` sends `ORIG` twice, `SETTLE_MS` apart, then `291` after `SCAN_SILENT_PAUSE_MS`.

| `SCAN_SILENT_PAUSE_MS` | Runs | `291` acked | Time to ack | Failed run |
|---|---|---|---|---|
| 0, local edit | 10 | 9 | 6.6 s | 33.4 s to exit 5 |
| 2000, committed | 5 | 4 | 8.6 s | 59.4 s to exit 5 |

Each failed run printed `291 at 9600: silent` and got no reply from any later magic. The miss occurred at both values, so the pause does not prevent it. The run log sits in the overseer's session scratchpad as `bench-log.md`.

## What to build

Set `SCAN_SILENT_PAUSE_MS` in `src/core/radio.ts` to 0. A silent radio then takes about 33 s. Update the budget text to match: the `identify` help entry in `src/cli/main.ts`, the README verb table row and "`identify` timing" subsection, the SKILL.md operating rule, `BUDGET_MS` in `test/core/radio.test.ts` and the budget assertions in `test/cli/cli.test.ts`. The `SETTLE_MS` pause between the two attempts of the first magic and `PROGRAM_PAUSE_MS` stay as they are.

## Acceptance criteria

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] `SCAN_SILENT_PAUSE_MS` is 0.
- [ ] The help entry, README and SKILL.md state the new silent-radio budget.
- [ ] The silent-scan test under fake timers asserts the new budget.

## Blocked by

- #004
