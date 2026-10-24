# Plan: device ID table for the clone handshake

Status: plan, revised 2026-10-23 after review, a grill session and an Astra review. No code yet.

## Goal

Make `uv5r` open a clone session with any classic UV-5R variant, report which magic and
firmware it found, and name the radio when the one on the cable speaks a different protocol.
Today [protocol.ts](../src/core/protocol.ts) sends one magic, reads a fixed 12 bytes and knows one
firmware family.

Every verb that works today keeps its timing and its wire sequence. The scan across magics and
the foreign-radio probes live in one new read-only verb, `identify`. A radio that answers a
magic other than the default gets pinned with `UV5R_MAGIC` for the other verbs.

## Clean-room boundary

Chirp is GPLv3. The code in this repo stays independent of it through two layers of documents.

| Layer | Who reads it | Files |
|---|---|---|
| Research notes, written from the Chirp source at commit `c604141b` | Nobody who writes code | [docs/chirp-notes/](chirp-notes/) |
| Protocol spec, written from the notes | The implementation agent | [docs/clone-protocol.md](clone-protocol.md) |

Brief the implementation agent with the spec, this plan, the existing `src` and `test` trees,
the README and `.claude/skills/uv5r/SKILL.md`. Tell it to read nothing under
`docs/chirp-notes/` and nothing from the Chirp repo. Review its diff against the spec, then
against the notes.

On 2026-10-23 a reviewer fetched the five Chirp files at `c604141b` and checked twenty claims
from the notes: magics, try order, blacklist, ident loop, the `0x1E80` comment, dropped-byte
handling, the orig parse, basetype lists, upload ranges and the DTMF switch. All twenty held.

## What the notes changed in the design

- The ident bytes do not name the model. On firmware BFB291 and later they encode the user's
  band limits. Chirp dropped ident parsing in 2012.
- The magic does not name the model either. The 291 magic opens UV-5R, BF-F8HP, KT-980HP and
  UV-S9X3 radios.
- The firmware string names a family some of the time. `HN5RV01` ships in two-power and
  three-power radios and in the Radioddity UV-5G. Chirp removed the firmware check from upload
  in July 2023 and from download in October 2023.
- Chirp never scans across models. The user picks a model, Chirp tries that model's magics.
  Auto-detection in this CLI is our own design built from Chirp's tables.
- Radios sold today under names like UV-5RH, UV-5RM, UV-5R Plus, UV-5G Plus and UV-5R Mini use
  a 115200 baud protocol with 16-byte ASCII magics. Chirp has no record of them answering at
  9600.

So classification is best effort. The handshake records which magic answered, the ident and
the firmware string, derives a family and feature flags, and keeps working with
`family: 'unknown'` when nothing matches.

## What the review changed in the design

- The first draft replaced today's same-magic retry with a scan. The retry covers a session
  still closing from the previous verb; the README and SKILL.md document the 3 s it costs. It
  stays, and the scan moves to `identify`.
- The first draft copied Chirp's ident loop: one byte per read, 1 s per read, up to 12 reads.
  The whole ident lands within about 10 ms. A silent radio would have cost 12 s and an 8-byte
  reply without `DD` 4 s, past the 2.5 s idle drop. The read is now one bounded call.
- A 12-byte reader cannot see a 14-byte UV-5X3 reply. The bounded read takes up to 14 bytes, so
  every verb names a UV-5X3-type radio from its ident length.
- `BFB` followed by non-digits threw in the first draft. Firmware bytes are device data.
  Classification never throws; a bad parse gives `orig: false`.
- The first draft added band-byte and orig checks to `restore` while keeping ident equality.
  Equal idents have equal band bytes, so the new checks could never fire. `restore` stays as it
  is. See the README note under work item 7.
- The first draft deferred the 115200 probe because it needed a transport that reopens the
  port. `serialport` changes the rate on an open port with `port.update({ baudRate })`. The
  probe is in scope for `identify`.
