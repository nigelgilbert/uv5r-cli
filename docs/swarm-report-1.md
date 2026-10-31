# Swarm report 1: validation 0 fixes

Work file: [validation-0.md](validation-0.md). Base commit `d02cdb9` on `feature/volume-verb`.
Two Opus agents ran, one for code and tests and one for docs. Each ran in its own worktree
from the base commit.

## Items

### Code and tests: items 1, 2, 5, 6, 7, 8, 11, 12

Landed in `241be94`, merged in `2ad9f8a`.

- 1: the flow test and the restore-failure test start at squelch 7 and assert 7, `squelch: 7`
  and the remedy with 7.
- 2: new test at kept squelch 0 with a `capture-incomplete` capture. Exit 3, no writes, no
  `squelch`, the reason's own remedy.
- 5: the sweep overview test checks the three flags with `not.toContain` and `knob` with
  `/(?<!volume |a )knob/`. The write-up's regex `/(?<!volume )knob/` matched the `volume` exit
  0 text "a knob that needs turning", which the plan keeps.
- 6: `volumeText` labels pad to 12 columns. The terminal test is updated and a `-25 dBFS`
  case is added. The docstring now says "with aligned values".
- 7: the provisional effect drops the band values. Help test updated.
- 8: the `128+signal` line names `volume`. The pinned string in `parse.test.ts` is updated.
- 11: `FakeRadio.unackedWriteAt` stores a write and withholds its ack. The lost-ack test sets
  it to the settings commit address 0x0E40, since the fake stages the 0x0E20 block until the
  commit and a lost ack at `SQUELCH_AT` would leave the byte at 3. The test asserts squelch 0
  at the second handshake, two full settings commits and 3 at the end.
- 12: the `signalExitCode` assertion and import are gone.

### Docs: items 3, 4, 9, 10, 13

Landed in `8ae5b47` with the write-up's wording. `errors.md` gains the `squelch` detail bullet
and the `volume` Signals paragraph. `receive.md` names the four error cases. README step 3 is
three sentences. `swarm-report-0.md` reads 37 tests, three changed tests and the level
readings claim.

## Checks on the final commit

- `npm run typecheck`: clean.
- `npm test`: 37 files, 930 tests passed.

## Findings dropped

None.

## Open items

- The bench pass in plan-volume.md "Setting the band". Sets the two constants and adds the
  issue 001 rows.
