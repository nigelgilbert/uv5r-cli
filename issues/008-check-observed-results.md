# check reports what it observed

**Type**: AFK

**Status:** 🔄 Implemented, awaiting review

## Parent

review.md, work item 1.

## What to build

`check` writes a receive-only record into slot N, waits for the reload, listens for 5..600 s and passes when at least 80% of the captured seconds are active. `--offset` and `--tone` exit 2 on `check`. `--seconds 1` exits 2 before the port opens. The result carries `slot` and `requestedMhz` in place of `channel` and `rxMhz`. Sweep dwell records and summary `active` entries keep the plan `channel`, replace `rxMhz` with `requestedMhz` and add `slot: 0`.

Success means audio above the floor after writing slot N, consistent with the radio receiving slot N. The exit-5 message lists the causes: VFO mode, another slot selected, volume knob down, plug unseated, quiet frequency. README, SKILL.md, the `checkChannel` doc comment and the sweep check error say the same. Docs state the slot state after a run: once the write succeeds, slot N stays overwritten and receive-only, also after a capture failure; a failure before or during the write leaves it unknown.

## Acceptance criteria

- [x] `check 162.400 --channel 0 --offset 0.6` exits 2 before the port opens
- [x] `check 162.400 --channel 0 --seconds 1` exits 2 before the port opens
- [x] A test with 3 of 5 active seconds exits 5 and 4 of 5 exits 0
- [x] The record `check` writes has `txMhz: null` whatever flags were given
- [x] `check` output has `slot` and `requestedMhz` and no `channel` or `rxMhz`
- [x] No doc, help text or message says `check` proves the mode or slot
- [x] `npm test` and `npm run typecheck` pass

## Blocked by

None - can start immediately

## Result

Files changed: `src/check.ts`, `src/main.ts`, `src/sweep.ts`, `README.md`,
`.claude/skills/uv5r/SKILL.md`, `test/check.test.ts`, `test/sweep.test.ts`.

- `checkChannel` writes `receiveOnly(spec)` and judges the capture with `judgeCheck`, which
  `sweep` shares. The pass rule is `activeSeconds >= Math.ceil(0.8 * active.length)` with a
  non-empty capture.
- `check` rejects `--offset` and `--tone` with a message that names the flag. It keeps
  `--rx-tone`, `--narrow`, `--name`, `--low-power` and `--rx-only`; `--rx-only` and
  `--low-power` change nothing on a receive-only record.
- The exit-5 message reads `slot N: A of T s active after writing F MHz, check needs K;
  causes: VFO mode, another slot selected, volume knob down, plug unseated, quiet
  frequency; ask the human to set MR mode and select slot N`. The detail carries the
  result fields.
- Deviation: the missing `--channel` error on `check` no longer says to read the number
  off the display, since slot 0 is the scratch slot. Item 4 sets the shared channel rule.
- Deviation: the `--seconds` and `--offset`/`--tone` usage errors carry a `flag` detail
  field.