- The first draft's voice tests had the threshold backwards. Voice is boolean when the BFB
  number is below 251, so BFB231 and BFB250 are boolean and BFB260 is a list.
- The first draft's time budget counted seven probes at about 30 s. The scan has 14 attempts
  at 9600 and six at 115200. The budget below is per attempt and in total.

## Current code against the spec

| Topic | Code today | Spec | Change |
|---|---|---|---|
| Magic list | One, `50 BB FF 20 12 07 25` | Eight classic magics | Table in a new `src/core/ident.ts`; `Session.start` takes one magic |
| Magic send | Byte at a time, 10 ms | Same | Keep |
| Ack wait | 1200 ms | 1 s | Keep 1200 ms |
| Wrong ack | Same message as silence; `got` holds the byte as hex, empty on silence | Report separately with the byte | Keep `got`; name the byte in the message when one arrived |
| Ident read | Sleep 300 ms, read 12 with a 50 ms timeout, collapse when 12 | Byte by byte until `DD`, max 12, accept 8 or 12 | One read of up to 14 bytes with a 300 ms budget; accept 8 or 12; 14 names a UV-5X3-type radio |
| 12 to 8 collapse | Positions 0, 3, 5, 7-11 | Same | Keep, move to `ident.ts` |
| Final `06`/`06` | Yes | Yes | Keep |
| Retry | Two attempts of the same magic, 3 s apart, only when no `06` arrived; a bad ident or a refused closing `06` throws at once | Next magic in the table, Chirp waits 2 s | Keep for every verb; `identify` scans |
| Foreign radios | `session-unavailable` after two attempts | Probe `50 0D 0C ...` magics without the closing `06` | New `identify` verb and `radio-unsupported` reason |
| Post-ident reads | `0x1E80`, `0x1EC0`, `0x1FC0` | Same | Keep |
| Firmware string | Bytes 48-61 of `0x1EC0`, printable only, trimmed | Same, plus family and flags | Extend `Ident` with the raw bytes, family and flags |
| Dropped-byte flag | Read at `0x1FCF` | Same | Keep |
| Restore checks | Image length, ident equality | Band byte, orig | Keep as is |
| `status` output | `firmware` | Add `family`, `magic`, `ident`, `firmwareHex` | Extend `RadioStatus` |

## Design

### `src/core/ident.ts`

Pure data and pure functions. No I/O.

- `MAGICS`: ordered list of `{ name, bytes, families, supported }` with all eight classic
  magics from spec section 4.1. Names are strings such as `'291'` and `'ORIG'`.
  `DEFAULT_MAGIC` is `291`. `SCAN_ORDER` for `identify` is `291`, `ORIG`,
  `UV82`, `A58`, `UV5G`, `F11`, `UV6`, `UV6_ORIG`. The first two cover the UV-5R, the tri-power
  UV-5R variants and the KT-980HP. `A58` is the BF-F8HP fallback. `UV5G` covers the Radioddity
  GMRS unit. `UV82` covers the UV-82 family, which shares the memory layout. `F11`, `UV6` and
  `UV6_ORIG` carry `supported: false`: `identify` names the radio and reports it as
  unsupported. The UV-6 has no aux block and the F-11 is outside the project.
- `FOREIGN_MAGICS`: 7-byte magics at 9600 with the name to report. `50 0D 0C 20 16 03 28`
  (BTECH UV-5X3), `50 0D 0C 20 17 09 19` (MTC UV-5R-3), `50 BB FF 20 14 11 22` (UV-6R),
  `50 BB FF 20 12 05 25` (UV-9G), `50 BB DD 55 63 98 4D` (Baojie BJ-UV55).
- `PROGRAM_MAGICS`: 16-byte ASCII magics at 115200 with the model group to report, from spec
  section 9: `PROGRAMBFNORMALU`, `PROGRAMCOLORPROU`, `PROGRAMBFGMRS05U`, `PROGRAMBF5RTECHU`,
  `PROGRAMBF-K6PROU`, `PROGRAMGMRS5RMIU`.
