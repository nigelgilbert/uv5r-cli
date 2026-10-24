# `identify` verb: foreign 9600 probes and the 115200 phase

**Type**: AFK

**Status:** ✅ Done

## Parent

[docs/clone-protocol-plan.md](../docs/clone-protocol-plan.md), slice 3. Read nothing under `docs/chirp-notes/` and nothing from the Chirp repo.

## What to build

When every classic magic fails, `identify` continues with two more phases. First it sends each of the five foreign 9600 magics as a probe without the closing ack; an ident of 8 or 14 bytes names that radio and stops with `radio-unsupported`. Silence and wrong acks pause `SCAN_SILENT_PAUSE_MS`, an invalid reply pauses `SETTLE_MS`. Then it switches the port to 115200 and sends each 16-byte `PROGRAM...U` magic in one write; a single `06` names the UV17Pro model group and stops with `radio-unsupported`, `powerCycle: true` and the power-cycle remedy, since the radio sits in program mode with no exit command. Silence pauses `PROGRAM_PAUSE_MS`, with no pause after the last magic. The baud returns to 9600 in a `finally` that keeps the first error.

`Transport` gains `setBaud(rate)`. The serial transport changes the rate on the open port and maps a failure to `serial-io-failed`. The fake records its rate, answers classic and foreign magics only at 9600 and program magics only at 115200, and gains a foreign magic with a foreign ident and a program magic. A foreign invalid reply joins the `answers` detail of the final `session-unavailable`. The per-attempt stderr line shows the baud. The help entry and README timing text cover the full 59 s budget.

## Acceptance criteria

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] A test acks the UV-5X3 magic with a 14-byte ident; the result names BTECH UV-5X3 and the fake received no closing `06` after the ident.
- [ ] A test acks an 8-byte foreign ident for the UV-6R magic and names the UV-6R.
- [ ] A test acks `PROGRAMBFNORMALU` at 115200 only; the result names the UV17Pro group with `powerCycle: true` and the power-cycle remedy, and the fake's rate is 9600 after return.
- [ ] A test fails `setBaud` on the way back and the error from the scan is the first error raised.
- [ ] `transport.test.ts` covers `setBaud` success and a `serial-io-failed` rejection through the fake port.
- [ ] Silence through all three phases under fake timers gives `session-unavailable` with elapsed time within the plan's 59 s budget and an `answers` list containing a foreign invalid reply when one was staged.
- [ ] The `identify` help text and the README state the budget.

## Blocked by

- #002
