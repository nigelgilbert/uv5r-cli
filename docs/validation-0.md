# Validation 0: `uv5r volume`

Target: diff `2fe5507..9d6d898` on `feature/volume-verb`. References:
[plan-volume.md](plan-volume.md) and [swarm-report-0.md](swarm-report-0.md).

**Verdict: ready after fixes.** The code meets the plan and restores squelch on every path the
plan lists; the fixes are four gaps in tests, `docs/errors.md` and the swarm report, and nine nits.

## Answers to the questions put to the run

1. `WithPort` is sound. The handlers go in before the open, as plan step 2 asks. A signal during
   the open sets the flag, the callback returns before any radio traffic, the port closes and the
   verb exits 128 plus the signal. An open that rejects throws its own error, which carries an
   accurate remedy.
2. The restore runs after a lost ack, a capture error, a signal and a step 4 verification
   failure. Every error from the write, the read-back, the capture and the restore carries
   `squelch` and the remedy once the kept squelch is above 0. `retry: 'after-remedy'` is right: a
   rerun at squelch 0 keeps 0 and skips the restore. Skipping the detail at kept squelch 0 is
   right: the verb wrote nothing, and the remedy would replace the error's own with a no-op.
3. `Number(...)` is needed. `Settings` is `Record<SettingName, number | string>` and `kept` is a
   number. Squelch has no value names, so `Number` is the identity at runtime. The comment is one
   accurate sentence. Keep both.
4. `knob mode` loosens the guard. See item 5.
5. All eight instruction sentences match the States table verbatim. The rows apply in table
   order, and the clip warning wins at every RMS including null. The floor row uses `<=`, which
   matches the `db > floor` rule `listen` uses for an active second. Style nits are items 6 to 10.
6. Two claims in the swarm report fail. See items 4 and 13. `npm run typecheck` is clean and
   `npm test` passes 37 files and 928 tests at `9d6d898`.

## Findings

### Gaps

1. **Restore tests read only squelch 3**
   - Location: `test/cli/volume.test.ts:145` and `:243`.
   - Problem: Every restore test starts at the FakeRadio default squelch 3 and expects 3 back. A
     restore that hard-codes 3 passes the file.
   - Evidence: only `radio.eeprom[SQUELCH_AT] = 0` is ever set. The assertions read
     `expect(radio.eeprom[SQUELCH_AT]).toBe(3)` and `remedy: 'run uv5r settings squelch 3'`.
   - Fix: in the flow test at `:145`, set `radio.eeprom[SQUELCH_AT] = 7` before the run and assert
     the byte ends at 7. In the restore-failure test at `:243`, set it to 7 and assert
     `squelch: 7` and `remedy: 'run uv5r settings squelch 7'`.
   - Settled: exchange 1.

2. **No test for an error at kept squelch 0**
   - Location: `test/cli/volume.test.ts`, after `:183`.
   - Problem: No test covers a failure when the kept squelch is 0. Code that always called
     `withSquelch` passes the file.
   - Evidence: the only `not.toHaveProperty('squelch')` is at `:288`, for ffmpeg failures before
     the port opens. The branch under test is `volume.ts:139-142`.
   - Fix: add a test with `radio.eeprom[SQUELCH_AT] = 0` and `listenMock` rejecting with
     `TransportError('capture-incomplete', ...)`. Assert exit 3, `radio.writes` equal to `[]`, no
     `squelch` in the error, and `remedy` equal to `REASONS['capture-incomplete'].remedy`.
   - Settled: exchange 1.