- `BASETYPES`: the firmware substrings by family, ordered most specific first, with the overlaps
  resolved by the magic that answered. Spec section 4.6 step 5 is the order. The `HN5RV01`
  rule below runs first. After it, only basetypes of the answering magic's `families` count.
- `classify(magicName, versionBytes, identBytes)` takes the 14 raw bytes of `0x1EF0`-`0x1EFD`
  before the printable trim and returns `{ family, flags }`, with `flags` holding `basetype`,
  `orig`, `voiceBool`, `band220`, `triPower` and `dtmfTable`. `family` is one of `uv5r`,
  `bf-f8hp`, `kt-980hp`, `uv-5g`, `uv-82`, `uv-82hp`, `uv-82x3`, `f-11`, `uv-6`, `unknown`.
  It never throws. `HN5RV01` gives `uv5r` with `291`, `uv-5g` with `UV5G` and `uv-82x3` with
  `UV82`. A version string with no basetype hit keeps the magic's family when its `families`
  list holds one entry, and gives `unknown` otherwise. `orig` is true when the three bytes after
  the first `BFB` are digits below 291, the magic's `families` include `uv5r` or `uv-5g`, and
  the family is `uv5r`, `uv-5g` or `unknown`. Any other bytes after `BFB` give `orig: false`.
- `Session.ident` carries `family` and `flags`. `dumpImage` keeps reading `droppedByte`. Voice
  and DTMF handling in `radio.ts` that reads `voiceBool` and `dtmfTable` is deferred to a later
  plan; this plan reports the flags.
- `parseIdent(reply)` returns `{ kind: 'ident', bytes }` for 8 bytes, the collapsed 8 for 12
  bytes, `{ kind: 'foreign', name: 'UV-5X3-type radio' }` for 14 bytes framed `AA` .. `DD`,
  and `{ kind: 'invalid' }` otherwise.
- `magicByName(name)` for `UV5R_MAGIC`. An unknown name, or one with `supported: false`, is a
  `UsageError` listing the supported names.
- [index.ts](../src/core/index.ts) exports `MAGICS`, `magicByName`, `identify` and the new
  types, since `cli` imports `core` only through it.

### `Session.start(magic)` in `protocol.ts`

Takes a magic from the table. `selectedMagic()` in [main.ts](../src/cli/main.ts) resolves
`UV5R_MAGIC` through `magicByName` before the port opens, so a bad name exits 2 with no serial
traffic. It passes `{ magic }` to `withSession`, `startFreshSession` and
`verifySettingsInFreshSession` in [radio.ts](../src/core/radio.ts), to `checkChannel` in
`check.ts`, to `slotZero` in `sweep.ts`, and to `identify`. The verification sessions of
`settings` and `restore` then open with the same magic as the write. `key`, `listen` and
`help` open no clone session and ignore the variable.

`attempt(transport, magic, { confirm })` in `protocol.ts` runs one attempt: discard input,
send the magic byte by byte with 10 ms gaps, wait up to 1200 ms for `06`, send `02`, read up
to 14 bytes with a 300 ms budget and pass the reply to `parseIdent`. With `confirm` it then
sends `06` and waits up to 1000 ms for `06`. Without `confirm` it stops after the ident, as in
spec section 3.5. It returns one outcome:

| Outcome | Wire |
|---|---|
| `silent` | No byte within 1200 ms |
| `wrong-ack`, with `got` | A byte other than `06` |
| `invalid`, with `got` | `06`, then a reply `parseIdent` rejects |
| `foreign`, with `name` | `06`, then a 14-byte `AA` .. `DD` reply |
| `refused`, with `got` | A valid ident, then no `06` after the host's `06` |
| `ident`, with `bytes` | A valid ident, and with `confirm` the closing `06` |

`Session.finish(magic, bytes)` resets `lastCommandAt`, `commands` and the staged halves as
`start` does today, then runs the three post-ident reads and builds `Ident` with
`bytes`, `firmware`, `firmwareHex`, `droppedByte`, `magic` (the name), `family` and `flags`.

