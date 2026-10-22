# Failures are recoverable

**Type**: AFK

**Status:** 🔄 Implemented, awaiting review

## Parent

review.md, work item 5.

## What to build

Every error carries `reason` from one enum: `device-unavailable`, `serial-io-failed`, `ptt-control-failed`, `dependency-missing`, `audio-process-failed`, `capture-incomplete`, `session-unavailable`, `protocol-reply-invalid`, `write-unacknowledged`, `verification-failed`, `image-incompatible`, `audio-inactive`, `invalid-argument`, `device-busy`, `serial-timeout`, `unexpected-error`. `kind` and the existing detail fields stay. Each error site adds a machine-readable remedy and retry guidance. A post-write verify failure uses `verification-failed` and its remedy accounts for any known partial write.

`load` and `sweep` errors carry `written`: the fully verified writes in order. For `sweep` that is the check write and each slot 0 entry write, each with `phase`, `slot`, `requestedMhz` and plan `channel` (`null` for the check), tracked separately from finished dwells. The failing slot, `phase` and any known partial write are separate fields. On a `sweep` error the finished dwells print as the summary on stdout and the error on stderr. The name failure splits into `channel N record written; name did not take the write` with `recordWritten: true`.

## Acceptance criteria

- [x] Every `BaofengError` constructed in src/ carries a `reason` from the enum
- [x] A fake that fails the third channel's record write after two full record-and-name writes yields `load` `written` with two channels
- [x] A sweep error after one finished dwell prints that dwell's summary on stdout and a `written` list on stderr
- [x] A name read-back mismatch reports `recordWritten: true` and `reason: verification-failed`
- [x] `npm test` and `npm run typecheck` pass

## Blocked by

- #011

## Result

Files changed: `src/errors.ts`, `src/transport.ts`, `src/protocol.ts`, `src/radio.ts`, `src/check.ts`, `src/audio.ts`, `src/sweep.ts`, `src/main.ts`, `test/fake.ts`, `test/errors.test.ts` (new), `test/cli.test.ts`, `test/sweep.test.ts`, `test/radio.test.ts`, `test/audio.test.ts`, `test/check.test.ts`, `test/transport.test.ts`, `test/target.test.ts`, `test/key.test.ts`, `.claude/skills/uv5r/SKILL.md` (exit-code bullets), `README.md` (JSON error sentence).

`BaofengError(reason, message, detail, guidance)` derives `kind` from `reason`. `REASONS` in `src/errors.ts` holds each reason's kind, meaning, default `remedy` and default `retry`; a site overrides the remedy or retry when it knows more. `TransportError` and `DeviceStateError` take a reason from their own subset type, so a reason with the wrong exit code fails the typecheck. `UsageError`, `TimeoutError`, `BusyError` and `UnexpectedError` fix theirs. `cli()` wraps any other error in `UnexpectedError`. Text errors print a `remedy:` line under the message.

| Site | Reason | Retry |
|---|---|---|
| `resolveTarget`: no AIOC found | `device-unavailable` | after-remedy |
| `SerialTransport.open`: no device at PATH, cannot open PATH | `device-unavailable` | after-remedy |
| `SerialTransport.open`: lock or busy | `device-busy` | after-remedy |
| serial error, disconnect, write callback error | `serial-io-failed` | after-remedy |
| `setPtt` port error, `holdPtt` failure | `ptt-control-failed` | no |
| ffmpeg or afplay not on PATH | `dependency-missing` | after-remedy |
| ffmpeg or afplay exit, timeout or signal | `audio-process-failed` | after-remedy |
| ffmpeg short capture | `capture-incomplete` | once |
| no handshake ack, refused session, idle session, session not started | `session-unavailable` | after-remedy for no ack, else once |
| bad ident, bad read header | `protocol-reply-invalid` | once |
| write not acked | `write-unacknowledged` | once |
| no read ack, short read | `serial-timeout` | once |
| channel record or name read-back, erase read-back, settings read-back, restore read-back | `verification-failed` | after-remedy |
| image ident mismatch, image too short | `image-incompatible` | after-remedy |
| `judgeCheck` under 80% active | `audio-inactive` | after-remedy |
| every `UsageError` | `invalid-argument` | after-remedy |
| any other error in `cli()` | `unexpected-error` | no |

`load` errors carry `written` (channel payloads verified so far) and `slot` once an entry write started. `sweep` errors carry `written` from `SweepProgress.written`, plus `phase` (`check`, `entry` or `dwell`), `slot: 0` and the plan `channel`, null during the check. `writeChannel` errors carry `recordWritten`.

Deviations:
- `load` errors carry no `phase`; a load has one step per entry, so `slot` names the failing write.
- The erase name failure splits the same way as the write: `channel N record erased; name did not take the erase` with `recordWritten: true`.
- The `sweep` error `phase` adds `dwell` for a capture or playback failure; `written` entries use only `check` and `entry`.
- `test/fake.ts` gains `refuseWriteAt`, a write the fake drops without an ack, for the third-channel test.

Review fixes:

- `writeChannel` and `eraseChannel` write the name after the record reads back. An error
  from the name write or read-back, such as a timeout, carries `recordWritten: true`.
  `test/fake.ts` gains `silentReadAt`, a read the fake leaves unanswered.
- `loadVerb` and `sweepVerb` read the plan and run the pre-port checks inside the try block.
  Every error after `checkFlags` carries `written`, empty when nothing ran. `sweep` prints
  its summary only once the transport was asked for.
- `cli()` reads `--json` and `--text` from argv before parsing. A parse error such as
  `status --json --json` keeps the requested format.
- `verification-failed` defaults to `retry: after-remedy`, which replaces `once` in the
  table above.
- Help `errors.format`, README and SKILL.md say a failed command prints one error object on
  stderr when output is JSON and a message plus a remedy line on a terminal. An exit of 128
  plus a signal number prints the result on stdout with `interrupted` and no error.