3. **`docs/errors.md` leaves out `volume`**
   - Location: `docs/errors.md:15-22` and `:26-29`.
   - Problem: The detail-field list has no `squelch` entry. The Signals section names `key`, `say`,
     `id`, `sweep` and `hear` and leaves out `volume`, which prints no result.
   - Evidence: the list covers `slot`, `summary`, `phase`, `channel`, `requestedMhz`, the check
     fields, `assertedAtMs` and `releasedAtMs`.
   - Fix: add the bullet "- A `volume` error from the squelch write, the read-back, the capture or
     the restore, after it reads a squelch above 0, adds `squelch`, the kept value. The `remedy`
     writes it back." Add the Signals paragraph "On the same signals `volume` stops the capture,
     writes the kept squelch back, prints no result and exits 128 plus the signal number. A failed
     restore exits with its own error."
   - Settled: exchange 1.

4. **Swarm report test counts**
   - Location: `docs/swarm-report-0.md:19` and `:27`.
   - Problem: The report says two existing tests changed and `volume.test.ts` holds 36 tests. Three
     existing tests changed across two files, and the file holds 37.
   - Evidence: `npx vitest run test/cli/volume.test.ts` prints `Tests  37 passed (37)`. The
     `cli.test.ts` edits sit in the tests at `:211` and `:292`, and `sweep.test.ts` changes one.
   - Fix: "Two existing tests changed." becomes "Three existing tests changed across two files."
     "Tests: 36" becomes "Tests: 37".
   - Settled: initial round, raised by both.

### Nits

5. **The `knob mode` guard misses the old prompt wording**
   - Location: `test/cli/sweep.test.ts:574-575`.
   - Problem: The removed sweep mode printed "prompting for the knob" and "turn the knob to channel
     N". `knob mode` lets those return. The three flag guards still catch the mode.
   - Evidence: `for (const word of ['knob mode', '--scratch', '--check', '--no-check']) expect(help).not.toContain(word);`
     The overview today holds "knob" only in "volume knob".
   - Fix: delete the comment at `:574`. Check `['--scratch', '--check', '--no-check']` with
     `not.toContain` and add `expect(help).not.toMatch(/(?<!volume )knob/);`.
   - Settled: initial round, raised by both; fix settled in exchange 1.

6. **Text labels misalign**
   - Location: `src/cli/main.ts:1506-1508`.
   - Problem: `state      ` and `rms        ` are 11 columns and `instruction ` is 12, so the values
     start one column apart. The `${rms} dBFS` branch has no test.
   - Evidence: `listen` pads its labels to 11 columns at `main.ts:1377-1379`.
   - Fix: pad the labels to `state       ` and `rms         `. Update the terminal test at
     `volume.test.ts:185`. Add a terminal case with `heard(-25)` that expects
     `rms         -25 dBFS`.
   - Settled: exchange 1.

7. **Provisional effect repeats the band**
   - Location: `src/cli/main.ts:745`.
   - Problem: The effect before it gives the band edges, and this effect gives them again.
   - Evidence: `` `The band ${TARGET_LOW_DBFS}..${TARGET_HIGH_DBFS} dBFS is provisional until a bench pass with live speech sets it.` ``
   - Fix: "The band is provisional until a bench pass with live speech sets it." Update the
     expectation in the help test at `volume.test.ts:303`.
   - Settled: exchange 1.

8. **Global signal exit line leaves out `volume`**
   - Location: `src/cli/main.ts:159`.
   - Problem: The `128+signal` line names what each signal-aware verb does and leaves out `volume`.
   - Evidence: `'interrupted by SIGINT, SIGTERM, SIGHUP or SIGTSTP: key, say and id release PTT, and sweep and hear print their summary'`
   - Fix: append "; volume restores squelch and prints no result".
   - Settled: exchange 1.

9. **`receive.md` names one error case of four**
   - Location: `docs/receive.md:19-20`.
   - Problem: The sentence names only a failed restore. The code adds `squelch` and the remedy to
     errors from the write, the read-back, the capture and the restore.
   - Evidence: "A failed squelch restore errors with `squelch` and the remedy
     `run uv5r settings squelch N`."
   - Fix: "Once `volume` reads a squelch above 0, an error from the squelch write, the read-back,
     the capture or the restore carries `squelch` and the remedy `run uv5r settings squelch N`."
   - Settled: exchange 2.

