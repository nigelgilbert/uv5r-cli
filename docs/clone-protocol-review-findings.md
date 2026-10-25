# Review findings: clone protocol, PR 3

Status: open, 2026-10-25. Findings from `/code-review` of PR 3 (`feature/clone-protocol` at
ee631ea), checked by two Sonnet reviewers and GPT-6.1 Sol in one cycle. A second cycle, an Opus
review with GPT-6.1 Sol over two consensus rounds, added findings 11 to 20 and found 3
independently.

Verdict: findings 2, 3, 4 and 11 are low-severity bugs. Fix them, and close the test gaps in 12
and 13. Findings 1 and 5 hold but change nothing on the bench. Finding 9's retry-loop claim is
wrong. Findings 6, 7, 8, 10 and 14 to 20 are cleanups. Neither cycle found a wire-protocol,
timing or baud-reset bug.

| # | Sonnet | Sol | Call |
|---|---|---|---|
| 1 | Confirmed, negligible | Confirmed, medium | Optional |
| 2 | Confirmed, low | Confirmed, low | Fix |
| 3 | Confirmed, low | Confirmed, medium | Fix |
| 4 | Confirmed, low | Confirmed, medium | Fix |
| 5 | Partial, very low | Confirmed, low | Optional |
| 6 | Confirmed, low value | Partial, low | Optional |
| 7 | Partial | Refuted | Defer |
| 8 | Partial, trivial | Partial, none | Optional, with 10 |
| 9 | Refuted | Partial, none | Drop |
| 10 | Confirmed, trivial | Partial, none | Optional, with 8 |

Second cycle:

| # | Opus | Sol | Call |
|---|---|---|---|
| 11 | Confirmed, minor | Found, minor | Fix |
| 12 | Found, minor | Confirmed, minor | Fix |
| 13 | Found, minor | Confirmed, minor | Fix |
| 14 | Found, nit | Found, nit | Optional |
| 15 | Confirmed, nit | Found, nit | Optional |
| 16 | Confirmed, nit | Found, nit | Optional |
| 17 | Confirmed, nit | Found, nit | Optional |
| 18 | Confirmed, nit | Found, nit | Optional |
| 19 | Found, nit | Confirmed, nit | Optional |
| 20 | Found, nit | Confirmed, nit | Optional, with 6 |

## Fix

### 2. Session.start reports only the last attempt

`src/core/protocol.ts:157`. Attempt 1 gets a wrong ack. Attempt 2 is silent. The error says
"radio did not answer the clone handshake; check the radio is on and the cable is seated" with
an empty `got`.

Fix: keep the last non-empty `got` across attempts. When the final attempt is silent and an
earlier one got a wrong ack, build the wrong-ack error from that byte.

### 3. scanFailed labels an unsupported magic's bad ident an unknown UV-5R variant

`src/core/radio.ts:213` records `scan.invalid` for any classic magic whose ident fails to parse.
It does not check `magic.supported`. A malformed reply to F11, UV6 or UV6_ORIG with every other
magic silent ends in `protocol-reply-invalid` with retry `once`. The agent reruns a 29 s scan
and gets the same answer instead of `radio-unsupported`.

Fix: in `probe`, set `scan.invalid` only when `magic.supported`. Push the unsupported invalid
reply to `answers`.

### 4. A refused closing 06 gets retry `no` in identify and retry `once` in Session.start

`src/core/radio.ts:330`. `identify` gives the supported magic no second attempt on `refused`.
`probe` pushes the refusal to `answers` and the scan continues. With everything else silent,
`scanFailed` throws `session-unavailable` with retry `no` and the remedy to report the answers
to the human. `Session.start` at `protocol.ts:153` throws the same reason with "wait 3 s and
rerun the command" and retry `once`. `test/core/radio.test.ts:556` pins the answers shape and
leaves the retry value unasserted.

Fix: in `scanFailed`, when `answers` holds a `refused` entry, set retry `once` and the remedy
"wait 3 s and rerun the command".

### 11. A58 with BF-A58 firmware classifies as BF-F8HP

`src/core/ident.ts:64`. A BF-A58 that answers only A58 reports a `BFT515` or `BFT517` version.
`classify` matches the generic `BFT` and returns `family: bf-f8hp` with `triPower: true`.
`identify` prints pin `UV5R_MAGIC=A58`, and later verbs write UV-5R-layout records to a radio
with the WP970I layout. Spec 4.2 says the version string separates the two radios.

Fix: for magic A58, match `BFT515` and `BFT517` before `BFT`. Throw `radio-unsupported` naming
the BF-A58 from `identify` and `Session.start`. `classify` keeps its no-throw rule.

### 12. The 3 s pause after a first-magic wrong ack is untested

`src/core/radio.ts:243`. Changing the pause to 2 s passes all 552 tests. The README `identify`
timing section states 3 s.

Fix: add an `identify` test where 291 gets a wrong ack twice. Assert a gap of
`SETTLE_MS + SEND_MS`.

### 13. Read-only settings can drop UV5R_MAGIC with no test failing

`src/cli/main.ts:915`. Removing `{ magic }` from the read-only `withSession` call passes every
test. The same change fails a test for `status`, `read`, `erase`, `tune` and `load`.

Fix: add `settings` with no field/value pairs to the `UV5R_MAGIC` cases in
`test/cli/cli.test.ts`.

## Optional

### 1. Ident read window shrinks from 350 ms to 300 ms

