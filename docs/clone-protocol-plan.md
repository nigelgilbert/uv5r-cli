# Plan: device ID table for the clone handshake

Status: plan, revised 2026-10-23 after review. No code yet.

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
  Classification never throws; a bad parse gives `orig: false` and `family: 'unknown'`.
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
| Wrong ack | Merged with silence | Report separately with the byte | Add the byte to the error detail |
| Ident read | Sleep 300 ms, read 12 with a 50 ms timeout, collapse when 12 | Byte by byte until `DD`, max 12, accept 8 or 12 | One read of up to 14 bytes with a 300 ms budget; accept 8 or 12; 14 names a UV-5X3-type radio |
| 12 to 8 collapse | Positions 0, 3, 5, 7-11 | Same | Keep, move to `ident.ts` |
| Final `06`/`06` | Yes | Yes | Keep |
| Retry | Two attempts of the same magic, 3 s apart | Next magic in the table, Chirp waits 2 s | Keep for every verb; `identify` scans |
| Foreign radios | Timeout after two attempts | Probe `50 0D 0C ...` magics without the closing `06` | New `identify` verb and `radio-unsupported` reason |
| Post-ident reads | `0x1E80`, `0x1EC0`, `0x1FC0` | Same | Keep |
| Firmware string | Bytes 48-61 of `0x1EC0`, printable only, trimmed | Same, plus family and flags | Extend `Ident` with the raw bytes, family and flags |
| Dropped-byte flag | Read at `0x1FCF` | Same | Keep |
| Restore checks | Image length, ident equality | Band byte, orig | Keep as is |
| `status` output | `firmware` | Add `family`, `magic`, `ident`, `firmwareHex` | Extend `RadioStatus` |

## Design

### `src/core/ident.ts`

Pure data and pure functions. No I/O.

- `MAGICS`: ordered list of `{ name, bytes, families }` with all eight classic magics from
  spec section 4.1. `DEFAULT_MAGIC` is `291`. `SCAN_ORDER` for `identify` is `291`, `ORIG`,
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
  resolved by the magic that answered. Spec section 4.6 step 5 is the order.
- `classify(magicName, firmware, identBytes)` returns `{ family, basetype, orig, voiceBool,
  band220, triPower, dtmfTable }`. `family` is one of `uv5r`, `bf-f8hp`, `kt-980hp`, `uv-5g`,
  `uv-82`, `uv-82hp`, `uv-82x3`, `f-11`, `uv-6`, `unknown`. It never throws. `orig` is true
  when `BFB` is followed by three digits below 291. Any other bytes after `BFB` give
  `orig: false`.
- `parseIdent(reply)` returns `{ kind: 'ident', bytes }` for 8 bytes, the collapsed 8 for 12
  bytes, `{ kind: 'foreign', name: 'UV-5X3-type radio' }` for 14 bytes framed `AA` .. `DD`,
  and `{ kind: 'invalid' }` otherwise.
- `magicByName(name)` for `UV5R_MAGIC`. An unknown name, or one with `supported: false`, is a
  `UsageError` listing the supported names.

### `Session.start(magic)` in `protocol.ts`

Takes a magic from the table. [radio.ts](../src/core/radio.ts) resolves `UV5R_MAGIC` once in a
`selectedMagic()` helper, and both `withSession` and `startFreshSession` pass it, so the
verification sessions of `settings` and `restore` open with the same magic as the write.

1. Two attempts of that magic, `SETTLE_MS` apart, as today. Discard input before each. Send
   the magic byte by byte with 10 ms gaps, wait up to 1200 ms for `06`. On a byte other than
   `06`, keep it as `got` in the error detail.
2. On `06`: send `02`, read up to 14 bytes with a 300 ms budget, pass the reply to
   `parseIdent`. `foreign` throws `DeviceStateError('radio-unsupported')` naming the radio.
   `invalid` throws `protocol-reply-invalid` with the bytes. Send `06`, expect `06`.
3. Keep the three post-ident reads. Build `Ident` with `bytes`, `firmware`, `firmwareHex`,
   `droppedByte`, `magic` and the result of `classify`.
4. When both attempts get no `06`: throw `session-unavailable` as today. The remedy adds "or
   run uv5r identify".

Keep `IDLE_LIMIT_MS`, `SETTLE_MS`, the settings staging guard, `readBlock` and `writeBlock`
unchanged. `Session.start()` with no argument keeps the default, so the tests that call it
today keep passing.

