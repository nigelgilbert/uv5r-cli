# sweep has one unattended mode

**Type**: AFK

**Status:** 🔄 Implemented, awaiting review

## Parent

review.md, work item 2.

## What to build

`uv5r sweep PLAN.json [--seconds S] [--out-dir DIR] [--play] [--device NAME] [--floor DBFS] [--verbose]`. Knob mode, `--scratch`, `--check` and `--no-check` go, with `verifyPlanSlots`, `planRecord`, `Lines`, `readLines`, `knobSlot` and the stdin guard.

A plan takes a top-level `checkMhz`, validated like an entry `rxMhz` with errors naming `checkMhz`. `sweep` requires it and exits 2 before the port opens when it is missing. `load` ignores it. Every sweep runs a receive-only `check` on slot 0 with `checkMhz` for 5 s under the issue 008 threshold, then writes each entry into slot 0, waits for the reload and dwells. A failed check writes no plan entry. `--seconds` sets the dwell only.

Success, interrupted and error summaries carry `slot0`: `{channel, name}` of the last fully verified entry write, `{channel: null, name}` when only the check write succeeded, `null` when the contents are unknown. `channels.example.json`, the README plan fields table and the channel-plan skill gain `checkMhz`. The README, SKILL.md and help describe the one mode.

## Acceptance criteria

- [x] With FakeRadio, mocked `listen`, fake timers and non-TTY stdin, `sweep plan.json` succeeds with no flags; a 5 s check runs before 30 s dwells, every write targets slot 0, no stdin is read
- [x] A failed check writes no plan entry
- [x] `--scratch`, `--check` and `--no-check` each exit 2 before the transport opens
- [x] A plan without `checkMhz` makes `sweep` exit 2 and `load` succeed
- [x] Interrupted and error summaries carry `slot0` independent of finished dwells
- [x] No source, help, README, skill or test describes knob mode or its flags
- [x] `npm test` and `npm run typecheck` pass

## Blocked by

- #008

## Result

Files changed: `src/sweep.ts`, `src/main.ts`, `src/plan.ts`, `channels.example.json`,
`README.md`, `.claude/skills/uv5r/SKILL.md`, `.claude/skills/channel-plan/SKILL.md`,
`test/sweep.test.ts`, `test/plan.test.ts`.

- `runSweep(entries, steps, options, onDwell, progress, signals)` runs `steps.check`, then
  `steps.prepare` and `dwell` per entry. `slotZero` builds the steps. `SweepProgress` holds
  `dwells` and `slot0`; item 5 can add `written` there. `summarize(progress, seconds)`
  builds the summary for success, signal and error.
- The test for "no stdin is read" stubs a non-TTY stdin and asserts it gained no `data` or
  `readable` listener and never started flowing.
- The `test/sweep.test.ts` mentions of `--scratch`, `--check` and `--no-check` are the
  exit-2 and help-absence assertions.
- Deviation: the check runs inside the signal scope of `runSweep`. A signal during the
  check prints an interrupted summary with `slot0` for the check record and exits 128 plus
  the signal.
- Deviation: every error once the arguments pass prints the summary on stdout, including a
  failed port open (`swept: 0`, `slot0: null`) and a failed check.
- Deviation: `slot0.name` is the name read back from the radio after the write. For the
  check record that is the frequency, such as `162.4`.
- Deviation: `load` runs `parsePlan`, so a present but invalid `checkMhz` makes `load`
  exit 2. The docs say `load` checks `checkMhz` and writes nothing for it.
- Overlap with item 6: the rewritten SKILL.md sweep section drops the 2026-10-18 shell-loop
  history line.

Review fixes: `runSweep` plays each capture through `playDwell` after it pushes the dwell
to `progress.dwells` and calls `onDwell`. An afplay failure throws with the dwell already in
the summary, and the error carries `phase: 'play'`. Playback is skipped once a signal has
arrived, and a signal during playback is swallowed. `dwell(entry, options)` drops its `stop`
argument. Tests cover an afplay failure after the first dwell and a SIGINT during playback.
