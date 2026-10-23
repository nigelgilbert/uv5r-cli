# Review: PR #1, feature/improve-cli-for-small-models

Date: 2026-10-22

Reviewed by Claude, then cross-checked against the code by GPT-6 Astra. The findings below are the agreed list. All 307 tests pass.

## Bugs and doc mismatches

### 1. `key` acquisition failures tell the agent to unplug the AIOC

Location: [src/main.ts:737](src/main.ts#L737), [src/main.ts:329](src/main.ts#L329)

`keyVerb` tags every error from before `holdPtt` with `released: false`, `phase: 'open'` and `retry: 'no'`. It decides this by checking whether the error detail has `pttAsserted`. The README, SKILL.md and help say `released: false` means "ask the human to unplug the AIOC".

Two kinds of error reach this branch:

- Acquisition failures: `resolveTarget` finds no AIOC, no device exists at the path, or `port.open` fails as busy or denied. The port never opened, so DTR never rose.
- Initial release failures: `SerialTransport.open` ([src/transport.ts:82](src/transport.ts#L82)) opens the port, which raises DTR, then calls `setPtt(false)`. When that call fails, PTT state is unknown. `released: false` and `retry: 'no'` are correct here.

Failure scenario: run `uv5r key --seconds 2` with no AIOC plugged in. The error carries `released: false` and `retry: 'no'`. An agent following the docs asks the human to unplug a cable that is not connected. `retry: 'no'` also blocks a rerun after the human plugs it in.

The `key` help also says phase `open` means the port did not open. An initial release failure uses that phase after the port opened.

Fix: tag acquisition failures from `args.open` with `released: true` and keep the reason's `retry`. Keep `released: false` and `retry: 'no'` for a failed initial `setPtt(false)`. Give that case its own phase, or reword the help to cover it.

### 2. `help` and `--version` print text when piped

Location: [src/main.ts:522](src/main.ts#L522), [src/main.ts:927](src/main.ts#L927)

`printHelp` and the `--version` branch emit JSON only for an explicit `--json`. The output rule that help prints says stdout is JSON when piped.

Failure scenario: an agent runs `uv5r help tune | jq .flags` and gets text. Every other verb gives JSON through a pipe, so the agent's `JSON.parse` fails.

Fix: call `wantsJson(flags)` in both places. This keeps `--text` working.

### 3. `written` has two entry schemas and the docs describe one

Location: [src/main.ts:689](src/main.ts#L689), [src/sweep.ts:78](src/sweep.ts#L78)

For `load`, `written` is an array of `ChannelResult` records that include `channel`, `rxMhz` and `name`. For `sweep`, it is an array of `SweepWrite` records: `{phase, slot, requestedMhz, channel}`. In sweep entries `channel` is the plan channel and `slot` is the physical memory. The README, SKILL.md and `ERROR_GUIDANCE` describe both as "the fully verified writes in order". The help JSON gives no schema for either.

Failure scenario: an agent learns to read `written[i].rxMhz` from a `load` failure. On a `sweep` failure that field is `undefined`.

Fix: document both entry schemas in the help JSON, README and SKILL.md.

### 4. Exit 6 docs omit the sweep summary on stdout

Location: [src/main.ts:909](src/main.ts#L909), [src/main.ts:450](src/main.ts#L450)

Once `transportAsked` is set, `sweepVerb` prints the summary so far for any error. A busy port (exit 6) gets `{swept: 0, seconds: 30, active: [], warnings: [], slot0: null}` on stdout. The exit table documents a stdout summary for codes 3, 4 and 5. Exit 3 already covers "no device" before any write.

Fix: add the stdout summary to the exit-6 entry.

### 5. `help help` fails

Location: [src/main.ts:937](src/main.ts#L937), [src/main.ts:488](src/main.ts#L488)

The text overview lists `help` as a verb. `isVerb` only knows the verbs table, so `uv5r help help` exits 2 with "unknown help subject".

Fix: accept `help` as a help subject that prints the overview.

### 6. Error-contract docs overstate which errors carry the fields

Location: [src/main.ts:678](src/main.ts#L678), [src/main.ts:869](src/main.ts#L869), [src/main.ts:101](src/main.ts#L101)

- `checkFlags` runs before the `try` in `loadVerb` and `sweepVerb`. An unknown flag error carries no `written`.
- `key` usage errors carry no `pttAsserted`, `released` or `phase`. README.md:83 and SKILL.md:59 say "a `key` error carries" them.
- `EXIT_CODES['2']` says argument errors exit before the port opens. `dump` raises its unwritable `--out` error after reading the radio. The `dump` exit entry does mention it.

Fix: say these fields come with execution errors and that validation errors omit them. Narrow the exit-2 sentence to match `dump`.

### 7. `check` capture failure omits the verified write

Location: [src/check.ts:63](src/check.ts#L63), [src/main.ts:665](src/main.ts#L665)

`checkChannel` writes a receive-only record, then settles and listens. If ffmpeg is missing or capture fails, the error carries no `slot`, `requestedMhz` or write status. The caller passed `--channel N` and the docstring says slot N keeps the record. The error still never says the write verified. After this PR, `load` and `sweep` errors do.

Fix: attach `{slot, requestedMhz, written: true}` to errors from the settle and listen steps.

## Follow-ups

### 8. Missing `afplay` aborts a sweep partway

Location: [src/sweep.ts:151](src/sweep.ts#L151), [src/audio.ts:230](src/audio.ts#L230)

This predates the PR. The PR moved the code into `playDwell` without adding a preflight.

Failure scenario: run `uv5r sweep plan.json --out-dir rx --play` on a host without `afplay`. The check passes and channel 1 is active and captured. `play` throws `dependency-missing` and the sweep exits 3. The rest of the plan is never swept.

Fix: check for `afplay` before the sweep starts when `--play` is set.

## Nits

### 9. The check sequence appears twice

Location: [src/check.ts:62](src/check.ts#L62), [src/sweep.ts:173](src/sweep.ts#L173)

`slotZero.check` repeats `checkChannel`: write `receiveOnly(spec)`, settle, listen, `judgeCheck`. The sweep copy also records progress and cuts the settle short on a signal. Both already share the step functions.

Optional: extract one helper if it keeps progress tracking and the interruptible settle.

### 10. The sweep's check spec spells out defaults

Location: [src/main.ts:894](src/main.ts#L894)

`sweepVerb` builds `checkSpec` with every default and `rxOnly: true`. `slotZero.check` applies `receiveOnly` again, and `encodeChannel` supplies the tone, bandwidth and power defaults.

Fix: pass `{ rxHz: plan.checkHz }`.

## Dropped

- Constant `slot` fields in `DwellRecord`, `ActiveEntry` and `SweepWrite`. The field names the physical memory in JSON output, apart from the plan `channel`.