### `identify` verb

Read-only. One result on stdout, like `status`. Runs the probe sequence of spec section 9
across the two baud rates.

1. For each magic in `SCAN_ORDER`: discard input, one attempt of steps 1 and 2 above. The
   first magic gets the second settled attempt that every verb gets. On `06` and a valid
   ident: when the magic has `supported: false`, stop with `radio-unsupported` naming the
   radio before any block read, since the UV-6 has no aux block. Otherwise complete the
   handshake, run the post-ident reads, and stop. A 14-byte ident ends the scan with
   `radio-unsupported`. On silence or a wrong byte, pause 2 s. On `06` followed by an invalid
   ident or a refused closing `06`, pause 3 s.
2. When every classic magic fails: for each `FOREIGN_MAGICS` entry, send the magic, wait
   1200 ms for `06`. On `06`, send `02`, read up to 14 bytes, and stop with the name. Send no
   closing `06`. Pause 2 s after a silent probe.
3. When every 9600 probe fails: `transport.setBaud(115200)`. For each `PROGRAM_MAGICS` entry,
   discard input, send the 16 bytes in one write, wait 1200 ms for one byte. `06` names the
   model group. Pause 1 s after a silent probe. Set the baud back to 9600 before returning.
4. Report. A foreign or 115200 reply exits 5 with `radio-unsupported`. Silence everywhere
   exits 5 with `session-unavailable` and the remedy "ask the human to check the radio is on
   and the cable is seated", without the pointer back to `identify`.

Result keys: `magic`, `ident` (hex), `firmware`, `firmwareHex`, `family`, `flags`,
`droppedByte`, `pin` (the `UV5R_MAGIC=NAME` line to export; `null` when the default magic
answered and nothing needs exporting).
In text mode, one line per attempt on stderr while it runs, so the wait is visible.

### Time budget

An attempt that gets no `06` costs 1.3 s plus its pause. Totals for a silent cable:

| Phase | Attempts | Pause each | About |
|---|---|---|---|
| Classic magics | 9 (the first twice) | 2 s, 3 s after the first | 31 s |
| Foreign 9600 probes | 5 | 2 s | 16 s |
| 115200 probes | 6 | 1 s | 14 s |
| Total | 20 | | 61 s |

The `session-unavailable` remedy of the other verbs points at `identify`; the one `identify`
raises itself does not, so an agent does not loop through the minute twice.

Every other verb keeps today's 5.6 s to failure. The help entry for `identify` states the
minute. Bench question 1 below may shorten the 2 s pause after a silent magic.

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
through `REASONS`, so no help text changes by hand.

`session-unavailable` keeps its reason and exit code. Its remedy gains "or run uv5r identify".
A wrong ack byte sits in `got` as hex.

### Transport

`Transport` gains `setBaud(rate: number): Promise<void>`. `SerialTransport` calls
`port.update({ baudRate })`. The fake records the current rate and answers `PROGRAM_MAGICS`
only at 115200.

### Fake radio

Extend [test/core/fake.ts](../test/core/fake.ts) with `magics: Uint8Array[]` it answers, `identReply`
of 8, 12 or 14 bytes, `firmware: string`, `foreignMagic` (a 7-byte magic it acks with a
14-byte ident) and `programMagic` (a 16-byte magic it acks at 115200 with one `06`). Default
to the bench unit: magic 291, ident `AA 30 76 04 00 05 20 DD`, firmware `HN5RV011`, rate 9600.

### Output

`status` adds `family`, `magic`, `ident` and `firmwareHex` to its JSON and human output.
`dump` adds `family` and `magic`. `identify` joins the README verb table and `main.ts` help
with a result example and its exit cases. `firmware` keeps its printable trimmed form;
`firmwareHex` carries all 14 bytes.

## Work items

Each item ends with `npm run typecheck` and `npm test` green.

1. `src/core/ident.ts` with the tables, `parseIdent`, `classify`, `magicByName`, and
   `test/core/ident.test.ts` covering: every magic maps to its families; each basetype string
   lands on its family; `HN5RV011` with magic 291 gives `uv5r`, with magic UV82 gives `uv-82x3`;
   `N5RV` with 291 gives `uv5r`; `BFB231` and `BFB250` give `orig` and `voiceBool`; `BFB260`
   gives `orig` and a voice list; `BFB29x` gives `orig: false` and `unknown` without
   throwing; empty, all-`FF` and all-space firmware give `unknown`; byte 3 `02` sets `band220`
   on non-orig only; `parseIdent` on 8, 12, 14 and 9 bytes.
