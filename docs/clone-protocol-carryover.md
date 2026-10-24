# Carryover: clone protocol work, 2026-10-24

All work sits on `feature/clone-protocol`. Review: [clone-protocol-review.md](clone-protocol-review.md). Plan: [clone-protocol-plan.md](clone-protocol-plan.md). Spec: [clone-protocol.md](clone-protocol.md). Typecheck and 553 tests pass. An adversarial review by Sol on 2026-10-24 confirmed the conclusions below and corrected the numbers.

## Decisions

| Item | Decision |
|---|---|
| Silent pause | `SCAN_SILENT_PAUSE_MS` to 0 after silence. The 2 s pause stays after a wrong ack. |
| Second attempt | Every supported magic after the first gets a second attempt on silence or a wrong ack, with the same pauses. The first magic keeps its `SETTLE_MS` gap. Unsupported and foreign magics keep one attempt. Four attempts join the silent scan, about 5 s; the silent budget becomes about 38 s. Both changes live in issue 005 with a bench screen of 20 pinned `ORIG` runs. |
| Pin remedy | When `UV5R_MAGIC` is set and a verb gets no ack, the remedy reads: check the radio is on and the cable is seated; `UV5R_MAGIC=X` is set, unset it and rerun; then run `uv5r identify` and export the line it prints. |
| Help retry | Every `help --json` reason string gains the default retry, as `exit 5, default retry once: ...`, with a note that the error's `retry` field governs. Sites override the default, for example `session-unavailable` throws with `after-remedy`. Update the `^exit \d: ` test in `test/cli/cli.test.ts` and the README and SKILL.md lines that say help lists retry values. |
| Dump criterion | Issue 004 stays ticked. The criterion now lists the 72 differing bytes as exceptions. The fixture stays the 2026-10-12 snapshot. |
| Bench unit | Open. [rx-audio-investigation.md](rx-audio-investigation.md) concludes the radio since 2026-10-13 is a different unit, or the same unit after full programming outside these sessions. The 2026-10-24 dump matches the 2026-10-12 fixture everywhere except the 72 bytes, including the regions that differed on 2026-10-13, and the 7-channel plan written on 2026-10-13 is gone. Restore writes main memory only, so it does not explain the aux match. Likeliest reading: the 2026-10-12 unit is back. Nigel confirms which radio is connected. |
| 57600 and 38400 probes | Dropped. Nigel has two or three reference UV-5Rs of different manufacturing dates and plans to rebuild the golden files from them later. |

## Issues to open

1. **Issue 005, written.** Pause and second attempt, with the budget text and the bench screen.
2. **Pin remedy.** The remedy text above, at the handshake site in `src/core/protocol.ts` and `src/core/radio.ts`.
3. **Help retry.** The string format above and the test.
4. **Investigation note.** A dated note in `rx-audio-investigation.md` with the 2026-10-24 match and the missing plan, leaving the conclusion open until Nigel answers.
5. **README pause answer.** Scope the "Does a silent magic need a pause" answer to the tested transition, silent `ORIG` to `291` on one unit, and record the 52 s recovery after the failed scan.

## Bench facts recorded

- The unit does not ack `ORIG`. Both attempts silent, 5.7 s.
- `identify` on the unit: `291` acks first, `pin` null, 0.9 s. Four unpinned runs acked on the first attempt.
- Radio off: `identify` exits 5 with `session-unavailable` in 59.3 s.
- Pinned `ORIG`: `291` silent on its single attempt in 2 of 15 runs; the scan ran to `session-unavailable`. The radio answered the next verb 52 s later.
- `droppedByte` reads true. Firmware `HN5RV011`, firmware bytes `48 4e 35 52 56 30 31 31 1d 20 20 ff ff ff`.
- `port.update` to 115200 and back ran on the AIOC with no error in three scans.