`Session.start(magic)`:

1. Run `attempt` with `confirm`, up to two times, `SETTLE_MS` apart. Only `silent` and
   `wrong-ack` lead to the second attempt.
2. `foreign` throws `DeviceStateError('radio-unsupported')` naming the radio. `invalid`
   throws `protocol-reply-invalid` with the bytes. `refused` throws `session-unavailable` with
   today's remedy "wait 3 s and rerun the command".
3. `ident` calls `finish`.
4. When both attempts end `silent` or `wrong-ack`, throw `session-unavailable` with `got` from
   the last attempt and the remedy in Errors.

Keep `IDLE_LIMIT_MS`, `SETTLE_MS`, the settings staging guard, `readBlock` and `writeBlock`
unchanged. `Session.start()` with no argument keeps the default, so the tests that call it
today keep passing. `protocol.ts` keeps exporting `MAGIC` as the `291` bytes for `fake.ts` and
`settings.test.ts`.

### `identify` verb

Read-only. One result on stdout, like `status`. Runs the probe sequence of spec section 9
across the two baud rates.

1. For each magic in `SCAN_ORDER`, run `attempt`, with `confirm` when the magic has
   `supported: true`. When `UV5R_MAGIC` names a magic, that magic moves to the front of the
   order, so a correct pin answers at once and a stale pin still gets the full scan. The first
   magic gets a second attempt `SETTLE_MS` later on `silent` or `wrong-ack`, as every verb
   does. Outcomes:
   - `ident` on a supported magic: call `Session.finish` and stop. A block-read error in
     `finish` ends `identify` with that error.
   - `ident` on an unsupported magic: stop with `radio-unsupported` naming the radio. No
     closing `06` and no block read go out, since the UV-6 has no aux block.
   - `foreign`: stop with `radio-unsupported`.
   - `silent` or `wrong-ack`: pause `SCAN_SILENT_PAUSE_MS`, then the next magic.
   - `invalid` or `refused`: pause `SETTLE_MS`, then the next magic.
2. When every classic magic fails: for each `FOREIGN_MAGICS` entry, run `attempt` without
   `confirm`. `ident` or `foreign` names the entry's radio and stops the scan. `silent` or
   `wrong-ack` pauses `SCAN_SILENT_PAUSE_MS`; `invalid` pauses `SETTLE_MS`.
3. When every 9600 probe fails: `transport.setBaud(115200)`, with a `finally` that sets 9600
   again and keeps the first error when that also fails. For each `PROGRAM_MAGICS` entry,
   discard input, send the 16 bytes in one write and read one byte within 1200 ms. `06` names
   the model group and stops the scan. Any other byte or silence pauses `PROGRAM_PAUSE_MS`
   before the next entry; the last entry gets no pause.
4. Report. A foreign or 115200 reply exits 5 with `radio-unsupported`. A scan that ends
   without a stop exits 5:
   - When a classic magic got `invalid`, with `protocol-reply-invalid` naming an unknown UV-5R
     variant and the first invalid reply in `got`, as spec section 9 reports it.
   - Otherwise with `session-unavailable`, retry `after-remedy` and the remedy "ask the human
     to check the radio is on and the cable is seated", without the pointer back to
     `identify`. The detail carries `answers`, each `wrong-ack`, `refused` and foreign `invalid`
     outcome with its magic name and `got`; it is empty on a silent cable.

Result keys: `magic`, `ident` (hex), `firmware`, `firmwareHex`, `family`, `flags`,
`droppedByte` and `pin`. `pin` is the `UV5R_MAGIC=NAME` line to export when the magic that
answered differs from the one the other verbs select now, `UV5R_MAGIC` or else `291`. It is
`null` when they match.

`identify` calls `onAttempt({ name, baud, outcome })` after each attempt. At 115200 the
outcome is `silent`, `wrong-ack` or `ack`. In text mode `main.ts` prints one line per call on
stderr, as in `ORIG at 9600: silent`, so the wait is visible.

