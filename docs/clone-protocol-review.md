# Review: clone protocol implementation

Date: 2026-10-24. Spec: [clone-protocol.md](clone-protocol.md).

## Branch

The work items, the second-attempt change, the review fixes, the cleanup pass and the bench results sit
on `feature/clone-protocol`. `npm run typecheck` and `npm test` pass.

## Overseer review

### 001

- `ident.ts` matches spec sections 4.1, 4.2, 4.3 and 9. `classify` runs the `HN5RV01` rule first, filters basetypes by the answering magic's families, keeps a single-family magic's family on no hit, applies the `orig` exclusions and never throws.
- `attempt` discards input, paces the magic at 10 ms, waits 1200 ms for the ack and reads the ident in one `read(14, 350)`. The serial transport returns at the deadline when fewer than 14 bytes arrive, so an 8-byte ident costs the same 350 ms as the old `sleep(300)` plus `read(12, 50)`.
- `Session.start` retries on `silent` and `wrong-ack`.
- `selectedMagic()` runs in `main.ts` before the port opens and reaches every session call site, `check.ts` and `sweep.ts` included.
- Accepted choices: `dtmfTable` is the character table string; `N5RV` is also listed under `bf-f8hp` per spec 4.3; `FOREIGN_MAGICS` and `PROGRAM_MAGICS` landed as data in this slice.

### 002

- `identify` moves the pinned magic to the front and gives the first magic its second attempt after `SETTLE_MS`. Before the next attempt it waits nothing after silence, `SCAN_WRONG_ACK_PAUSE_MS` after a wrong ack and `SETTLE_MS` after an invalid ident or a refused closing `06`. It probes unsupported magics without the closing `06` and runs no block read on their ident.
- `pin` compares against the magic the verbs select, `UV5R_MAGIC` or `291`.
- End-of-scan errors: `protocol-reply-invalid` with the first invalid classic reply, else `session-unavailable` with an `answers` detail. Empty `answers` gets the power-and-cable remedy with retry `after-remedy`. Non-empty `answers` gets the remedy to report the answers to the human with retry `no`. Neither remedy names `identify`.
- The verb handshake remedy carries the grill text. SKILL.md stays at 60 lines.

### 003

- The foreign phase runs through the same `probe` helper without `confirm`. An 8-byte or 14-byte reply names the entry's radio. A foreign invalid reply joins `answers`.
- `programScan` switches the baud inside the `try`, sends each 16-byte magic in one write, reads one byte within 1200 ms, throws `radio-unsupported` with `powerCycle: true` on `06`, pauses `PROGRAM_PAUSE_MS` between entries and none after the last. The `finally` resets 9600 and keeps the first error.
- Accepted choices: foreign magics carry no name, so the `magic` field of their `radio-unsupported` holds the radio name. When only the reset to 9600 fails after a clean scan, `serial-io-failed` replaces `session-unavailable`.
- The silent-scan budget test lands at 29 s with the 1.2 s ack waits added.

### 004

- README only. Work items 6 and 7 are done: Ident, Classic magics, Foreign radios, `identify` timing subsections, and the `restore` row note.
- The bench steps ran later the same day. Results sit under Bench below.

## Sol adversarial review

GPT-6.1 Sol reviewed the 001 to 003 range at `c505c3b` through the codex skill. Two consensus rounds ran out of the three allowed. Sol found no correctness, wire or timing bug. Five findings are confirmed, one is rejected, none is unresolved.

| id | severity | where | claim | fix |
|---|---|---|---|---|
| S2 | minor | `src/cli/main.ts` `ERRORS_HELP` | `help --json` lists each reason as `exit N: means` with no retry value. `REASONS` and the runtime error carry the retry. The format predates the branch. | Help format kept. README and SKILL.md now say help lists the reasons and the retry meanings. |
| S3 | minor | `README.md` identify paragraph | Said the stderr attempt lines print always; they print in text mode. | Fixed on the 004 branch, commit `b66639d`. |
| S1 | nit | `test/core/fake.ts` | The fake acks program magics at any rate other than 9600; probe step 4 in [clone-protocol.md](clone-protocol.md) specifies 115200. The `setBaud` call assertions still catch a wrong production rate. | Fixed. The fake compares the rate against 115200. |
| R1 | nit | `.claude/skills/uv5r/SKILL.md` | The scan time holds for a silent radio. A radio that refuses or sends bad idents takes longer. | Fixed. SKILL.md says "about 29 s on a silent radio". |
| R2 | nit | `src/core/radio.ts` `scanFailed` | An ack followed by no ident bytes gives the message "with ident  of no known shape". | Fixed. The message says "no ident bytes" when `got` is empty. |

Rejected: the test-gap half of S1. The tests assert `setBaud` is called with `[[115200], [9600]]` and that each 115200 attempt reports `baud: 115200`.

## Bench, 2026-10-24

Firmware `HN5RV011` on the AIOC. The unit does not ack `ORIG`.

- `identify`: `291` acks first, `pin` null, 0.9 s.
- Radio off: exit 5, `session-unavailable`, empty `answers`.
- `port.update` to 115200 and back ran with no error in three scans. No radio has answered at 115200.
- Dump criterion: the aux area and settings block match the 2026-10-12 fixture. The 72 differing bytes sit in slots the bench verbs wrote.
- Pinned `ORIG` with a single attempt per magic: `291` silent in 2 of 15 runs. With a second attempt per supported magic and no silent pause, 20 of 20 pinned runs acked `291`.

## Open items

- Bench unit: settled on 2026-10-24, see [rx-audio-investigation.md](rx-audio-investigation.md). The radio on the bench is the 2026-10-12 fixture unit.
- Golden files: rebuilt from the reference UV-5Rs on 2026-10-25, see [golden-set-plan.md](golden-set-plan.md).
