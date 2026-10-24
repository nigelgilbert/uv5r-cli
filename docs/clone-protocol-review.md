# Review: clone protocol implementation

Date: 2026-10-24. Plan: [clone-protocol-plan.md](clone-protocol-plan.md). Spec: [clone-protocol.md](clone-protocol.md).

## Branch

The plan's work items, the second-attempt change, the review fixes, the cleanup pass and the bench results sit
on `feature/clone-protocol`. `npm run typecheck` and `npm test` pass with 553 tests.

## Overseer review

### 001

- `ident.ts` matches spec sections 4.1, 4.2, 4.3 and 9. `classify` runs the `HN5RV01` rule first, filters basetypes by the answering magic's families, keeps a single-family magic's family on no hit, applies the `orig` exclusions and never throws.
- `attempt` discards input, paces the magic at 10 ms, waits 1200 ms for the ack and reads the ident in one `read(14, 300)`. The serial transport returns at the deadline when fewer than 14 bytes arrive, so an 8-byte ident costs the same 300 ms as before.
- `Session.start` retries on `silent` and `wrong-ack`. The issue text said "silence only"; the plan says both, and the plan wins.
- `selectedMagic()` runs in `main.ts` before the port opens and reaches every session call site, `check.ts` and `sweep.ts` included.
- Accepted choices: `dtmfTable` is the character table string; `N5RV` is also listed under `bf-f8hp` per spec 4.3; `FOREIGN_MAGICS` and `PROGRAM_MAGICS` landed as data in this slice.

### 002

- `identify` moves the pinned magic to the front, gives the first magic its second attempt after `SETTLE_MS`, owes `SCAN_SILENT_PAUSE_MS` or `SETTLE_MS` before the next attempt, probes unsupported magics without the closing `06` and runs no block read on their ident.
- `pin` compares against the magic the verbs select, `UV5R_MAGIC` or `291`.
- End-of-scan errors follow the plan: `protocol-reply-invalid` with the first invalid classic reply, else `session-unavailable` with retry `after-remedy`, an `answers` detail and a remedy without the word `identify`.
- The verb handshake remedy carries the grill text. SKILL.md stays at 60 lines.

### 003

- The foreign phase runs through the same `probe` helper without `confirm`. An 8-byte or 14-byte reply names the entry's radio. A foreign invalid reply joins `answers`.
- `programScan` switches the baud inside the `try`, sends each 16-byte magic in one write, reads one byte within 1200 ms, throws `radio-unsupported` with `powerCycle: true` on `06`, pauses `PROGRAM_PAUSE_MS` between entries and none after the last. The `finally` resets 9600 and keeps the first error.
- Accepted choices: foreign magics carry no name, so the `magic` field of their `radio-unsupported` holds the radio name. When only the reset to 9600 fails after a clean scan, `serial-io-failed` replaces `session-unavailable`.
- The silent-scan budget test lands at 58.98 s with the 1.2 s ack waits added. A staged foreign invalid reply puts real time near 59.1 s. The plan's table covers a silent cable.

### 004

- README only. Work items 6 and 7 are done: Ident, Classic magics, Foreign radios, `identify` timing subsections, and the `restore` row note.
- The bench steps ran later the same day. Results sit under Bench below.

## Sol adversarial review

GPT-6.1 Sol reviewed the 001 to 003 range at `c505c3b` through the codex skill. Two consensus rounds ran out of the three allowed. Sol found no correctness, wire or timing bug. Five findings are confirmed, one is rejected, none is unresolved.

| id | severity | where | claim | fix |
|---|---|---|---|---|
| S2 | minor | `src/cli/main.ts` `ERRORS_HELP` | `help --json` lists each reason as `exit N: means` with no retry value, so issue 001's criterion "retry `no`" is met by `REASONS` and the runtime error, and the help output shows only the exit code. The format predates the branch. | Left as is. Add `retry` to the reason strings if the help output needs it. |
| S3 | minor | `README.md` identify paragraph | Said the stderr attempt lines print always; they print in text mode. | Fixed on the 004 branch, commit `b66639d`. |
| S1 | nit | `test/core/fake.ts` | The fake acks program magics at any rate other than 9600; the plan says only at 115200. The `setBaud` call assertions still catch a wrong production rate. | Compare the rate against 115200. |
| R1 | nit | `.claude/skills/uv5r/SKILL.md` | "up to 59 s" holds for a silent radio. A radio that refuses or sends bad idents takes about 64 s. | Add "on a silent radio". |
| R2 | nit | `src/core/radio.ts` `scanFailed` | An ack followed by no ident bytes gives the message "with ident  of no known shape". | Print "no ident bytes" when `got` is empty. |

Rejected: the test-gap half of S1. The tests assert `setBaud` is called with `[[115200], [9600]]` and that each 115200 attempt reports `baud: 115200`. Sol conceded.

The full round log sits in the overseer's session scratchpad as `sol-review.md`.

## Bench, 2026-10-24

Firmware `HN5RV011` on the AIOC. The unit does not ack `ORIG`.

- `identify`: `291` acks first, `pin` null, 0.9 s.
- Radio off: exit 5, `session-unavailable`, empty `answers`, 59.3 s before the second attempts were added.
- `port.update` to 115200 and back ran with no error in three scans. No radio has answered at 115200.
- Dump criterion: the aux area and settings block match the 2026-10-12 fixture. The 72 differing bytes sit in slots the bench verbs wrote.
- Pinned `ORIG` before the second attempts: `291` silent on its single attempt in 2 of 15 runs. Every supported magic now gets a second attempt and the silent pause is 0. After that change, 20 of 20 pinned runs acked `291`.

## Open items

- S2: `help --json` reason strings gain the default retry, as `exit 5, default retry once: ...`, with a note that the error's `retry` field governs. Update the `^exit \d: ` test in `test/cli/cli.test.ts` and the README and SKILL.md lines that say help lists retry values.
- Pin remedy: when `UV5R_MAGIC` is set and a verb gets no ack, the remedy says to unset it and rerun before pointing at `uv5r identify`. Handshake site in `src/core/protocol.ts` and `src/core/radio.ts`.
- Bench unit: [rx-audio-investigation.md](rx-audio-investigation.md) concludes the radio since 2026-10-13 is a different unit or the same unit reprogrammed. The 2026-10-24 dump matches the 2026-10-12 fixture outside the 72 bytes and the 7-channel plan from 2026-10-13 is gone. Add a dated note there once Nigel confirms which radio is connected.
- 57600 and 38400 probes: dropped. The golden files get rebuilt from the reference UV-5Rs later.