### Time budget

An attempt that gets no `06` costs 1.27 s at 9600 (70 ms of magic and the 1200 ms ack wait)
and 1.2 s at 115200, plus its pause. Totals for a silent cable:

| Phase | Attempts | Pause each | About |
|---|---|---|---|
| Classic magics | 9 (the first twice) | 3 s after the first, 2 s after the rest | 30 s |
| Foreign 9600 probes | 5 | 2 s | 16 s |
| 115200 probes | 6 | 1 s, none after the last | 12 s |
| Total | 20 | | 59 s |

The `session-unavailable` remedy of the other verbs points at `identify`; the one `identify`
raises itself does not, so an agent does not loop through the minute twice.

Every other verb keeps today's 5.5 s to failure on a silent radio. The help entry for
`identify` states the minute. The 2 s pause after a silent attempt in the classic and foreign
phases is one constant, `SCAN_SILENT_PAUSE_MS` in `radio.ts`, so bench question 1 changes one
line. The 1 s pause at 115200 is `PROGRAM_PAUSE_MS`.

### `UV5R_MAGIC`

Names a magic for every radio verb, as `UV5R_TARGET` names the port. `identify` prints the
line to export. The README operating rules and SKILL.md gain one bullet: run `uv5r identify`
when `status` exits 5 with `session-unavailable` and the cable is seated, then export the
`pin` line it prints.

### Errors

Add `radio-unsupported` to `DeviceStateReason`: kind `device-state`, exit 5, retry `no`,
means "the radio on the cable answered a magic of another family", remedy "report the radio
name to the human; this CLI speaks the classic UV-5R protocol". The detail carries `radio`.
A 115200 reply leaves the radio in program mode with no exit command, so that site sets the
remedy to "ask the human to power-cycle the radio and report the radio name; this CLI speaks
the classic UV-5R protocol" and adds `powerCycle: true`. `uv5r help --json` lists the reason
through `REASONS`. The exit 5 line in `EXIT_CODES` in `main.ts` is hand-written and gains "an
unsupported radio".

`session-unavailable` keeps its reason and exit code. The handshake site sets the remedy to
"ask the human to check the radio is on and the cable is seated; if both hold, run uv5r
identify and export the UV5R_MAGIC line it prints". The cable check comes first because it is
free and the scan costs a minute. A wrong ack byte sits in `got` as hex.

### Transport

`Transport` gains `setBaud(rate: number): Promise<void>`. `SerialTransport` calls
`port.update({ baudRate })` and rejects with `serial-io-failed` on an error;
`transport.test.ts` covers it through `FakePort.update`. The fake records the current rate,
answers classic and foreign magics only at 9600 and `PROGRAM_MAGICS` only at 115200.

### Fake radio

Extend [test/core/fake.ts](../test/core/fake.ts) with `magics: Uint8Array[]` it acks, matched
against the last 7 bytes received; `ackByte` it sends in place of `06`; `identReply` of any
length; `firmware: string`; `foreignMagic` with `foreignIdent` of 8 or 14 bytes; and
`programMagic`, a 16-byte magic it acks at 115200 with one `06`. Default to the bench unit:
magic 291, ack `06`, ident `AA 30 76 04 00 05 20 DD`, firmware `HN5RV011`, rate 9600. Tests that
assert no closing `06` or no block read spy on `write`, as `protocol.test.ts` does.

### Output

`status` adds `family`, `magic`, `ident` and `firmwareHex` to its JSON and human output.
`cli.test.ts` checks the `status` help result keys against the output, so `STATUS` there, the
`readStatus` test in `radio.test.ts` and the help result change together.
`dump` adds `family` and `magic`. `identify` joins the README verb table and `main.ts` help
with a result example and its exit cases. `firmware` keeps its printable trimmed form;
`firmwareHex` carries all 14 bytes.

## Work items

Each item ends with `npm run typecheck` and `npm test` green.

