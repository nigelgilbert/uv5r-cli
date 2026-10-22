# Agent-friendliness review, 2026-10-22

Scope: the `uv5r` CLI, `README.md` and `.claude/skills/uv5r/SKILL.md` at commit 5be0a21.
Goal: a weak agent operates the radio without misreading state, wasting context or
transmitting by accident. That agent may run outside Claude Code and never load SKILL.md.

Method: a first review, then an adversarial pass by Codex and a merge both reviewers signed
off. Error paths ran with `UV5R_TARGET=/dev/nonexistent`. The bench results below ran
on the radio. Every file:line was checked at 5be0a21.

## Owner decisions

- Agents may transmit. `key` stays a public verb.
- `check` always writes a receive-only record.
- Slot 0 is the scratch slot. Examples and operating rules use `check --channel 0`, and
  `sweep` always works through slot 0. On a failed check, the agent asks the human to
  select slot 0 in MR mode. `check` still accepts other slots. `tune` and `load` write any
  slot. Slot 127 was considered and rejected; see the bench results.
- `sweep` has one mode: rewrite slot 0 with each plan entry and listen. Knob mode (issue
  007) goes. The plan names its own check frequency.
- Big Sky plans and slots are defunct test data.

## Bench results, 2026-10-22

Radio HN5RV011, AIOC 1209:7388, MR mode on slot 127, slot 127 set to 162.400 receive-only.

- **Slot 127's name ignores writes.** Writing name `SCRATCH` twice left bytes 0-5 unchanged
  and changed byte 6. The record at `0x07F0` took the write. The name at `0x17F0` reads
  `154.68H`. `tune` and `check` on 127 exit 5 with `channel 127 name did not take the
  write` after the frequency has changed.
- **`key` on a receive-only slot asserts PTT and transmits nothing.** `key --seconds 2`
  printed `{"keyed":true,"seconds":2}`. The radio LED stayed green, the AIOC LED flashed
  green, and receive audio fell to the AIOC floor (about -71 dBFS) for the hold.
- **Port open and close showed no PTT.** Eight back-to-back `status` runs blinked the radio
  LED red. A real key on the same slot never turned it red, so the red blink is clone
  traffic. A PTT glitch shorter than the clone traffic is still unmeasured; see open items.
- **The receiver is deaf during clone sessions.** Receive audio sat at about -71 dBFS
  through back-to-back `status` runs. The only sound per cycle was a 2 s voice prompt after
  each reload. Each back-to-back `status` took 5.7 s because the handshake retry waits 3 s.
- **The radio speaker is silent while the AIOC is plugged in.** The human hears receive
  audio only through `listen --out FILE --play` or `sweep --out-dir DIR --play`.
- **Activity levels at squelch 3:**

  | Condition | RMS per second | Active at -50 dBFS |
  |---|---|---|
  | NOAA 162.400 speech | -9 to -36; pauses about -44 | 31 of 31 s over three captures |
  | Receive muted by PTT or clone session | about -71 | 0 |
  | No signal | about -74 | 0 of 8 s |

- **`peakDbfs` above 0 without a warning.** Two NOAA captures peaked at 1.38 and 0.8 dBFS
  with `warnings: []`. SKILL.md and README say a peak above 0 means the input clips.

## Keep

Keep these when implementing:

- Strict arguments: unknown flags, a flag from another verb and extra positionals exit 2
  before the port opens.
- JSON on stdout when piped. JSON errors on stderr.
- Usage errors that name the flag, the range and a command to copy. An off-table tone lists
  the nearest tones.
- `appliesAfterSeconds` on `tune`, `load` and `erase` results.

## Work items

Do them in this order. Each item lists the problem, the change and a check that it is done.

### 1. Make results state only what the CLI observed

Problem:
- `check` passes on one active second (src/check.ts:33). Its `channel` and `rxMhz` echo
  the request (src/check.ts:32).
- README.md:27-32 and SKILL.md:35-39 say exit 0 proves MR mode on slot N.
- SKILL.md:127-129 treats `check` as proof and silence as proof the radio is off the slot.
  src/main.ts:465 says `--check` confirms the slot.
