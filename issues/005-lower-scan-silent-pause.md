# Lower the silent pause and retry every supported magic

**Type**: HITL (a human sets the pin for the acceptance runs)

**Status:** ✅ Done

## Parent

[docs/clone-protocol-plan.md](../docs/clone-protocol-plan.md), open question for the bench 1, answered in issue 004. Read nothing under `docs/chirp-notes/` and nothing from the Chirp repo.

## Evidence

Bench UV-5R, firmware HN5RV011, AIOC on `/dev/cu.usbmodemf40b162d5`, 2026-10-24. The unit does not ack `ORIG`. `UV5R_MAGIC=ORIG uv5r identify` sends `ORIG` twice, `SETTLE_MS` apart, then `291` after `SCAN_SILENT_PAUSE_MS`.

| `SCAN_SILENT_PAUSE_MS` | Runs | `291` acked | Time to ack | Failed run |
|---|---|---|---|---|
| 0, local edit | 10 | 9 | 6.6 s | 33.4 s to exit 5 |
| 2000, committed | 5 | 4 | 8.6 s | 59.4 s to exit 5 |

Each failed run printed `291 at 9600: silent` and got no reply from any later magic. The miss occurred at both values, so the pause does not prevent it. Four unpinned `identify` and `status` runs acked on the first attempt. After the failed run the radio answered the next verb 52 s later on its first attempt. The run log sits in the overseer's session scratchpad as `bench-log.md`.

Today only the first magic in the scan gets a second attempt. Every later magic gets one, so a radio whose magic sits second or later fails the whole scan on one missed byte. This is what the 2 of 15 pinned runs hit.

## What to build

In `src/core/radio.ts`:

- Pause 0 after silence. Keep the 2 s pause after a wrong ack, as spec 3.4 recommends.
- Give every supported magic after the first a second attempt on silence or a wrong ack, with the same pauses. The first magic keeps its `SETTLE_MS` gap. Unsupported and foreign magics keep one attempt.

Four attempts join the silent scan, about 5 s. A silent radio then takes about 38 s. Update the budget text once: the `identify` help lines in `src/cli/main.ts` (the pause line and the 59 s line), the README verb table row, "`identify` timing" subsection and the pause answer in "Protocol notes from the bench", the SKILL.md operating rule, `BUDGET_MS` in `test/core/radio.test.ts` and the budget assertions in `test/cli/cli.test.ts`. `SETTLE_MS` and `PROGRAM_PAUSE_MS` stay as they are.

Keep the change small. One loop, no new helper types.

## Acceptance criteria

- [x] `npm run typecheck` and `npm test` pass.
- [x] The silent-scan test under fake timers asserts the new budget and the extra attempts.
- [x] The help entry, README and SKILL.md state the new silent-radio budget.
- [x] Bench: `UV5R_MAGIC=ORIG uv5r identify` 20 times, `291` acked in all 20. If a run fails after both attempts, give later magics the `SETTLE_MS` gap and rerun the 20.

## Result

Implemented in `d827632`. `npm run typecheck` passes. `npm test` passes 553 tests in 19 files. The silent-scan test sets `BUDGET_MS` to 38_100 and asserts 24 attempts.

Bench, 2026-10-24: `UV5R_MAGIC=ORIG uv5r identify` 20 times, `291` acked in all 20 with exit 0. Runs 1 and 18 acked on the second `291` attempt in 7.8 s. The other 18 acked on the first attempt in 6.5 s. No rerun with the `SETTLE_MS` gap was needed. The run log sits in the implementation agent's session scratchpad as `bench-005.log`.

`SCAN_SILENT_PAUSE_MS` is renamed `SCAN_WRONG_ACK_PAUSE_MS`. It holds the 2 s pause after a wrong ack.

## Blocked by

- #004