10. **README setup step 3 runs long**
    - Location: `README.md:67-70`.
    - Problem: The step runs five sentences, and "It reads 2 s of open-squelch static, puts the
      squelch back and prints an `instruction`." restates `docs/receive.md`.
    - Fix: "3. Set the macOS input volume of `AIOC Audio` to 100 percent and put the radio on a
      quiet channel. Run `uv5r volume`, turn the knob as its `instruction` says and run it again
      until `state` is `ok`. Then run `uv5r settings squelch 3`. At squelch 0, static reads as
      audio."
    - Settled: exchange 1.

11. **Lost-ack test holds without a restore**
    - Location: `test/cli/volume.test.ts:216-225`.
    - Problem: `refuseWriteAt` drops the write before it stores, so the squelch byte stays 3 and
      `expect(radio.eeprom[SQUELCH_AT]).toBe(3)` holds with no restore. A write that lands and
      loses its ack is not modelled.
    - Evidence: `src/core/fake.ts:255`: `if (addr === this.refuseWriteAt) continue; this.store(addr, data);`
    - Fix: add a FakeRadio field that stores the write at an address and withholds its ack. Use it
      in this test, so the byte holds 0 after the first write, and keep the assertion that it
      reads 3 at the end.
    - Settled: exchange 1.

12. **`readVolume` test asserts `exit.ts`**
    - Location: `test/cli/volume.test.ts:329`.
    - Problem: `expect(signalExitCode('SIGTERM')).toBe(143);` tests the exit mapping and passes
      whatever `readVolume` does. The SIGINT test at `:227` covers the exit through the CLI.
    - Fix: delete the line and the `signalExitCode` import, which has no other use.
    - Settled: exchange 1.

13. **Swarm report recipe claim**
    - Location: `docs/swarm-report-0.md:41-42`.
    - Problem: The dated setup notes keep level readings. The recipe text is gone.
    - Evidence: "The dated setup notes keep the old recipe as the record."
      `grep -n -- "-20 to -12" docs/bench-two-station.md` prints nothing.
    - Fix: "The dated setup notes keep the level readings taken under the old recipe."
    - Settled: exchange 1.

## Disagreements

None.

## Findings dropped

- Codex C1, decorate errors at kept squelch 0: withdrawn by Codex in exchange 1. The verb writes
  nothing at 0, and the remedy would replace the error's own with a no-op.
- Codex C2, return the signal when the open rejects after one: withdrawn by Codex in exchange 1.
  The open error is independent of the signal and carries an accurate remedy.
- Codex C3, decorate a port-close error: withdrawn by Codex in exchange 1. The close runs after
  the restore verifies, and its remedy warns that PTT may be high.
- Exit 0 wording "a knob that needs turning is the expected result": withdrawn by Opus in
  exchange 1. The plan's Exits section is its source.
- `WithPort` shares a name with `src/tts/speak.ts:116`: withdrawn by Opus in exchange 1. The
  shapes differ, and sharing the type couples `volume` to TTS.
- Keep the original remedy after a good restore: contradicts the plan's Exits section, which puts
  the squelch remedy on every error after step 3.
- Add a `restoreError` detail when the step and the restore both fail: the plan says the error
  that caused the failure keeps its kind, and the restore error adds no action.
- Drop `code: 0` from the `exits` list: the plan lists exit 0.
- Use `CAPTURE_DEVICE_FLAG`: its help says "passes the check", which fits `check` only.
- More signal timing tests (during the read-back, before `listen` starts, `listen` resolving
  after a signal): the plan's signal case is covered, and the code needs no change.
- Assert the `volume` flag list in `cli.test.ts`: no rule or plan item asks for it.

## Run

- Angles: readVolume correctness and the restore; conformance to the plan; test coverage; docs,
  help text and comments against the style rules; swarm report claims at `9d6d898`.
- Agents: 5, one per angle, model Sonnet, read-only.
- Reviewer: Codex `sol`, one independent review and 2 exchanges.