1. `src/core/ident.ts` with the tables, `parseIdent`, `classify`, `magicByName`, and
   `test/core/ident.test.ts` covering: every magic maps to its families; each basetype string
   lands on its family with a magic whose families include it, and counts for nothing with one
   whose families do not; `HN5RV011` with magic 291 gives `uv5r` and with UV82 gives
   `uv-82x3`; `HN5RV01N5R3` with 291 gives `uv5r`; `N5RV` with 291 gives `uv5r`; `BFB231` and
   `BFB250` with `ORIG` give `orig` and `voiceBool`; `BFB260` with `ORIG` gives `orig` and a
   voice list; `BFB29x` with 291 gives `orig: false` and `uv5r` without throwing; `BFB231` with
   UV82 gives `orig: false` and `unknown`; empty, all-`FF` and all-space firmware give
   `unknown` with magic 291 and `uv5r` with `ORIG`; byte 3 `02` sets `band220` on non-orig
   only; `HN5RV011` sets `dtmfTable`; `parseIdent` on 8, 12, 14 and 9 bytes.
2. `attempt`, `Session.finish` and `Session.start(magic)`: bounded ident read, `got` on a
   wrong ack, `radio-unsupported` on a 14-byte ident, `selectedMagic()` in `main.ts` passing
   `{ magic }` to every session call site. Fake radio gains `magics`, `ackByte`,
   `identReply`, `firmware`. Tests in `test/core/radio.test.ts` beside the handshake tests and
   in `test/cli/cli.test.ts`: 8-byte ident; 12-byte ident collapses; 14-byte
   ident exits 5 with the radio name; 9-byte ident exits 5 with the bytes; the second attempt
   still runs after `SETTLE_MS`; a wrong ack byte appears in `got`; `UV5R_MAGIC=UV82` sends
   the UV82 bytes on the write session and on the verification session of `settings`;
   `UV5R_MAGIC=BOGUS` and `UV5R_MAGIC=UV6` exit 2 listing the supported names, with the port
   never opened.
3. `Transport.setBaud`, the `identify` verb and `radio-unsupported`. Fake radio gains
   `foreignMagic`, `foreignIdent`, `programMagic` and the rate. Tests with fake timers:
   second magic answers after the first fails and the elapsed time shows the pauses; an
   invalid ident on the first magic pauses `SETTLE_MS` before the next; UV-5X3 magic acked names BTECH
   UV-5X3 and the fake saw no closing `06`; `PROGRAMBFNORMALU` acked at 115200 names the
   UV17Pro group with `powerCycle: true` and the power-cycle remedy, and the rate is 9600 on
   return; silence on everything gives `session-unavailable` with a remedy that does not name
   `identify` and retry `after-remedy`; an invalid classic ident followed by silence gives
   `protocol-reply-invalid` with the bytes; a wrong ack followed by silence lists the byte in
   `answers`; a stale `UV5R_MAGIC=ORIG` with only `291` acking gives
   `pin` `UV5R_MAGIC=291`; a UV6 ack names the UV-6 as unsupported with no block read on the wire; a
   14-byte ident on the second magic ends the scan.
4. `status`, `dump` and `identify` output, help entries, README verb table and operating rule,
   SKILL.md bullet. Tests in `test/cli/cli.test.ts` in its existing assertion style, with
   `radio-unsupported` added to `REASON_ENUM`. SKILL.md sits at the 60-line cap the same file
   enforces, so the new bullet replaces or merges an existing line.
5. Bench verification, read-only, with the AIOC on `/dev/cu.usbmodemf40b162d5`:
   `uv5r status --json` reports `magic: "291"`, `family: "uv5r"`, firmware `HN5RV011`;
   `uv5r identify` on the bench unit stops at the first magic; `UV5R_MAGIC=ORIG uv5r status`
   reports what the bench unit does with the original magic; `uv5r identify` with the radio
   off runs the whole sequence and reports `session-unavailable` within the budget;
   `uv5r dump --out /tmp/x.img` matches the fixture outside the aux area. Bench question 1,
   after question 2: set `SCAN_SILENT_PAUSE_MS` to 0 in a local edit and run
   `UV5R_MAGIC=X uv5r identify`, with X a magic the bench unit leaves silent: `ORIG` when it
   does not ack `ORIG`, else `UV82`. The pin puts X first, so `291` follows a silent X with no
   pause. Record whether `291` still acks. Record the results in the README section
   "Protocol notes from the bench".
