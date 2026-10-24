# Bench verification and README protocol notes

**Type**: HITL (a human powers the radio off and on and sets the pin for the pause test)

**Status:** 🔲 Not started

## Parent

[docs/clone-protocol-plan.md](../docs/clone-protocol-plan.md), slice 4, work items 5 to 7.

## What to build

Read-only verification on the bench UV-5R over the AIOC, then the README text that records what the bench showed. Run `uv5r status --json`, `uv5r identify`, `UV5R_MAGIC=ORIG uv5r status`, `uv5r identify` with the radio off, and `uv5r dump` against the fixture. Answer bench question 2 (does the unit ack `ORIG`) and then question 1 (does a silent magic need a pause) by setting `SCAN_SILENT_PAUSE_MS` to 0 in a local edit and running `identify` with a pin that puts a silent magic ahead of `291`. Revert the local edit.

The README section "Protocol notes from the bench" gains the ident meaning, the magic table, the foreign-radio names, the `identify` timing and the two bench answers. The `restore` row notes that on post-291 firmware the ident appears to encode the band limits, so a restore after a band-limit change exits 5 with `image-incompatible` and the fix is to dump again. If question 1 answers no, open a follow-up to lower the constant.

## Acceptance criteria

- [ ] `uv5r status --json` on the bench reports `magic` `291`, `family` `uv5r`, firmware `HN5RV011`.
- [ ] `uv5r identify` on the bench stops at the first magic with `pin` `null`.
- [ ] `UV5R_MAGIC=ORIG uv5r status` result recorded in the README, ack or no ack.
- [ ] `uv5r identify` with the radio off exits 5 with `session-unavailable` and finishes within 65 s by wall clock.
- [ ] `uv5r dump --out` produces an image equal to the fixture outside the aux area.
- [ ] The pause test result is recorded in the README and the local edit is reverted (`git diff src/` is empty apart from committed work).
- [ ] The README "Protocol notes from the bench" section and the `restore` row contain the new text.
- [ ] No write verb runs against the radio during this issue.

## Blocked by

- #003
