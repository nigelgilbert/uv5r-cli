# Review 5: PR #1, feature/improve-cli-for-small-models

Date: 2026-10-23

This review covers the branch at commit bccf35d. The `/code-review` pass reported nine findings. An adversarial reviewer tried to refute each one against the source, and Astra cross-checked them through the codex skill. Five survived. None rates above severity 2.

Items run from highest to lowest priority. Fix items 1 and 2 before merge. Items 3 to 5 are optional.

## Findings

### 1. A failed rename mid-sweep exits 2 as a usage error

Location: [src/sweep.ts:134-141](src/sweep.ts#L134-L141), [src/main.ts:98](src/main.ts#L98), [src/main.ts:419](src/main.ts#L419)

When the `.part` to `.wav` rename fails, `runSweep` throws `UsageError` with reason `invalid-argument` and retry `after-remedy`. The failure is an I/O error after slot 0 is written. The exit table says exit 2 means argument errors that exit before the port opens. The sweep help documents this exit 2, so the two texts disagree.

Failure scenario: the `--out-dir` disk fills or its permissions change during a sweep. The CLI exits 2, and the `invalid-argument` guidance tells the agent to fix the command and rerun. Slot 0 is already rewritten and the dwell's audio is lost.

Fix: throw an I/O error with a non-usage reason. Update the sweep help line to match.

### 2. Review notes are committed at the repo root

Location: [review-4.md](review-4.md)

bccf35d adds `review-4.md`, 78 lines of review notes for this PR. Its line references go stale once the findings are fixed.

Fix: remove it from the branch before merge. Keep review notes in the PR discussion.

### 3. A missing ffmpeg leaves an empty output directory

Location: [src/main.ts:873-886](src/main.ts#L873-L886), [src/main.ts:151](src/main.ts#L151)

`sweepVerb` runs `mkdirSync(outDir)` before `checkFfmpeg`. The new `FFMPEG_FIRST` text says a missing ffmpeg exits 3 "with nothing written". That phrase refers to the radio, and the radio is untouched. main also created the directory first, but had no ffmpeg check to contradict.

Failure scenario: `uv5r sweep plan.json --out-dir rx` with no ffmpeg on PATH creates `rx/` and exits 3.

Fix: call `checkFfmpeg` before `mkdirSync`.

### 4. Sweep check errors omit `requestedMhz`

Location: [src/sweep.ts:174-182](src/sweep.ts#L174-L182), [src/check.ts:71-85](src/check.ts#L71-L85), [src/sweep.ts:248](src/sweep.ts#L248)

`checkChannel` wraps capture errors with `withDetail(err, { slot: n, requestedMhz })`. The sweep's copy of the check adds `slot` through `runSweep` but never adds `requestedMhz`. The same capture failure carries different fields in `check` and `sweep`.

Fix: add `requestedMhz` to the sweep's error detail. The shared steps are already factored into `refuseOpenSquelch`, `receiveOnly` and `judgeCheck`, so a single helper is optional.

### 5. "detail fields" reads as a key name

Location: [src/main.ts:108](src/main.ts#L108), [src/errors.ts:213-215](src/errors.ts#L213-L215)

The error guidance says the error JSON carries "reason, message, remedy, retry and detail fields". `toJSON` spreads detail at the top level, with no `detail` key. An agent may read `err.detail.slot` and get undefined.

Fix: say the detail fields sit at the top level of the error object.

## Checked and left alone

- The stale `slot` in `loadVerb` ([src/main.ts:641-656](src/main.ts#L641-L656)). `SerialTransport.close()` swallows its errors ([src/transport.ts:123-128](src/transport.ts#L123-L128)), and nothing that can throw runs after the last verified write.
- `progress.slot0 = null` before a squelch refusal ([src/sweep.ts:164-172](src/sweep.ts#L164-L172)). `newProgress` already sets it to null, and the refusal message says slot 0 was not written.
- Dropping `kind` from the error JSON. Commit 780d1d7 made the change, and [test/errors.test.ts:57](test/errors.test.ts#L57) asserts it is absent.
- Rejecting `--json --json` ([src/args.ts:17-20](src/args.ts#L17-L20)). It stops a repeated valued flag from silently overriding the first, and [test/args.test.ts:33](test/args.test.ts#L33) covers it.
- Stop handlers piling up on `stop.stopped` ([src/audio.ts:340-345](src/audio.ts#L340-L345), [src/protocol.ts:33](src/protocol.ts#L33)). A 128-entry sweep holds about 258 small closures. The callback already drops `child`, and main's `Promise.race` settle had the same pattern.

## Decision log

Resolved in a grill session on 2026-10-23.

### 1. Mid-run file write failures

- Add `file-write-failed` to `TransportReason` in [src/errors.ts](src/errors.ts). It exits 3, with `retry: 'after-remedy'`.
- Throw it from the sweep rename at [src/sweep.ts:139](src/sweep.ts#L139). Remedy: "pass --out-dir with a writable directory that has free space".
- Throw it from dump's post-read `writeFileSync` at [src/main.ts:735](src/main.ts#L735). Remedy: "pass --out with a writable path that has free space". The pre-port probe at lines 718-722 stays a `UsageError`.
- Add the errno as a `code` detail field on both, beside `out` (and `part` for sweep).
- Add "a failed file write" to the exit 3 line in `EXIT_CODES`.
- Move the sweep exits entry at [src/main.ts:419](src/main.ts#L419) and the dump exits entry at [src/main.ts:320](src/main.ts#L320) from exit 2 to exit 3.
- Add tests for both paths.

### 2. Committed review notes

Parked. Nigel cleans up review files before merge.

### 3. Empty output directory on a missing ffmpeg

- Move `checkFfmpeg()` in `sweepVerb` after the `checkMhz` validation and before `mkdirSync`. Argument errors still exit 2 first.
- Add a test that DIR does not exist after the exit 3.
- The `check` verb writes nothing to disk before its ffmpeg check, so it stays as it is.

### 4. `requestedMhz` on sweep errors

- Add `requestedMhz` to every sweep loop error.
- `slotZero().check` adds the `checkMhz` frequency.
- `runSweep` tracks the entry's frequency next to `channel` and adds it in the entry and dwell phases.
- `SweepSteps` stays unchanged.
- Name the field in the `runSweep` docstring and in `ERROR_GUIDANCE`.

### 5. Error shape wording

Replace the first sentence of `ERROR_GUIDANCE` with: "A failed command prints one error object on stderr when output is JSON, piped or with --json. The object has reason, message, remedy and retry, and each detail field below sits at its top level beside them."