2. `Session.start(magic)`: bounded ident read, `got` on a wrong ack, `radio-unsupported` on a
   14-byte ident, `selectedMagic()` in `withSession` and `startFreshSession`. Fake radio gains
   `magics`, `identReply`, `firmware`. Tests: 8-byte ident; 12-byte ident collapses; 14-byte
   ident exits 5 with the radio name; 9-byte ident exits 5 with the bytes; the second attempt
   still runs after `SETTLE_MS`; a wrong ack byte appears in `got`; `UV5R_MAGIC=UV82` sends
   the UV82 bytes on the write session and on the verification session of `settings`;
   `UV5R_MAGIC=BOGUS` and `UV5R_MAGIC=UV6` exit 2 listing the supported names.
3. `Transport.setBaud`, the `identify` verb and `radio-unsupported`. Fake radio gains
   `foreignMagic`, `programMagic` and the rate. Tests with fake timers: second magic answers
   after the first fails and the elapsed time shows the pauses; UV-5X3 magic acked names BTECH
   UV-5X3 and the fake saw no closing `06`; `PROGRAMBFNORMALU` acked at 115200 names the
   UV17Pro group with `powerCycle: true` and the power-cycle remedy, and the rate is 9600 on
   return; silence on everything gives `session-unavailable` with a remedy that does not name
   `identify`; a UV6 ack names the UV-6 as unsupported with no block read on the wire; a
   14-byte ident on the second magic ends the scan.
4. `status`, `dump` and `identify` output, help entries, README verb table and operating rule,
   SKILL.md bullet. Snapshot tests in `test/cli/cli.test.ts`.
5. Bench verification, read-only, with the AIOC on `/dev/cu.usbmodemf40b162d5`:
   `uv5r status --json` reports `magic: 291`, `family: uv5r`, firmware `HN5RV011`;
   `uv5r identify` on the bench unit stops at the first magic; `UV5R_MAGIC=ORIG uv5r status`
   reports what the bench unit does with the original magic; `uv5r identify` with the radio
   off runs the whole sequence and reports `session-unavailable` within the budget;
   `uv5r dump --out /tmp/x.img` matches the fixture outside the aux area. Record the results
   in the README bench notes.
6. README "Protocol notes from the bench" gains the ident meaning, the magic table, the
   foreign-radio names and the `identify` timing.
7. README `restore` row: the image ident equals the band limits, so a restore after a
   band-limit change on the same radio exits 5 with `image-incompatible`. Dump again first.

## Decisions taken

- Every verb keeps two attempts of one magic, 3 s apart. The scan lives in `identify` alone.
- Settle after an acked attempt stays at the bench 3 s. Chirp waits 2 s. The bench radio
  drops a session after 2.5 s idle.
- Classification never blocks a session and never throws. `unknown` family keeps every verb
  working.
- `restore` keeps its checks. Chirp's band and orig checks add nothing while ident equality
  stays.
- The 115200 probe runs only after every 9600 attempt failed, so no classic radio that
  answered receives it. The 57600 UV17 and 38400 UV-K5 probes stay deferred; neither family
  is sold under a UV-5R name as often as the UV17Pro family.
- The UV-6 and F-11 are recognized and refused.
- `UV5R_MAGIC` is an environment variable. A flag can follow when a second radio is on the
  bench.

## Open questions for the bench

1. Does a magic that gets no `06` need any pause before the next magic? Send `ORIG` then
   `291` back to back on the bench unit. A yes cuts the `identify` budget by about 20 s.
2. Does the bench unit ack the `ORIG` magic as well as `291`? Decides whether the first ack is
   authoritative.
3. Does the ident change with the band limits? The UV-5R menu has no band-limit item. Chirp
   writes them at `0x1FC0`. Test only with a fresh dump in hand, since the write lands in the
   aux area.
4. Does the radio send its `06` in reply to the host's `06` after a block, or as a prefix to
   the next reply? A gap test after a read settles it.
5. What does a radio left mid-handshake by a foreign probe do? Decides the remedy text.
6. Does a UV17Pro radio answer anything at 9600, and does a 115200 magic have any effect on a
   classic radio? None is on the bench. The sequence above assumes no to both.
