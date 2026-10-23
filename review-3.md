# Review 3: PR #1, feature/improve-cli-for-small-models

Date: 2026-10-23

This review covers the branch at commit 780d1d7. Every finding below was checked against the current source. All 311 tests pass.

Items run from highest to lowest priority. Each one names the code, describes what an agent sees, and gives the fix.

## Findings

### 1. Open squelch makes `check` pass and `sweep` report every entry active

Location: [src/check.ts:36-48](src/check.ts#L36-L48), [src/sweep.ts:144-150](src/sweep.ts#L144-L150), [src/sweep.ts:164-166](src/sweep.ts#L164-L166), [src/main.ts:213](src/main.ts#L213), [src/main.ts:382](src/main.ts#L382)

`check` passes when 80% of the captured seconds read above -50 dBFS. `sweep` lists an entry as active after one second above that floor. The bench notes record squelch 3 at -71 dBFS and squelch 0 at -1 dBFS on the same frequency ([docs/rx-audio-investigation.md:261-262](docs/rx-audio-investigation.md#L261-L262)). At the reference knob position open-squelch static reads -16 dBFS ([docs/rx-audio-investigation.md:264-265](docs/rx-audio-investigation.md#L264-L265)). With squelch 0 and the knob up, every second is active on every frequency.

Failure scenario: an agent sets squelch 0 to set the volume knob, which the README's level guidance assumes ([README.md:112-114](README.md#L112-L114)). It then runs `uv5r check 162.400 --channel 0`. The check passes in VFO mode and on a dead frequency. A sweep marks all seven plan entries active with 30 of 30 seconds each. Nothing in the output says why.

The `check` and `sweep` preconditions name MR mode, slot selection and a frequency with audio. Neither names squelch. `status` reports squelch, and the SKILL tells the agent to start with `status`, but no rule connects the two.

Fix: call `readSettings` ([src/radio.ts:62-64](src/radio.ts#L62-L64)) in the clone session that already writes the slot, in both `checkChannel` and `slotZero.check`. When squelch is 0, fail before the write with a new exit-5 reason such as `squelch-open` and the remedy `uv5r settings squelch 3`. Keep `audio-inactive` for a capture that ran. Add "squelch above 0" to the `check` and `sweep` preconditions and to the SKILL.

### 2. Top-level plan fields other than the four known ones are dropped without an error

Location: [src/plan.ts:52-68](src/plan.ts#L52-L68), [src/plan.ts:99-102](src/plan.ts#L99-L102), [src/plan.ts:115-121](src/plan.ts#L115-L121), [src/main.ts:238](src/main.ts#L238)

`parsePlan` reads `checkMhz`, `name`, `notes` and `channels` and ignores every other top-level key. It also drops a `name` or `notes` that is not a string. Entries reject unknown fields and bad types. The `load` help says a bad or unknown field exits 2.

Failure scenario: an agent writing a public-safety plan puts `"rxOnly": true` at the top level to cover every entry. `parsePlan` ignores it and builds each entry with `rxOnly: false` and a TX frequency equal to RX. `load` writes TX-capable records. A later `key` on one of those slots, once the human asks for it, transmits on a public-safety frequency. A misspelled `"checkMHz"` gives a sweep error that says the plan has no `checkMhz`, with no hint at the typo.

Fix: reject top-level keys outside `name`, `notes`, `checkMhz` and `channels` with a `UsageError` naming the key and the allowed list. Reject a `name` or `notes` that is not a string.

### 3. `check` and `sweep` write the slot before they test ffmpeg and the output directory

Location: [src/check.ts:56-60](src/check.ts#L56-L60), [src/sweep.ts:144-154](src/sweep.ts#L144-L154), [src/sweep.ts:113-115](src/sweep.ts#L113-L115), [src/audio.ts:253-261](src/audio.ts#L253-L261), [src/main.ts:815-821](src/main.ts#L815-L821)

Both verbs write the slot, wait 3 s for the reload, then start ffmpeg. A missing ffmpeg surfaces as `dependency-missing` after the write. `sweep --out-dir` runs `mkdirSync` with `recursive: true`, which succeeds on an existing directory the process cannot write. ffmpeg then fails on the first dwell, after the check write and the first entry write.

Failure scenario: on a host without ffmpeg, `uv5r check 162.400 --channel 0` overwrites slot 0, waits 3 s and exits 3. The slot holds the receive-only record of a check that never listened. With a read-only `--out-dir rx`, `sweep` writes slot 0 twice and exits 3 with `audio-process-failed`. That reason's remedy says to check `--device` and microphone access ([src/errors.ts:102-107](src/errors.ts#L102-L107)), so the agent chases the wrong cause.

Fix: before opening the serial port, run `ffmpeg -version` with a short timeout in `check` and `sweep`. Map ENOENT to `dependency-missing` and any other failure to `audio-process-failed`. Test `--out-dir` with `accessSync(outDir, W_OK | X_OK)` after the `mkdirSync` and throw a `UsageError` naming the directory. A wrong device or denied microphone access still fails after the write; item 8 covers that error.

### 4. A signal sent to the CLI alone waits out the sweep dwell, and most verbs print nothing on a signal

Location: [src/sweep.ts:189-196](src/sweep.ts#L189-L196), [src/sweep.ts:149](src/sweep.ts#L149), [src/sweep.ts:209](src/sweep.ts#L209), [src/audio.ts:71-72](src/audio.ts#L71-L72), [src/audio.ts:248-251](src/audio.ts#L248-L251), [src/main.ts:112](src/main.ts#L112), [src/main.ts:277](src/main.ts#L277), [README.md:81-82](README.md#L81-L82), [SKILL.md:52-53](.claude/skills/uv5r/SKILL.md#L52-L53)

`runSweep` races the settle against a signal but awaits the check capture and each `dwell` with no race. The ffmpeg child has no link to the signal. A Ctrl-C at a terminal reaches ffmpeg through the process group. A SIGTERM sent to the node process alone does not, so the capture runs to its end. Only `holdPtt` and `runSweep` install signal handlers, and only while they run. On a signal outside them, the process dies with Node's default and prints nothing. A `key` whose PTT release fails after a signal exits 3 with `interrupted` in the error. The error guidance in `help`, the README, the SKILL and the `key` effects say an exit of 128 plus a signal number prints the result with `interrupted`.

Failure scenario: an agent harness times out `uv5r sweep plan.json --seconds 600` and sends SIGTERM to the process. ffmpeg was asked for 684 s with a 699 s timeout, so the sweep keeps listening. The harness escalates to SIGKILL and the agent gets no summary and no `slot0`. A SIGTERM during `check` exits 143 with empty stdout, which the docs say does not happen.

Fix: pass `stop.stopped` into the check capture and into `dwell`, kill the ffmpeg child when it resolves, and wait for the child to exit. Scope the signal sentence in the error guidance, the README, the SKILL and the `key` effects to `key` and `sweep` once they hold the radio, and name the exit-3 case for a failed release.

### 5. `--device` lets `check` and `sweep` pass on any audio input

Location: [src/main.ts:130](src/main.ts#L130), [src/main.ts:596-597](src/main.ts#L596-L597), [src/main.ts:805](src/main.ts#L805), [src/audio.ts:88](src/audio.ts#L88), [src/sweep.ts:57-69](src/sweep.ts#L57-L69)

`check` and `sweep` take `--device` by name or index and hand it to ffmpeg. Nothing ties the input to the radio. The preconditions name ffmpeg and microphone access and omit the input. The `check` result echoes the `--device` string. The sweep summary omits it.

Failure scenario: the default `AIOC Audio` fails to open. The agent tries `--device 0`, which on a Mac is often the built-in microphone. Room noise or speech above -50 dBFS passes the check, and the agent tunes slot 0 on a check that never heard the radio.

Fix: add "--device names the AIOC input" to the `check` and `sweep` preconditions and to the `--device` help on both verbs. Add `device` to the sweep summary.

### 6. The `--play` failure remedy leads to overwriting the saved WAV

Location: [src/audio.ts:229-241](src/audio.ts#L229-L241), [src/audio.ts:126](src/audio.ts#L126), [src/errors.ts:96-107](src/errors.ts#L96-L107), [src/main.ts:348-349](src/main.ts#L348-L349)

When `afplay` fails, the remedy says the WAV is on disk and to drop `--play` and rerun. Both playback errors take `retry: after-remedy` from their reasons. A rerun of `listen` with the same `--out` captures again, and ffmpeg's `-y` overwrites the file. The `--out` help does not say it overwrites.

Failure scenario: `uv5r listen --seconds 30 --out rx.wav --play` catches a dispatch call, then `afplay` times out. The agent reruns without `--play`, records 30 s of silence over `rx.wav`, and the call is gone.

Fix: at the two `afplay` error sites, set the remedy to "the capture is saved at file; ask the human to play it; do not capture again" and `retry: no`. Add "overwrites FILE" to the `--out` help.

### 7. `read` reports a record with malformed BCD as an empty slot

Location: [src/codec.ts:228-235](src/codec.ts#L228-L235), [src/radio.ts:42-43](src/radio.ts#L42-L43), [src/main.ts:248](src/main.ts#L248)

`decodeChannel` returns undefined when the first byte is 0xFF and also when the RX or TX frequency bytes are not valid BCD. `channelPayload` turns both into `{"channel": N, "empty": true}`. The `read` help says that shape means an empty slot.

Failure scenario: a slot holds a record with a valid RX frequency and TX bytes `ff 00 00 00`. `uv5r read N` exits 0 with `empty: true`. The agent reports the slot as free, and the record stays on the radio.

Fix: return `{"channel": N, "malformed": true, "raw": HEX}` for a record whose first byte is not 0xFF and whose BCD fails to decode, and document it in the `read` help and the README.

### 8. `check` capture errors omit the slot and frequency

Location: [src/check.ts:56-60](src/check.ts#L56-L60), [src/audio.ts:253-270](src/audio.ts#L253-L270)

When `listen` throws after the write, the error carries ffmpeg's detail and nothing about the radio. A `sweep` error in the same position carries `summary.slot0`. The `reason` field tells the two cases apart: `dependency-missing`, `audio-process-failed` and `capture-incomplete` come only from the capture. The help says the slot keeps the record after a capture failure.

Fix: attach `{slot: n, requestedMhz}` to errors from the `listen` call. Once item 3 lands, the ffmpeg-missing case moves before the write and only a failed capture reaches here.

### 9. `sweep` drops the warnings from its check

Location: [src/sweep.ts:149](src/sweep.ts#L149), [src/sweep.ts:74-79](src/sweep.ts#L74-L79), [src/sweep.ts:159-170](src/sweep.ts#L159-L170), [SKILL.md:42-43](.claude/skills/uv5r/SKILL.md#L42-L43)

`slotZero.check` calls `judgeCheck` and discards its result. The summary's `warnings` come only from the entry dwells.

Failure scenario: the NOAA check clips and passes. Every plan entry is quiet, so no dwell warns. The summary's `warnings` is empty, and the agent never asks the human to turn the knob down as the SKILL says.

Fix: store `heard.warnings` in `SweepProgress` before calling `judgeCheck`, and have `summarize` add them with a `check:` prefix. The warnings then also reach the summary of a failed check and of an interrupted sweep.

### 10. `help`, `help VERB` and `--version` print text when piped

Location: [src/main.ts:462-470](src/main.ts#L462-L470), [src/main.ts:838-840](src/main.ts#L838-L840), [src/main.ts:93](src/main.ts#L93), [src/main.ts:121](src/main.ts#L121)

`printHelp` and the `--version` branch test for an explicit `--json`. Every verb result goes through `wantsJson`, which also picks JSON when stdout is a pipe. The output rule printed by `help` says "JSON on stdout when piped or with --json". The `--json` flag's own help says "the default when stdout is not a terminal".

Failure scenario: an agent runs `uv5r help tune | jq .flags` and gets a text block. `jq` fails to parse. The same agent ran `uv5r status | jq .squelch` a moment earlier and it worked.

The SKILL tells the agent to pass `--json` to `help`, which covers the common path.

Fix: call `wantsJson(flags)` in `printHelp` and in the `--version` branch. Update the tests that call `help` or `--version` without `--json` and assert the text layout, such as [test/cli.test.ts:84-89](test/cli.test.ts#L84-L89), [test/cli.test.ts:218-223](test/cli.test.ts#L218-L223), [test/listen-cli.test.ts:82-87](test/listen-cli.test.ts#L82-L87), [test/sweep.test.ts:403-410](test/sweep.test.ts#L403-L410) and [test/parse.test.ts:114-118](test/parse.test.ts#L114-L118).

### 11. `settings` help says FIELD takes a menu index; the CLI accepts field names only

Location: [src/main.ts:325](src/main.ts#L325), [src/main.ts:553-556](src/main.ts#L553-L556), [src/codec.ts:310-312](src/codec.ts#L310-L312), [src/codec.ts:332-342](src/codec.ts#L332-L342)

The FIELD argument help reads "pairs to set, by radio menu index or by name". `settingsPatch` accepts only the names in `SETTINGS_FIELDS` as the field. The value takes a number or a listed name.

Failure scenario: an agent reads the help and runs `uv5r settings 0 3` to set squelch, menu 0 on the radio. It exits 2 with `unknown setting "0"`.

Fix: change the help to "FIELD is a field name; VALUE is a number or a listed name; fields lists both".

### 12. The exit table says "no ack" is exit 4; a missing write or handshake ack exits 5

Location: [src/main.ts:101](src/main.ts#L101), [src/errors.ts:162-166](src/errors.ts#L162-L166), [src/protocol.ts:71-92](src/protocol.ts#L71-L92), [src/protocol.ts:129-137](src/protocol.ts#L129-L137), [src/protocol.ts:169-170](src/protocol.ts#L169-L170)

Exit 4 reads "timeout: no ack or a short read". `serial-timeout` comes only from a missing ack before a block read and from a short block payload. A write with no ack throws `write-unacknowledged`, a handshake with no ack throws `session-unavailable`, and a short read header throws `protocol-reply-invalid`, all exit 5. The exit-5 line names "no handshake" and "a refused write", so the table lists the same event under two codes.

Fix: change the exit-4 line and the `serial-timeout` meaning to "no ack before a block read, or a short block payload".

### 13. The `write-unacknowledged` remedy names a slot for `settings` and `restore` writes

Location: [src/errors.ts:126-131](src/errors.ts#L126-L131), [src/radio.ts:75-77](src/radio.ts#L75-L77), [src/radio.ts:249](src/radio.ts#L249), [src/protocol.ts:170](src/protocol.ts#L170)

The reason's default remedy is "rerun the command; read the slot afterwards". `writeSettings` and `restoreImage` let the error through with that remedy. Neither writes a slot the agent can name.

Failure scenario: the radio refuses the 0x0E30 write during `uv5r settings squelch 3`. The agent reads the remedy, has no slot number, and runs `uv5r read 0`, which tells it nothing about the settings block.

Fix: catch `write-unacknowledged` in `writeSettings` and `restoreImage` and attach a remedy: "run uv5r settings to read the block, then rerun" for `settings`, and "rerun the restore" for `restore`.

### 14. `sweep` errors carry `phase`, `slot` and `channel` that no doc names

Location: [src/sweep.ts:198-213](src/sweep.ts#L198-L213), [src/main.ts:107-112](src/main.ts#L107-L112), [README.md:84-85](README.md#L84-L85), [SKILL.md:58-59](.claude/skills/uv5r/SKILL.md#L58-L59)

`runSweep` attaches `{phase, slot, channel}` to every error that is not a signal. The error guidance in `help`, the README and the SKILL say a sweep error adds `summary`. `slot` is always 0. `phase` takes `check`, `entry` or `dwell`, and `check` spans the write, the settle and the capture. `channel` is the plan channel, or null during the check. A failed check also carries the check result fields from `judgeCheck`, including a `seconds` of 5 beside `summary.seconds`. Errors before `runSweep`, such as a busy port, carry `summary` and none of the three.

Failure scenario: an agent sees `"phase": "entry", "channel": 5` next to `"summary": {"swept": 4, ...}` and has no documented meaning for either. It falls back to the message text.

Fix: document the fields in the error guidance, the README and the SKILL: "an error inside the sweep loop adds phase (check, entry or dwell), slot (0) and channel (the plan channel, null during the check); summary.slot0 says whether a write landed; a failed check also carries the check result fields".

### 15. `listen --out -` reports a WAV that no file holds

Location: [src/audio.ts:112-127](src/audio.ts#L112-L127), [src/audio.ts:251](src/audio.ts#L251), [src/audio.ts:216](src/audio.ts#L216)

ffmpeg reads `-` as stdout. `capture` collects the child's stdout and drops it. `listen` returns `out: "-"` with exit 0.

Failure scenario: an agent passes `--out -` to stream the capture, as many CLIs allow. The result reports `out: "-"`, no file exists, and with `--play` afplay fails on `-`.

Fix: reject `--out -` with a `UsageError` in `listenVerb`.

### 16. `dump` exits 2 for an unwritable `--out` after a 14 s read

Location: [src/main.ts:99](src/main.ts#L99), [src/main.ts:683-692](src/main.ts#L683-L692), [src/main.ts:299](src/main.ts#L299)

The exit table says "usage: bad input; argument errors exit before the port opens". `dump` opens the port, reads the whole image, then throws a `UsageError` when `--out` is not writable. The `help dump` exits list "FILE not writable" under exit 2. `dump` only reads the radio.

Failure scenario: `uv5r dump --out /nonexistent/radio.img` runs 14 s, holds the radio in clone mode the whole time, and exits 2. An agent that trusted the exit table concludes the port never opened and reruns at once. The handshake retry costs it 3 s more.

Fix: change the `dump` exit-2 note to "FILE not writable, found after the read". To move the check ahead of the read, open `--out` with flag `a` before `withTransport`. That catches a missing directory, a read-only file and a directory path, and leaves an empty file when the dump then fails.

### 17. `sweep` reports two spellings of one channel name

Location: [src/sweep.ts:119](src/sweep.ts#L119), [src/sweep.ts:141](src/sweep.ts#L141), [src/codec.ts:206-216](src/codec.ts#L206-L216)

`dwell` sets `name` from the plan entry as written in the file. `slotZero.write` sets `slot0.name` from the record read back, which `encodeName` uppercased and cut to 7 characters. Both objects carry the plan `channel`.

Failure scenario: a plan entry named "Sheriff Dispatch" shows up in `active` as `"name": "Sheriff Dispatch"` and in `slot0` as `"name": "SHERIFF"`. An agent matching the two by name finds no match.

Fix: state in the sweep effects that `active[].name` is the plan name, `slot0.name` is the name the radio holds, and the two match on `channel`.

### 18. Nits

- The `load` effects read "Check every entry before the port opens" and "Check checkMhz and write nothing for it" ([src/main.ts:229-231](src/main.ts#L229-L231)), and the README plan table says "`load` checks it" ([README.md:195](README.md#L195)). `check` is also a verb. Write "Validate".
- [src/main.ts:814](src/main.ts#L814) builds the sweep check spec with every default spelled out. Every `ChannelSpec` field except `rxHz` is optional and `receiveOnly` sets `rxOnly`. Pass `{ rxHz: plan.checkHz }`.
- The `key` result example shows `seconds: 2.003` ([src/main.ts:285](src/main.ts#L285)). `holdPtt` rounds the hold to 0.1 s ([src/radio.ts:364](src/radio.ts#L364)). Show `2`.
- `capture-incomplete` reports `captured` and `requested` with the dropped first second included ([src/audio.ts:265-269](src/audio.ts#L265-L269)), so `--seconds 5` can fail with `captured: 5, requested: 6`. Name the extra second in the reason's meaning at [src/errors.ts:108-113](src/errors.ts#L108-L113).
- [docs/rx-audio-investigation.md:298-299](docs/rx-audio-investigation.md#L298-L299) says `listen` keeps the first `seconds` frames. `summarize` skips frame 0 and keeps frames 1 to `seconds` ([src/audio.ts:173-176](src/audio.ts#L173-L176)), as [README.md:118-119](README.md#L118-L119) says.

## Checked and left alone

- `status` keeps `workmode`. The bench notes at [docs/rx-audio-investigation.md:73](docs/rx-audio-investigation.md#L73) show the byte at 0x0E4C flipping when the key changes mode.
- Ctrl-C during a sweep dwell. The terminal sends SIGINT to ffmpeg too. ffmpeg exits with a code, `capture` rejects, `runSweep` sees the signal and drops the error, and the summary prints with `interrupted` and exit 130. Item 4 covers a signal sent to the node process alone.
- Errors go to stderr in the format stdout would have used. With stdout piped and stderr on a terminal the error is JSON on the terminal. The output rule says "in the same format" and the SKILL repeats it.
- `UV5R_DEBUG=1` adds serial byte lines to stderr beside the error object. The README documents the variable as logging to stderr, and an agent sets it only on purpose.
- `load` after a failed entry write. The error names `slot`. `load` rewrites every plan slot on rerun, so no per-entry progress field is needed.
- `restore` exit 5 for a short image is unreachable. The exit-2 length check in `restoreVerb` runs first with the same threshold.
- `key` results carry `pttAsserted` and `released`, which are always true on success. A failed `key` throws before any result. The fields are documented in the help and the README, and no agent decision goes wrong on them.
- One helper for the write, settle, listen and judge sequence in `check` and `sweep`. The sweep copy records verified writes and races the settle against a signal. A shared helper needs both hooks and saves a few lines.
- `read` of the bench's corrupted slot 127 returns `empty: true`. Its first byte is 0xFF, which CHIRP also reads as an empty slot. Item 7 covers records whose first byte is valid.
- `test/check.test.ts:159-162` calls `help check` without `--json`. It asserts only that the example appears, which the JSON also holds, so item 10 leaves it alone.