6. README "Protocol notes from the bench" gains the ident meaning, the magic table, the
   foreign-radio names and the `identify` timing.
7. README `restore` row: on post-291 firmware the ident appears to encode the band limits, so
   a restore after a band-limit change on the same radio exits 5 with `image-incompatible`.
   Dump again first.

## Decisions taken

- Every verb keeps two attempts of one magic, 3 s apart. The scan lives in `identify` alone.
- Settle after an acked attempt stays at the bench 3 s. Chirp waits 2 s. The bench radio
  drops a session after 2.5 s idle.
- Classification never blocks a session and never throws. `unknown` family keeps every verb
  working.
- `restore` keeps its checks. Chirp's band and orig checks add nothing while ident equality
  stays.
- The 115200 probe runs only after every 9600 attempt failed, so no classic radio that
  completed a handshake receives it. The 57600 UV17 and 38400 UV-K5 probes stay deferred; neither family
  is sold under a UV-5R name as often as the UV17Pro family.
- The UV-6 and F-11 are recognized and refused.
- `UV5R_MAGIC` is an environment variable. A flag can follow when a second radio is on the
  bench.

## Grill session, 2026-10-23

Decisions 1 through 5 above hold as written. Additions:

- Verbs stay on one magic. A pre-291 radio costs one `identify` run and one export per
  bench. The second attempt keeps covering a session still closing from the previous verb,
  so it resends the same magic.
- The env var ships alone. A magic describes the radio on the bench, so it lives next to
  `UV5R_TARGET` in the shell. A flag arrives with a second radio, when `--target` is already
  passed per call.
- The 115200 phase stays in scope with `port.update`. The classic radio never sees it, since
  it already failed at 9600. Only the fake exercises it until a UV17Pro radio reaches the
  bench. Bench question 6 stays open in this plan.
- First ack wins. Bench question 2 is a README fact. `291` leads the scan, so a radio that
  acks both `291` and `ORIG` still reports `pin: null`. Work item 5 answers Q2 through
  `UV5R_MAGIC=ORIG uv5r status`.
- The silent pause stays at 2 s as `SCAN_SILENT_PAUSE_MS`. Work item 5 measures it on the
  bench; no throwaway probe script.
- `identify` moves a pinned magic to the front of `SCAN_ORDER`.
- The `session-unavailable` remedy from a verb handshake: "ask the human to check the radio is
  on and the cable is seated; if both hold, run uv5r identify and export the UV5R_MAGIC line
  it prints".

### Issue slices

Four vertical slices. Each lands with `npm run typecheck` and `npm test` green and is
bench-checkable on its own.

1. `ident.ts`, `attempt`, `Session.start(magic)`, `UV5R_MAGIC`, `radio-unsupported` for the
   14-byte ident, and `status` and `dump` showing `magic` and `family` with their help
   results, `REASON_ENUM` and the exit 5 text in `EXIT_CODES`. The verb handshake keeps
   today's remedy. Work items 1, 2 and the output half of 4.
2. `identify` with the classic 9600 scan, the UV-6 and F-11 refusal, the verb remedy that
   points at `identify`, the help entry, the README verb table and operating rule, and the
   SKILL.md bullet. Work item 3 without the foreign and 115200 phases, plus the rest of 4.
3. Foreign 9600 probes, `Transport.setBaud`, the 115200 phase and the power-cycle remedy.
   The remainder of work item 3.
4. Bench verification, README protocol notes and the `restore` row. Work items 5, 6 and 7.

## Open questions for the bench