`src/core/protocol.ts:96`. The transport read at `transport.ts:103` polls until it holds `n`
bytes or the deadline passes. An 8-byte or 12-byte ident never reaches 14 bytes, so the old
`sleep(300)` plus `read(12, 50)` and the new `read(14, 300)` both wait the full deadline. The
cutoff moved from 350 ms to 300 ms. The ident lands in about 10 ms (`protocol.ts:29`).

Optional: raise `IDENT_WAIT_MS` to 350.

### 5. Session.start takes an unsupported Magic

`src/core/protocol.ts:141`. `start`, `withSession` and `startFreshSession` skip the
`supported` check. `src/core/index.ts` exports `magicByName`, which throws on unsupported
names. Only a deep import of `ident.ts` reaches an F11 `Magic`.

Optional: throw `radioUnsupported` at the top of `start`, before it sends bytes.

### 6. Foreign errors put the radio name in the magic field

`src/core/radio.ts:264` passes `entry.radio` twice to `radioUnsupported`. `FOREIGN_MAGICS`
entries carry no name (`ident.ts:43`).

Optional: pass `hex(entry.bytes)` as the `magic` argument in the two throws. Leave the attempt
log and `answers` unchanged.

### 8. The default magic is resolved twice

`src/core/radio.ts:238` and `src/core/protocol.ts:7` both call `magicByName(DEFAULT_MAGIC)`.
`scanOrder` at `radio.ts:211` repeats the `MAGICS.find` lookup that `ident.ts:110` has as
`findMagic`. `magicByName` throws on unsupported names, and the scan needs F11, UV6 and
UV6_ORIG.

Optional, with 10: export the default `Magic` and `findMagic` from `ident.ts` and use them in
both files.

### 10. protocol.ts exports MAGIC for tests only

`src/core/protocol.ts:9`. Production code uses the unexported `DEFAULT`. Importers are
`test/core/fake.ts:1` and `test/core/settings.test.ts:4`. `docs/core-cli-split-plan.md:69`
already plans to move `MAGIC` into `ident.ts`.

Optional, with 8: delete `MAGIC` and replace both test imports with `magicByName('291').bytes`.

### 14. SCAN_ORDER differs from spec 4.6

`src/core/ident.ts:40` runs A58 and UV5G before F11, UV6 and UV6_ORIG. Spec 4.6 step 1 lists
them after and calls its order a proposal. README, help and tests follow the code.

Optional: update spec 4.6 step 1 to the implemented order, supported magics first.

### 15. Unmatched A58 firmware sets triPower

`src/core/ident.ts:180`. A blank or unmatched version under A58 keeps the `bf-f8hp` family, which
`TRI_POWER` lists. Spec 4.6 step 6 gives such a radio two power levels.

Optional: set `triPower` false when `basetype` is null.

### 16. Help text on the first magic's wait reads as a wait before the first send

`src/cli/main.ts:223` says "The first magic waits 3 s before it". The code waits before the
first magic's second attempt.

Optional: "The first magic's second attempt waits 3 s, as every radio verb does."

### 17. "pin null means no prefix" fails after a prefixed identify

`README.md:110`, `.claude/skills/uv5r/SKILL.md:21` and the remedy at `src/core/protocol.ts:32`.
`UV5R_MAGIC=UV82 uv5r identify` on a radio that answers only UV82 gives `pin: null`. Later
commands with no prefix open with 291 and fail. The documented workflow runs identify with no
prefix, which avoids this.

Optional: "When `pin` is null, keep the `UV5R_MAGIC` setting identify ran with."

### 18. No test covers a serial failure during the 115200 probes

`test/core/radio.test.ts:491-520` covers only `setBaud` failures. The `finally` at
`src/core/radio.ts:300` handles a rejecting write or read.

Optional: add a test where the read at 115200 rejects. Assert the reset to 9600 and the
original error.

### 19. Neither input discard is tested

`src/core/protocol.ts:87` and `src/core/radio.ts:283`. Removing either `transport.discard()`
passes every test. Spec 4.6 step 1 starts with "Drain input".

Optional: add a test that preloads stale bytes before a handshake.

### 20. radio-unsupported reports the collapsed ident in got

`src/core/radio.ts:248` and `:263` pass `hex(outcome.bytes)`. A 12-byte reply shows as its 8
collapsed bytes.

Optional, with 6: carry the raw reply hex on the `ident` outcome and report it in `got`.

## Defer

### 7. selectedMagic threads through 11 call sites

`src/cli/main.ts:588`. Every radio verb calls `selectedMagic()` and passes `{ magic }`.
`SessionOptions.magic` is optional at `radio.ts:120`, so a call site that omits it falls back
to 291. No current path omits it. Resolving the magic in `withTransport` or on the `Invocation`
breaks `holdPtt` and `listen`, which open the port without a session, and `identify` uses the
pinned magic as the first scan entry.

Defer. If revisited, add a `withRadio` helper for the session verbs or make `magic` required on
the CLI helper options.

## Dropped

- 9. `Session.start` sleeps 3 s before its one retry and throws on refused or invalid.
  `identify` retries only on silent or wrong ack, pauses `SETTLE_MS` only before the first
  magic's retry, and continues the scan on refused, invalid or foreign. The suggested
  `{ ...id, ident: hex(id.bytes), pin }` leaks `bytes` into the JSON. Keep the field copy.