- `check` builds a TX-capable record (src/main.ts:264, :182) and leaves it in the slot
  (src/check.ts:29).
- `sweep` labels each dwell with the plan entry (src/sweep.ts:88-90). The
  written slot is absent from the result.

Change:
- Force `rxOnly` inside `checkChannel`. Reject `--offset` and `--tone` on `check` with exit 2.
- Require 5..600 seconds on `check`; `--seconds 1` exits 2 before the port opens. Pass
  when `activeSeconds >= Math.ceil(0.8 * active.length)`; otherwise exit 5. The bench's
  31 of 31 active NOAA seconds support this cutoff as a heuristic.
- In `check` results, replace `channel` and `rxMhz` with `slot` and `requestedMhz`. In
  `sweep` dwell records and summary `active` entries, keep the plan `channel`, replace
  `rxMhz` with `requestedMhz`, and add `slot: 0`. The frequency the radio received stays
  unverified.
- Word the success meaning as: audio above the floor after writing slot N, consistent with
  the radio receiving slot N. Word the exit-5 message as a list of causes: VFO mode,
  another slot selected, volume knob down, plug unseated, quiet frequency.
- Rewrite the check rule in README.md:27-32, SKILL.md:35-39, SKILL.md:127-129, the doc
  comment at src/check.ts:22-27 and the error at src/main.ts:465 to match.
- Document the slot state after a run. Once the `check` write succeeds, slot 0 stays
  overwritten and receive-only, also after a capture failure, and nothing restores it. A
  failure before or during the write leaves the state unknown. Sweep dwells write
  each plan entry with its own TX setting.

Done when:
- `check 162.400 --channel 0 --offset 0.6` exits 2.
- A test with 3 of 5 active seconds exits 5 and 4 of 5 exits 0.
- No doc or message says `check` proves the mode or slot.

### 2. Make `sweep` one unattended mode

Problem:
- The CLI cannot select a channel. The radio acks and ignores writes to channel select
  and the VFO (README "How the radio takes a frequency"). Rewriting the slot the radio is
  parked on is the only way to sweep.
- Knob mode is the default and needs a terminal on stdin. An agent's Bash call exits 2
  (src/main.ts:478-480).
- The agent-usable mode needs `--scratch N` and exactly one of `--check MHZ` and
  `--no-check` (src/main.ts:456-467).
- `--check 162.400` assumes that NOAA transmitter is audible. `channels.example.json:5`
  records no audio on 162.400 at the last location.

Change:
- Reduce the verb to `uv5r sweep PLAN.json [--seconds S] [--out-dir DIR] [--play]
  [--device NAME] [--floor DBFS] [--verbose]`.
- Remove `verifyPlanSlots`, `planRecord` (only `verifyPlanSlots` calls it), `Lines`,
  `readLines`, `knobSlot` and their unused imports from src/sweep.ts and src/main.ts.
  Remove the stdin guard at src/main.ts:478-480. Replace the mode branch at :493-508 with
  the one sweep path. Keep plan reading, output directory setup and dwell reporting at
  :481-492.
- Remove `--scratch`, `--check` and `--no-check` from the flag list, help and
  `checkFlags`. Remove the knob-mode tests and helpers. Update the scratch-mode tests and
  help assertions.
- Add a top-level plan field `checkMhz`. `parsePlan` validates it when present, with the
  band and 10 Hz rules of entry `rxMhz`, and its errors name `checkMhz`. `sweep` requires
  it and exits 2 before the port opens when it is missing. `load` ignores it.
- Add `checkMhz` to `channels.example.json`, the README plan fields table and the
  channel-plan skill. The skill picks the NOAA transmitter most likely audible at the
  location, records the uncertainty in `notes`, and asks the human when none fits. Leave
  `scenarios/` alone; it is historical and is not a loadable plan.
- Run every sweep in this order. The human has slot 0 selected in MR mode first. Run a
  receive-only `check` on slot 0 with `checkMhz` for 5 s under the item 1 threshold. A
  failed check exits 5 before any plan entry is written. Then, for each entry, write slot
  0, wait for the reload and dwell. `--seconds` sets the dwell only.
