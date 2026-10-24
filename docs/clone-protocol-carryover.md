# Carryover: clone protocol work, 2026-10-24

Six branches stack on `main` at `d5b439e`. Merge in order. Review: [clone-protocol-review.md](clone-protocol-review.md). Plan: [clone-protocol-plan.md](clone-protocol-plan.md). Spec: [clone-protocol.md](clone-protocol.md).

| Branch | Tip | Holds |
|---|---|---|
| `feature/001-magic-table` | `086507b` | issue 001 |
| `feature/002-identify-classic` | `8e2bb3c` | issue 002 |
| `feature/003-identify-foreign-115200` | `c505c3b` | issue 003 |
| `feature/004-bench-and-readme-notes` | `1878f32` | issue 004 README text |
| `feature/005-review-and-cleanup` | `2304eb4` | review doc, Sol nits, cleanup |
| `feature/006-bench-results` | `e05d360` | bench results, issue 004 closed, issue 005 opened |

Typecheck and 553 tests pass at every tip. Each commit carries the Fable trailer.

## Decisions

1. **Dump criterion in issue 004.** Ticked with a note: the aux area and settings block match the fixture; 72 bytes differ in channels 0, 1, 126, 127, their names, the state page and the VFO frequencies, all slots the bench verbs write. Untick it to keep the literal reading.
2. **`help --json` retry value.** Reason strings read `exit N: means` with no retry. Issue 001 asked for retry `no` in the help output; `REASONS` and the runtime error carry it. Add `retry` to the strings, or amend the criterion.
3. **Bench unit identity.** [rx-audio-investigation.md](rx-audio-investigation.md) line 247 concludes the radio since 2026-10-13 is a different unit, from its aux area. The 2026-10-24 dump matches the 2026-10-12 fixture in the aux area byte for byte. Confirm which radio is on the bench and amend the conclusion.

## Issues to open or start

1. **Issue 005, open.** `issues/005-lower-scan-silent-pause.md`: set `SCAN_SILENT_PAUSE_MS` to 0. Measured: `291` acked after a silent `ORIG` with no pause in 9 of 10 runs; the silent scan drops from 59 s to about 33 s. Update the budget text in help, README and SKILL.md and the fake-timer tests.
2. **Stale pin, to write.** In 2 of 15 pinned scans `291`, second in the order, stayed silent on its single attempt and the scan ran to `session-unavailable`. Unpinned `identify` and `status` never failed. Proposal: give every supported classic magic a second attempt `SETTLE_MS` later, as the first magic gets today. Cost on a silent cable: five more attempts and pauses, about 21 s with the 2 s pause and about 6 s at 0. Decide after issue 005.
3. **Verb remedy on a stale pin, to write.** A stale `UV5R_MAGIC` makes every verb fail with the `identify` remedy. `identify` then prints `pin UV5R_MAGIC=291`. Consider a remedy line that names the pinned magic when `UV5R_MAGIC` is set.
4. **Deferred probes.** The 57600 UV17 and 38400 UV-K5 phases stay out of `identify` per the plan decisions. Open when such a radio reaches the bench.

## Bench facts recorded

- The unit does not ack `ORIG`. Both attempts silent.
- `identify` on the unit: `291` acks first, `pin` null, 0.9 s.
- Radio off: `identify` exits 5 with `session-unavailable` in 59.3 s.
- `droppedByte` reads true. Firmware `HN5RV011`, firmware bytes `48 4e 35 52 56 30 31 31 1d 20 20 ff ff ff`.
- `port.update` to 115200 and back ran on the AIOC with no error in three scans.

## Decision log, grill session 2026-10-24

| Item | Decision |
|---|---|
| Issue 005 pause | `SCAN_SILENT_PAUSE_MS` to 0. |
| Stale pin | Every supported classic magic gets a second attempt on `silent` or `wrong-ack`. The first magic keeps its `SETTLE_MS` gap. Later magics retry with no gap. Unsupported and foreign probes keep one attempt. |
| Pin remedy | When `UV5R_MAGIC` is set and a verb gets no ack, the remedy names the pin first: unset it or run `uv5r identify` and export the line it prints, then check the radio and cable. |
| Help retry | Every `help --json` reason string gains the retry hint, as `exit 5, retry no: ...`, with a test. |
| Dump criterion | Stays ticked with the note. The fixture stays the 2026-10-12 snapshot. |
| Bench unit | Open. Add a dated note to `rx-audio-investigation.md` stating the 2026-10-24 aux match and leave the conclusion open. |
| 57600 and 38400 probes | Dropped. Nigel has two or three reference UV-5Rs of different manufacturing dates and plans to rebuild the golden files from them later. |

Next: turn the stale pin, pin remedy, help retry and investigation note rows into issues alongside issue 005.
