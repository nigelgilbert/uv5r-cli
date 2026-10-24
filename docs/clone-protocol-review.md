# Review: clone protocol implementation, issues 001 to 004

Date: 2026-10-24. Plan: [clone-protocol-plan.md](clone-protocol-plan.md). Spec: [clone-protocol.md](clone-protocol.md).

## Branches

Each issue landed on its own branch, stacked on the previous one. Nothing is merged into `main`.

| Issue | Branch | Tip | Base | Tests |
|---|---|---|---|---|
| 001 magic table, `Session.start(magic)`, `UV5R_MAGIC` | `feature/001-magic-table` | `086507b` | `d5b439e` (main) | 520 |
| 002 `identify` classic scan | `feature/002-identify-classic` | `8e2bb3c` | `086507b` | 540 |
| 003 foreign probes and 115200 phase | `feature/003-identify-foreign-115200` | `c505c3b` | `8e2bb3c` | 553 |
| 004 README protocol notes | `feature/004-bench-and-readme-notes` | `1878f32` | `c505c3b` | 553 |

`npm run typecheck` and `npm test` pass at every tip. The overseer reran both on each branch.

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

- README only. Work items 6 and 7 are done: Ident, Classic magics, Foreign radios, `identify` timing and Bench questions subsections, and the `restore` row note.
- Every bench step was skipped. No AIOC was attached at any point during the run. The issue status reads Partial. Both bench questions carry "Not measured yet" with the command to run.

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

## Open items

- Bench verification for 004 is complete. On 2026-10-24 `uv5r identify` with the radio off exited 5 with `session-unavailable` and empty `answers` in 59.3 s. The dump criterion is ticked: the aux area and settings block match the fixture and the 72 differing bytes sit in slots the bench verbs wrote.
- Stale pin: in 2 of 15 pinned scans `291`, second in the order, stayed silent on its single attempt and the scan ran to `session-unavailable`. Unpinned `identify` and `status` never failed. A second attempt for every supported magic would cover it at the cost of budget.
- Issue 005 proposes `SCAN_SILENT_PAUSE_MS` at 0 from the pause test.
- `port.update({ baudRate })` ran on the AIOC in two full `identify` scans on 2026-10-24 with no error. No radio has answered at 115200.
- S2: decide whether `help --json` reason strings gain a retry value.