- Add `slot0` to the success, interrupted and error summaries. It holds `{channel, name}`
  of the last fully verified entry write, also when its dwell did not finish;
  `{channel: null, name}` when only the check write succeeded; `null` when the contents
  are unknown, as after a failed write. It reports what was written; the received
  frequency stays unverified.
- Rewrite the sweep sections of README, SKILL.md and help to match.

Done when:
- With FakeRadio, mocked `listen`, fake timers and non-TTY stdin, `sweep plan.json`
  succeeds with no flags. A 5 s check runs before 30 s dwells, every write targets slot 0,
  and no stdin input is read.
- A failed check writes no plan entry.
- `--scratch`, `--check` and `--no-check` each exit 2 before the transport opens.
- A plan without `checkMhz` makes `sweep` exit 2 and `load` succeed.
- Interrupted and error summaries carry `slot0` independent of finished dwells.
- No source, help, README, skill or test describes knob mode or its flags. History files
  may still mention it.

### 3. Make `key` report what it did

Problem:
- `key` prints `keyed: true` on a receive-only slot that transmitted nothing (bench).
- A failure in `setPtt(false)` at src/radio.ts:309 throws a bare transport error, and the
  result drops the fact that PTT rose (src/main.ts:329-336).
- `channels.example.json:5-7` writes NOAA entries that can transmit.

Change:
- Rename `keyed` to `pttAsserted`. Track assertion and release separately.
  `pttAsserted: true` follows a successful assertion; `false` means it was unconfirmed.
  `released: true` follows a successful release.
- On a failure, print a JSON error with `pttAsserted`, `released` and `phase`. An
  unconfirmed release tells the human to unplug the AIOC. Give no automatic retry advice
  for `key`.
- In `help key` and SKILL.md, state that `key` raises PTT on the channel the display
  shows, that the CLI cannot read that channel, and that a receive-only slot radiates
  nothing. Tell the agent to ask the human for the display before keying.
- Set `rxOnly: true` on the NOAA entries in `channels.example.json`.

Done when:
- A fake transport whose release fails after a successful assertion yields
  `pttAsserted: true`, `released: false` and a nonzero exit.
- A fake whose assertion and release both fail yields `pttAsserted: false`,
  `released: false`.
- `load channels.example.json` writes NOAA records with `txMhz: null`.

### 4. Make CLI help the canonical reference

Problem:
- `help VERB`, `VERB --help` and `help --json` print the same 55-line text (src/main.ts:514).
- An unknown verb or `-h` returns 4,005 bytes of help inside the JSON error (src/main.ts:519).
- `--version` prints help. `help nonsense` and bare unknown flags exit 0 with full help.
- Option rows with `check` and `sweep` in the flag column (src/main.ts:127, :134, :139).
- Duplicate flags overwrite silently (src/args.ts:23-30): `tune 154.68 --channel 1
  --channel 2` reaches the port. `--floor 100` passes validation.
- The `tune` summary says "the channel the radio shows" (src/main.ts:78). The
  missing-channel error says to read the display (src/main.ts:247).

Change:
- Hold each verb's usage, flags, effects, preconditions, writes-to-radio, result example
  and exit cases in the `verbs` table. Generate text help, `help VERB` and `help --json`
  from it.
- Put the operating rules in `help --json`: the check-first rule, the scratch slot and the
  channel rule. Point exit-code guidance at each error's `reason` and remedy, with no
  blanket retry per exit code. Include flag defaults and a schema version. A weak agent
  outside Claude Code reads these there.
- Return `unknown verb "X"; verbs: status, tune, ...; run uv5r help VERB` for an unknown
  verb. Treat `-h` as `--help`. Add `version` to package.json and print it for
  `--version`. Exit 2 on an unknown help subject and on a bare unknown flag.
- Reject a repeated flag with exit 2. Bound `--floor` to -100..0.
- Use one channel rule everywhere: `--channel N` writes memory slot N. The radio receives
  slot N after the reload when it is in MR mode with N selected on the active display
  line. The display may show a name or a frequency. The CLI cannot read the display, so
  ask the human when it matters which channel the radio is on.

Done when:
- `help tune --json | jq .` parses and holds the fields above.
- The unknown-verb error is under 300 bytes.
- Help, README and SKILL.md state the channel rule in the same words.