1. Does a magic that gets no `06` need any pause before the next magic? Send a magic the
   bench unit leaves silent, then `291`, back to back. A no cuts the `identify` budget by
   about 26 s.
2. Does the bench unit ack the `ORIG` magic as well as `291`? Work item 5 records the answer
   in the README; first ack wins either way.
3. Does the ident change with the band limits? The UV-5R menu has no band-limit item. Chirp
   writes them at `0x1FC0`. Test only with a fresh dump in hand, since the write lands in the
   aux area.
4. Does the radio send its `06` in reply to the host's `06` after a block, or as a prefix to
   the next reply? A gap test after a read settles it.
5. What does a radio left mid-handshake by a foreign probe do? Decides the remedy text.
6. Does a UV17Pro radio answer anything at 9600, and does a 115200 magic have any effect on a
   classic radio? None is on the bench. The sequence above assumes no to both.

## Astra review, 2026-10-23

Accepted:

- `identify` had no way to tell outcomes apart. Added `attempt` with tagged outcomes and `Session.finish`.
- `selectedMagic()` sat in `radio.ts` against the split plan. It moves to `main.ts` and reaches every session call site, `check.ts` and `sweep.ts` included.
- `radio-unsupported` landed in slice 2 while slice 1 throws it. It moves to slice 1; the remedy that names `identify` stays in slice 2.
- `classify` input was ambiguous. It takes the 14 raw version bytes and returns `{ family, flags }`.
- `orig` lacked the spec's family exclusions.
- The flags had no consumer. The plan reports them and defers voice and DTMF handling.
- `BFB29x` giving `unknown` contradicted the basetype order. It gives `uv5r`.
- A no-hit version string ignored the magic. A single-family magic keeps its family.
- A stale pin returned `pin: null` when `291` answered. `pin` now compares against the magic the verbs select.
- Foreign probes lacked pacing, discard and ident rules. They run `attempt` without `confirm`.
- The baud reset ran only on a normal return. It sits in a `finally`.
- The time budget mixed per-attempt costs. Rows now use 1.27 s and 1.2 s, with no pause after the last probe: 59 s.
- Today's failure time is 5.5 s. Bench question 1 saves about 26 s on a no.
- Three rows of the code table misstated the code: wrong ack, retry and foreign radios.
- The fake lacked a wrong-ack knob, arbitrary ident lengths and 8-byte foreign idents.
- The plan named snapshot tests that do not exist, and missed `REASON_ENUM`, the `STATUS` key checks and the 60-line SKILL.md cap.
- `EXIT_CODES` exit 5 text is hand-written and needs the new case.
- `UV5R_MAGIC` validation runs before the port opens.
- Silence everywhere in `identify` sets retry `after-remedy`.
- `MAGIC` stays exported for the fake and `settings.test.ts`.
- Bench question 1 uses a pin to order the magics and depends on question 2.
- `orig` with magic UV82 could come out true. Basetypes count only within the magic's families, and `orig` needs a magic whose families include `uv5r` or `uv-5g`.
- A scan that ends after replies had no defined result. An invalid classic ident reports `protocol-reply-invalid`; wrong acks and refusals go in `answers`.
- `Session.finish` omitted the state reset that `start` does before its first read.
- Slice 1 adds a reason without updating `REASON_ENUM` and `EXIT_CODES`. Both move to slice 1.
- Work item 1 tests named no magic, and `HN5RV01` had no precedence over the family filter. Tests name the magic; `HN5RV01` runs first.
- A foreign `invalid` reply vanished from the final error. It joins `answers`.
- Decision 5 said no answering classic radio reaches 115200. It now says no radio that completed a handshake. Question 2 no longer decides first ack.
- Work item 7 states the band-limit reading as an inference.

Rejected:

- Make every `06` terminal under "first ack wins". The grill decision concerns two magics that both complete a handshake; spec section 4.6 moves on after a bad ident.
- Make `FakeRadio.read` honor its timeout. The tests assert pauses; work item 5 checks the budget on the bench.
