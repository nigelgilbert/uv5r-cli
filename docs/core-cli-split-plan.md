# Plan: split core from CLI

Status: implemented on `feature/core-cli-split` (PR #2), 2026-10-23. Item 7, the bench check, is
open.

## Goal

Divide `src/` into a `core` area that talks to the radio and a `cli` area that parses
arguments, prints and exits. `core` becomes an npm module later. Adjacent modules such as TTS
build on `core` and are used by `cli`. The device handshake work in
`uv5r identify` lands inside `core` after this split.

Every verb keeps its output, its timing and its exit codes. The test suite proves the move.

## Order of the two work items

The split goes first. The handshake work changes `protocol.ts` and `radio.ts` and adds
`ident.ts`; moving them after that work lands churns a fresh test tree. The split is a
mechanical move with no behavior change. The handshake work then touches `core` for the
engine and `cli` for the `identify` verb, help and README, which exercises the boundary.

## Layout

Directories now, workspaces later. A package move is mechanical once the import graph has one
direction.

```
src/
  core/
    index.ts        public surface, the only file cli imports from core
    transport.ts    Transport, SerialTransport, findAioc, resolveTarget
    protocol.ts     Session, timing constants, hex
    ident.ts        magic tables, parseIdent, classify   (handshake work item)
    codec.ts        channel and settings encoding
    radio.ts        readStatus, writeChannel, dumpImage, restoreImage, holdPtt, withSession
    plan.ts         Plan, parsePlan, readPlan
    errors.ts       BaofengError and subclasses, REASONS, RETRY, Guidance, withDetail
  cli/
    main.ts         verbs, output, withTransport, openSerial, exit handling
    args.ts         parseArgs, flag helpers, parseDecimal
    help.ts         VerbDoc, usageLine, verbJson, verbText
    exit.ts         EXIT, exitCodeFor, signalExitCode   (moved out of errors.ts)
    audio.ts        ffmpeg listen, play, checkFfmpeg
    check.ts        checkChannel
    sweep.ts        runSweep, dwell, slotZero
test/
  core/             protocol, radio, codec, plan, transport, target, errors, settings tests, fake.ts
  cli/              cli, args, check, sweep, listen-cli, key, parse tests
```

`audio.ts`, `check.ts` and `sweep.ts` sit in `cli` for now. They compose radio sessions with
ffmpeg captures the way a TTS module will compose sessions with speech. When a second
adjacent module arrives, move them to `src/audio/` beside it.

## Import rule

`cli` imports `core` through `src/core/index.ts`. `core` imports nothing from `cli`. A test
in `test/core/imports.test.ts` reads every file under `src/core/` and fails on an import path
containing `cli/`. `tsconfig.json` keeps one project.

## What moves where

| Today | Goes to | Note |
|---|---|---|
| `errors.ts` `EXIT`, `exitCodeFor`, `signalExitCode` | `cli/exit.ts` | Exit codes are a process concern. `ErrorKind` stays in core so `exit.ts` maps it. |
| `errors.ts` `REASONS` | `core/errors.ts` | The `means` and `remedy` text stays as is. Three remedies name `uv5r` verbs; leave them and list them under follow-ups. |
| `args.ts` `parseDecimal` | `cli/args.ts` | `codec.ts` and `plan.ts` import it today. Move `parseDecimal` to `core/codec.ts` and have `cli/args.ts` re-export it, so core stops depending on the argument parser. |
| `radio.ts` `holdPtt` | `core/radio.ts` | Keeps its `EventEmitter` parameter; `cli/main.ts` passes `process`. |
| `protocol.ts` `MAGIC` | `core/protocol.ts` | `test/core/fake.ts` imports it from there. The handshake work deletes it; tests use `magicByName('291').bytes`. |

Everything else moves to the directory named in the layout with its imports rewritten.

## Public surface of core

`src/core/index.ts` re-exports, by name:

- `transport.ts`: `Transport`, `SerialTransport`, `findAioc`, `resolveTarget`, `AIOC_VENDOR_ID`, `AIOC_PRODUCT_ID`
- `protocol.ts`: `Session`, `Ident`, `SETTLE_MS`, `IDLE_LIMIT_MS`, `settle`, `hex`
- `codec.ts`: every current export
- `radio.ts`: every current export
- `plan.ts`: `Plan`, `PlanEntry`, `parsePlan`, `readPlan`
- `errors.ts`: the error classes, `ErrorKind`, `ErrorReason`, `Retry`, `Guidance`, `REASONS`, `RETRY`, `withDetail`

Tests under `test/core/` import module files directly. Tests under `test/cli/` and every
file under `src/cli/` import `../core/index.ts`.

## Where the handshake engine lands

The handshake engine lives in `src/core/protocol.ts`, `src/core/ident.ts` and
`src/core/radio.ts`:

- `Session.start(magic)` stays in `core/protocol.ts`. The constructor keeps taking a
  `Transport`; `start` takes the magic. A constructor runs no I/O, so the handshake stays in
  the async `start` and the magic table is data passed in.
- `selectedMagic()` reads `UV5R_MAGIC` in `cli/main.ts` and passes the magic into
  `withSession(t, fn, { magic })` and `startFreshSession(t, { magic })`. Environment variables
  are a CLI concern; `core` takes options.
- The `identify` scan is a `core/radio.ts` function
  `identify(transport, onAttempt, { magic })` that returns the result object. `magic` goes
  first in the scan and sets `pin`; without it 291 goes first. The verb in `cli/main.ts`
  passes `selectedMagic()`, prints the per-attempt lines from the callback and maps the
  result to stdout.
- The classification result lives on `Session.ident` as `family` and `flags`. Operations in
  `core/radio.ts` read the flags for firmware-dependent behavior (dropped byte, voice list,
  DTMF table).

## Work items

Each item ends with `npm run typecheck` and `npm test` green.

1. Create `src/core/` and `src/cli/`. `git mv` each file to the directory in the layout.
   Rewrite relative imports. Move the tests into `test/core/` and `test/cli/` and fix their
   paths. Point the `bin` and `uv5r` script in `package.json` at `src/cli/main.ts`.
2. Split `errors.ts`: `EXIT`, `exitCodeFor` and `signalExitCode` go to `cli/exit.ts`.
   `cli/main.ts` and `cli/help.ts` import them from there. `test/cli/errors.test.ts` covers
   the exit mapping; the reason table tests stay in `test/core/errors.test.ts`.
3. Move `parseDecimal` into `core/codec.ts`. `cli/args.ts` re-exports it.
4. Add `src/core/index.ts` with the surface above. Point every `src/cli/` import and every
   `test/cli/` import at it.
5. Add `test/core/imports.test.ts`.
6. Update the README: `uv5r` means `node src/cli/main.ts`; the Development section describes
   the two areas and the import rule. Update `.claude/skills/uv5r/SKILL.md` line
   "`uv5r` means `node src/main.ts`".
7. Bench check, read-only: `uv5r status --json` and `uv5r read 0` on the AIOC behave as
   before.

## Follow-ups

- Three `REASONS` remedies name `uv5r` verbs: `squelch-open`, the settings verify text and
  the `session-unavailable` pointer at `identify` in `core/protocol.ts`. When `core` ships as
  a module, move the verb names into a `cli` table keyed by reason.
- `test/core/fake.ts` is useful to anyone building on `core`. Export it as `core/testing`
  when the package exists.
- npm workspaces with `packages/core` and `packages/cli`. Check that `nodenext` resolves a
  workspace `exports` entry that points at a `.ts` file before committing to the move.