### 5. Make failures recoverable

Problem:
- Exit 5 has 17 error sites and exit 3 has 10. `kind` repeats the exit code. The remedy
  lives in English prose.
- `load` stops mid-plan and names no finished channels (src/main.ts:288-294). A `sweep`
  error drops the summary (src/sweep.ts:219-229).
- A name failure after the record landed reads `did not take the write` (src/radio.ts:166,
  bench slot 127).
- `no device at PATH` carries no remedy (src/transport.ts:70).

Change:
- Add `reason` to every error from this enum: `device-unavailable`, `serial-io-failed`,
  `ptt-control-failed`, `dependency-missing`, `audio-process-failed`,
  `capture-incomplete`, `session-unavailable`, `protocol-reply-invalid`,
  `write-unacknowledged`, `verification-failed`, `image-incompatible`, `audio-inactive`,
  `invalid-argument`, `device-busy`, `serial-timeout`, `unexpected-error`. The last four
  cover usage, busy, serial read or ack timeout, and unexpected errors.
- Keep `kind` and the existing detail fields. Add a machine-readable remedy and retry
  guidance per error site. A post-write verify failure uses `verification-failed`, and
  its remedy and retry guidance account for any known partial write.
- Add `written` to `load` and `sweep` errors: the fully verified writes in order. For
  `sweep` that is the check write and each slot 0 entry write, each with `phase`, `slot`,
  `requestedMhz` and plan `channel` (`null` for the check). Track writes separately from
  finished dwells. Add the failing slot, `phase` and any known partial write as separate
  fields.
- On a `sweep` error, print the finished dwells as the summary on stdout and the error on
  stderr, as the signal path does.
- Split the name failure: `channel N record written; name did not take the write`, with
  `recordWritten: true`.

Done when:
- Every `BaofengError` in src/ carries a `reason`.
- A fake that fails the third channel's record write, after two full record-and-name
  writes, yields `written` with two channels.

### 6. Trim and align the docs

Change:
- README: a quickstart on top with a verb table (verb, writes to radio, time, result keys).
  Protocol notes stay below it.
- SKILL.md: a short adapter. Keep the operating rules and point at `uv5r help VERB --json`
  for flags and result shapes.
- Remove the voice/beep repair instruction at SKILL.md:75-77. README.md:143-144 says the
  bench has not confirmed it.
- Remove the 2026-10-18 history at SKILL.md:102.
- Drop `--verbose` from the routine sweep example.
- Add `--seconds 5` to the `listen --out FILE --play` example at SKILL.md:91.
- State that the radio speaker is silent while the AIOC is plugged in and the human hears
  audio only through `--play`.
- State that the receiver is deaf during a clone session and that back-to-back verbs take
  about 3 s longer for the handshake retry.
- Pick one clipping rule. Either warn when `peakDbfs` is above 0, or drop the peak-above-0
  sentence from README and SKILL.md.
- Mark the Big Sky material, `scenarios/big-sky-2026-10.json` and its SKILL.md mention, as
  historical test data. Remove current recommendations based on it.

Done when: SKILL.md runs at most 60 lines. It keeps the operating rules and how to find
`help`, and duplicates those on purpose. Flags and result shapes live only in CLI help.

### 7. Deferred: rehearsal target

`test/fake.ts` fakes serial only and keeps state per `FakeRadio` instance (test/fake.ts:26-48).
`listen`, `check` and `sweep` call ffmpeg (src/audio.ts:244). A `UV5R_TARGET=fake` needs
persisted state, fake audio and `target: "fake"` on every result and error. Ship offline
plan validation and checked-in output examples first.

## Open bench items

- **PTT glitch on port open.** src/transport.ts:73-82 opens the port and then drops DTR
  and RTS. Measure DTR, RTS and PTT or RF together, from before the open through the close,
  on a TX-capable slot at low power on a frequency the owner may transmit on. Use an SDR or
  the tinySA for RF. Cover repeated opens, a failed open and a failed release. The LED
  observations so far leave a short transient possible.
- **Slot 127.** Dump the image and compare `0x17F0` with the 2026-10-12 fixture to tell a
  firmware-reserved area from EEPROM damage.
