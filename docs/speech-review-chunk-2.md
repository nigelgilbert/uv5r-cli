# Review: speech plan, chunk 2

Date: 2026-10-25. Plan: [speech-plan.md](speech-plan.md).

Six Sonnet reviewers produced 109 stage 1 findings against `docs/speech-plan.md` at 9213e57. Sonnet workers verified each one, and this file keeps 33 items. Line numbers refer to `docs/speech-plan.md` at 9213e57 unless a file is named.

## Conflicts settled

- Control-operator rules (S13 against R5, R8). S13 as corrected wins (item 11). R5's approve, auto and deny-list proposals drop, its SKILL line 361 rewording folds in, and R8 drops with the check.
- Scope cuts against hardening. S1 (cut `mcp`), S2 (defer `converse`) and S6 (`whisper-cli` per segment) land. Hardening for the cut features drops: E9, F5, F7, F9, F10, F11, F12, F14, C7, C10, I7, I9, R12. S8 loses; VAD stays inside segments, because line 30 argues against VAD alone and S7 removes the other filters.
- ID state (S11 against R3, R4, F16). S11 wins: `say` always appends the ID, and the loop keeps an in-memory timer. R3 and F16 drop. R4 stays without `idOwed` state (item 15).
- Bridge agent tools (E2 against S13). E2 stays. The input comes from strangers on the air and sits outside S13's rule about the user's own config.
- R1 (`frequency-not-amateur` gate) is cut. The operator picks and sees the channel, and lines 359-360 already carry the human-attested rule. A clone-session gate cannot read the knob channel (README 55, 175-176).
- Glue (S18 against E1, E3). S18 wins (item 21). Wyoming (I16) and the rest go.

## Items

### 1. Cut the TTS and STT engine interfaces

**Severity:** high. **Tag:** simplicity, consistency, external, regulatory, holds. **Stage 1:** S5, I18, I19, E10, R6

**Files:** `speech-plan.md:19-20`, `:26`, `:52`, `:96-105`, `:157-158`, `:228-229`, `:294-295`, `:332-336`, `:405`.

Line 405 lists Linux device names as unverified and line 104 already excludes Kokoro and sherpa. `SpeechDeps` (334) injects `tts` and `transcriber` as members, so a function type does the same job as an interface. The 22.05 kHz resample row saves no code, because step 3 (77) runs `aresample=48000` on every WAV. Line 52 lists `--engine say|piper` while lines 102 and 294 add espeak-ng. Line 26 promises "the same voice everywhere" with `say` on macOS and Piper on Linux. The plan has no Piper voice download step (`python3 -m piper.download_voices`). §97.213 asks for a control link and a 3-minute keyed limit when an SBC runs with the operator away.

**Fix:** v1 is `say` plus whisper with function-typed deps. Drop `--engine`, `tts.engine`, `stt.engine`, the Piper and espeak-ng rows and Moonshine. Replace them with one Linux SBC Open item that names the TTS choice, the voice download into a pinned directory and the §97.213 note.

### 2. Resolve how `say` learns the TOT

**Severity:** high. **Tag:** codebase, runtime, holds. **Stage 1:** C3, C4, F1

**Files:** `speech-plan.md:40`, `:54-55`, `:83`, `:107-109`, `:117`, `:348`, `src/core/radio.ts:78`, `src/core/codec.ts:311`, `src/core/protocol.ts:14`, `src/cli/main.ts:82`, `:799-801`.

`readSettings(s: Session)` needs a clone session. Line 348 says `say` and `talk` open none and line 83 runs all validation before the port opens. Lines 108-109 give `hear` a TOT cap although `hear` never transmits, and lines 54-55 already define a fixed cap of 30 s (max 55), so the plan carries two caps. `timeout` is a raw index 0 to 39 with no names (`codec.ts:311`). CHIRP's `TIMEOUT_LIST` maps it to (index+1)*15 s, and line 108 reads it as seconds. A WAV capped at TOT minus 5 s keys about 56 s and stays under the 60 s default. Only the `maxMs` backstop (WAV + lead + tail + 5 s, 60.7 s) passes the TOT, and it fires for a hung player.

**Fix:** Drop the TOT read and keep the fixed cap (30 s default, max 55). Remove `hear` from line 109. Set `maxMs = min(WAV + lead + tail + 5 s, 60 s)` and state that the 5 s margin covers lead, tail and ffmpeg start latency.

### 3. Fix the phase 1 port race

**Severity:** high. **Tag:** codebase, consistency, runtime, holds. **Stage 1:** C1, C2, C12, I14, F9

**Files:** `speech-plan.md:42`, `:60`, `:145-146`, `:179-181`, `:200-203`, `:348`, `:365`, `:406`, `src/core/transport.ts:75-82`, `src/cli/main.ts:598-605`, `src/cli/check.ts:40-50`, `:84-96`.

`SerialTransport.open` passes `lock: true`, the binding calls `flock(LOCK_EX|LOCK_NB)`, and a failure maps to `BusyError` with no retry. Phase 1 runs `uv5r hear --json | bridge | uv5r talk`. The shell starts both ends at once, `talk` holds the port for the session and `hear` opens it for the squelch read, so one of them exits 6. Lines 42, 145 and 348 say `hear` runs a clone session, and open item 406 asks whether it does. `checkChannel` settles after a clone session (`check.ts:87`) while `hear` starts capture straight after closing the port, so the deaf period loses audio. `refuseOpenSquelch` words its message around a slot `hear` does not have.

**Fix:** `hear` opens no serial port. Delete open item 406 and the clone-session wording at lines 42, 145 and 348. Reword the SKILL rule at line 365 to "run no clone-session verb while `hear` runs".

### 4. Defer `converse`

**Severity:** high. **Tag:** simplicity, runtime, consistency, codebase, regulatory, holds. **Stage 1:** S2, F10, F11, F12, F14, I7, I9, C7, R12

**Files:** `speech-plan.md:31`, `:33`, `:43`, `:64-65`, `:190`, `:195-196`, `:204-210`, `:256`, `:299`, `:301`, `:325`, `:343-344`, `:359`, `:383-384`, `:393`, `:403`, `src/cli/check.ts:60-62`.

Step 6 already puts the pipe bridge ahead of `converse`, line 190 says the stream-json contract is unrun, and bench item 6 (383) tests it. No §97.105, §97.109 or §97.119 requirement depends on `converse`, and the ID rules at 33 and 256 apply to the `say` loop too. A dead input reads as closed squelch (`check.ts:60-62`). `converse` has no maximum wait for a clear channel and no bound on the reply queue. Queued replies answer in order. The `spoken` line has no keys. The `channel-busy` row (325) conflicts with the queueing at 207-208. All of it drops with the verb.

**Fix:** Move `converse` to one Open item. Remove its verb row, flags, state machine, tests, `converse.ts`, the `spoken` line type and its use of `channel-busy` (the row stays for `say --clear`).

### 5. Cut `uv5r mcp`

**Severity:** high. **Tag:** simplicity, codebase, external, runtime, consistency, holds. **Stage 1:** S1, C10, E9, F5, I17

**Files:** `speech-plan.md:31`, `:41`, `:60`, `:211-216`, `:349`, `:359`, `:394`, `:424`, `:426`, `package.json:11`, `src/cli/main.ts:612`, `:672`, `:697`.

Phase 3 and step 7 are last and nothing earlier depends on them. Line 215 says channels are ignored under `-p`, and line 216 is a survey with no work. The Layout has no `mcp` file, `serialport` is the only dependency, and `channelSpec`, `statusVerb`, `tuneVerb` and `print` are private to `main.ts`. Channels are a research preview that needs `--dangerously-load-development-channels` and claude.ai or Console auth, which conflicts with the Ollama path. The Goal section, the verbs table and the SKILL list omit `mcp`. The MCP SDK appears only in Sources (426).

**Fix:** Delete phase 3, step 7, the MCP SDK source (426), the channels source (424) and the "third" wording in the line 31 Glue row. Keep one Open item for a later `mcp` verb.

### 6. Drop the file move

**Severity:** medium. **Tag:** simplicity, codebase, consistency, holds. **Stage 1:** S15, C9, C18, I27

**Files:** `speech-plan.md:272-314`, `:274`, `:283-289`, `:311-314`, `:388`, `src/cli/audio.ts`, `src/cli/check.ts`, `src/cli/sweep.ts`, `test/core/imports.test.ts:22-36`, `test/cli/check.test.ts:2-9`, `test/cli/sweep.test.ts:7-15`, `test/cli/audio.test.ts:1-9`.

The three files total 714 lines. The cited reason, `docs/core-cli-split-plan.md`, was deleted in 2379a61 and the link dangles. Its text named TTS as the first adjacent module, so speech does not trigger the move. New speech code can import `src/cli/audio.ts`, since the import test forbids only core to cli and cli to core outside `index.ts`. The move forces mock path edits in `check.test.ts` and `sweep.test.ts`, which call `cli(...)`. Line 283 says "no behaviour change" and line 284 factors out the astats filter and parser. The rule "Nothing imports cli" (313) forbids speech importing `cli/audio.ts`.

**Fix:** Put new files beside the existing ones, or in `src/speech/` importing `src/cli/audio.ts`. Delete step 1 and the three-tree import-rule paragraph, and relax the rule at line 313 to allow that import.

### 7. Release PTT when the process dies outside the handlers

**Severity:** medium. **Tag:** runtime, overstated, corrected. **Stage 1:** F2, F4

**Files:** `speech-plan.md:68`, `:111-119`, `:369-384`, `src/core/radio.ts:572-589`, `src/core/transport.ts:75`, `:126-131`, `node_modules/@serialport/bindings-cpp/dist/darwin.js:29`.

No `uncaughtException` or `unhandledRejection` handler exists in `src/cli`, and the signal handlers live only inside `holdPtt`. The serial port opens with `hupcl: true`, so a SIGKILL or crash closes the fd and the kernel drops DTR. Whether macOS CDC-ACM and the AIOC follow that is not benched. `KEY_SIGNALS` has no SIGTSTP, so Ctrl-Z while keyed suspends the process with DTR high until the radio TOT ends it. `key` has the same exposure today.

**Fix:** Have `keyWhile` release on `uncaughtException` and `unhandledRejection` while keyed, and add SIGTSTP to the key signals. Add a bench item that sends `kill -9` to `say` mid-TX with a second receiver on the frequency.

### 8. Drop the ID state file and `--no-id`

**Severity:** medium. **Tag:** simplicity, regulatory, runtime, consistency, holds. **Stage 1:** S11, R3, F16, I12, I22

**Files:** `speech-plan.md:33`, `:34`, `:54-55`, `:236-240`, `:255-259`, `:318-325`, `src/core/errors.ts:19`, `:136`.

Lines 239-240 give the state file as the only reason for `--no-id` and for the `talk` timer surviving a restart. Line 258 describes a start-of-session ID with no flag. Always appending the ID on `say` satisfies §97.119(a). A restarted timer lengthens the gap between IDs only when the process dies without its final ID. The plan does not say when the ID time is written. The `--no-id` and config refusals name no reason, and `invalid-argument` (exit 2) already exists.

**Fix:** Always append the ID on `say`. Keep an in-memory timer in the loop that starts at the first transmission, with the final ID on EOF or SIGINT. Delete the state file sentence, `--no-id` and the start-of-session sentence, and name `invalid-argument` for config refusals.

### 9. Evaluate `idDue` at the projected end of the utterance

**Severity:** medium. **Tag:** regulatory, holds. **Stage 1:** R2

**Files:** `speech-plan.md:33`, `:237`, `:256-257`, `:292`.

§97.119(a) asks for the callsign at least every 10 minutes during a communication. Line 256 triggers when 600 s have passed since the last ID, and `idDue(last, now, interval)` (292) takes the current time. A 55 s utterance that starts at t=590 ends its ID after t=600. The interval equals the allowed maximum, so there is no margin. `say` always appends an ID, so the gap exists only in the loop.

**Fix:** Evaluate `idDue` at now plus the predicted utterance length and tail.

### 10. Cut config layering

**Severity:** medium. **Tag:** simplicity, consistency, holds. **Stage 1:** S12, I10, I21

**Files:** `speech-plan.md:32`, `:56-57`, `:154-155`, `:226-238`, `:265`, `:308`, `:340`, `:351`.

`service` exists to reject `gmrs` (34) and `idIntervalSeconds` exists to cap at 600 (237). Line 237 makes the interval configurable while lines 256 and 340 say 600. The `phonetics` override at 265 has no key in the example config. Unknown-key rejection and per-verb required subsets (236-238) add code. A fixed 600 s satisfies §97.119. Lines 154-155 describe a models directory with pinned SHA-256, and the config has only a file path in `stt.model`.

**Fix:** v1 keys are `callsign`, `alias`, device names and the STT model path. Hard-code 600 s, ignore unknown keys, delete the `phonetics` sentence and state where the model's SHA-256 is pinned. Keep `--config FILE` and `UV5R_CONFIG`.

### 11. Remove the agent-lockdown rules

**Severity:** medium. **Tag:** simplicity, regulatory, overstated, corrected. **Stage 1:** S13, R5, R8, R11

**Files:** `speech-plan.md:32`, `:195-196`, `:246-248`, `:258-259`, `:268-270`, `:320`, `:322`, `:342`, `:359-363`.

The `foreign-callsign` check (258-259, row at 322) rejects "KJ7XYZ this is KJ7ABC", and the plan defines no callsign pattern. The SKILL rule at 363 guards only against the agent misusing the user's own config. The `addressed` "speaker allowlist" (195-196) is a text match that anyone on the air can satisfy. Lines 361-362 and 268-270 are the plan's only in-product statement of §97.109(b) and §97.105(a), and they stay. SKILL line 361, "Speak only text the human wrote or approved", conflicts with LLM-written replies. Line 32 says "never from a flag or env var".

**Fix:** Delete `foreign-callsign` (322, 258-259), the SKILL rule at 363 and the allowlist and rate-limit sentence at 195-196. Keep one sentence that the human stays at the radio as control operator (§97.105, §97.109) and use it in place of SKILL line 361. Reword line 32 to "The callsign comes from the config file."

### 12. Build `id` after the transmit path

**Severity:** medium. **Tag:** consistency, holds. **Stage 1:** I1

**Files:** `speech-plan.md:44`, `:296`, `:387-391`.

Step 3 builds `id` and makes the first bench transmission. `id` raises PTT and plays audio, which needs `speak.ts`, `levels.ts`, `output.ts` and `tts.ts`. The plan ties those to step 4.

**Fix:** Move `id` and the first bench transmission to the end of step 4, after `say`. Step 3 keeps the config loader and the phonetic table.

### 13. Give the new error reasons a construction path and define streaming exit codes

**Severity:** medium. **Tag:** codebase, overstated, corrected. **Stage 1:** C6, C11

**Files:** `speech-plan.md:41-42`, `:46`, `:68-69`, `:200-203`, `:281`, `:316-329`, `src/core/errors.ts:5-19`, `:197-201`, `src/cli/main.ts:111`, `:122`, `:133-134`, `test/core/errors.test.ts:9-33`.

`UsageError` hardcodes `'invalid-argument'` (`errors.ts:197-201`) and `ErrorReason` is a closed union. `errors.test.ts` asserts that `Object.keys(REASONS)` equals a fixed list titled "nineteen". Lines 41-42 already give `talk` and `hear` a summary with `interrupted`. The plan leaves four points undefined: the exit code on a signal (existing code implies 128+signal, so `hear` always exits 130), the shape of a failure after NDJSON lines against `OUTPUT_RULE`, line 46 ("NDJSON") against line 68 ("JSON when piped or with --json"), and the `ERROR_GUIDANCE` and `EXIT_CODES['128+signal']` entries, which name only `key` and `sweep`.

**Fix:** Add a `UsageReason` union with a reason argument on `UsageError`, extend `TransportReason`, `DeviceStateReason` and `REASONS`, and update the list and count in `errors.test.ts`. State the exit codes for signal and EOF, the mid-stream failure shape and the TTY format, and extend `OUTPUT_RULE`, `ERROR_GUIDANCE` and `EXIT_CODES`.

### 14. Merge `talk` into `say`

**Severity:** medium. **Tag:** simplicity, consistency, holds. **Stage 1:** S3, I11, I20

**Files:** `speech-plan.md:14-15`, `:33`, `:41`, `:59-60`, `:67-69`, `:76`, `:86`, `:255-256`, `:296-297`, `:339-340`.

Line 59 defines `talk` as the `say` flags minus TEXT and `--out`, and lines 67-68 already describe "one-shot with an argument, REPL with none". Step 2 appends the ID to every utterance while lines 33 and 256 have `talk` identify on the interval and at the end. Line 59 says `talk` holds the port for the session and step 6 opens and closes it per utterance. A merged verb needs two ID policies and two output shapes.

**Fix:** `say` with no TEXT reads lines, prints one JSON line per utterance and runs the ID timer in the loop. `speakUtterance` takes `appendId` from the caller and the loop passes in its open transport. Remove the `talk` row, `talk.ts` and the `talk-cli` test.

### 15. Identify on abort and signal

**Severity:** medium. **Tag:** regulatory, holds. **Stage 1:** R4

**Files:** `speech-plan.md:68-69`, `:210`, `:257`, `:404`, `src/cli/main.ts:122`, `:133`, `:365`.

Lines 68-69 say Ctrl-C ends the utterance, a second Ctrl-C exits and Ctrl-D triggers the final ID. Line 257 says the final ID goes out "on EOF or SIGINT". Line 404 says "SIGINT is the only abort". The existing code handles SIGINT, SIGTERM and SIGHUP for `key` (`main.ts:122`, `:133`, `:365`), and the plan names no ID after SIGTERM, SIGHUP or an abort inside `say`. A first Ctrl-C that cuts the trailing ID leaves an unidentified transmission the operator does not see. §97.119(a) bars unidentified transmissions.

**Fix:** The first signal drops PTT and sends a short ID-only transmission. The second signal skips it. SIGTERM and SIGHUP follow the first-signal path, and the `interrupted` result reports which one ran.

### 16. Keep the help schema at version 2 and add `warnings` to `say`

**Severity:** medium. **Tag:** consistency, codebase, simplicity, holds. **Stage 1:** I6, C5, S21

**Files:** `speech-plan.md:40`, `:47-48`, `:82`, `:93`, `:141-142`, `:354`, `src/cli/help.ts:1-2`, `:38-52`, `src/cli/main.ts:551`, `:569`, `:735`, `:950`, `:967`, `test/cli/cli.test.ts:153`, `:192`, `:265`.

The `say` result keys (40) have no `warnings`, yet step 4 warns above -1 dBFS and line 93 warns on host volume. `warning` lines exist only for NDJSON verbs and `say` is one-shot JSON. `help.ts` says to bump the version "when a field changes meaning or goes away". An optional `lines` array does neither, and three tests assert `schemaVersion: 2`. Existing verbs carry warnings in a result `warnings` array on stdout.

**Fix:** Keep `HELP_SCHEMA_VERSION` at 2 and edit line 48. Add `warnings` to the `say` result keys at line 40, and keep the `summary` line for the loop. The key carries the warnings that remain after item 26.

### 17. Rename the three meanings of `id`

**Severity:** medium. **Tag:** consistency, holds. **Stage 1:** I8

**Files:** `speech-plan.md:40`, `:44`, `:163`, `:205`.

`id` names the verb. It is also a `say` result key with no stated meaning, a transmission sequence number (`"id":42`, line 163) and the request id in the input line `{"type":"say","id",...}` (205).

**Fix:** Rename the keys: `identified` for the `say` result, `seq` for the transmission line and `requestId` for the input line.

### 18. Handle text that starts with `-`

**Severity:** medium. **Tag:** codebase, holds. **Stage 1:** C15

**Files:** `speech-plan.md:12`, `:52`, `:100-102`, `src/cli/args.ts:27-48`.

`parseArgs` has no `--` terminator, so `say "--help me"` parses as a flag. Reproduced: `say -o d1.wav --data-format=LEI16@48000 "-hello"` exits 1 with `invalid option -- h`, and the same call with `--` before the text exits 0. The Piper row uses `--` and the `say` row omits it.

**Fix:** Accept `--` in `parseArgs` and put `--` before TEXT in the `say` argv.

### 19. Cut the `addressed` matcher

**Severity:** medium. **Tag:** simplicity, runtime, external, holds. **Stage 1:** S23, F13, E4

**Files:** `speech-plan.md:153-154`, `:165`, `:169-171`, `:195-196`, upstream whisper.cpp `examples/server/server.cpp:566-572`, `:950-951`.

Line 171 hands `addressed` to the harness, and the model can read its own callsign. The only other consumer is the allowlist gate at 195-196, which item 11 removes. Distance 2 on the alias "bench" also matches "bunch", "beach" and "lunch". The callsign prompt reaches whisper independent of `addressed`. The server reads a `prompt` form field and has no `initial_prompt` field, so line 154 sends nothing.

**Fix:** Delete the `addressed` field (165) and the matcher (169-171). Pass the callsign hint to `whisper-cli --prompt` only if bench item 5 shows it helps.

### 20. Define the segmenter thresholds once

**Severity:** medium. **Tag:** consistency, simplicity, holds. **Stage 1:** I3, S9

**Files:** `speech-plan.md:61-63`, `:136-143`, `src/cli/audio.ts:68`.

`--attack 0.3` is 15 frames of 20 ms and the table opens on 2 frames. The table threshold of -45 has no flag, `--floor` defaults to -50 (`DEFAULT_FLOOR_DBFS`), and the close row says "the floor" with two floors in play. Lines 61-63 list four tuning flags for a table of six rows, and the stuck-open warning (143) is its own code path.

**Fix:** Hard-code attack, minimum, maximum and pre-roll in the table. Open is `attack` above `--floor` and Close is `--hang` below `--floor`. Drop the stuck-open row. Keep `--floor`, `--hang` and `--out-dir`.

### 21. Replace the Glue narrative with the line contract and one bridge command

**Severity:** medium. **Tag:** simplicity, consistency, holds. **Stage 1:** S18, S19, I16

**Files:** `speech-plan.md:31`, `:173-196`, `:200-203`, `:419-425`.

Lines 182-184 say Wyoming's event names `transcript` and `synthesize` are reused. The contract uses `transmission` and `say` (46-47, 205), so the sentence is false. Line 190 admits the stream-json shape is unrun and the Ollama recipe (191-194) is untested. The Glue intro (175-178) announces the list that follows. Lines 202-203 hold the section's only attended-operation statement: "Nothing enforces half duplex; the human runs it attended on a quiet simplex frequency". The single-process-owns-the-port bullet (179-181) carries the rationale for the phase 1 caveat.

**Fix:** Replace lines 173-196 with the line contract, the one-process-owns-the-port sentence and one bridge command, `uv5r hear | bridge | uv5r say`, using Claude Code on Ollama, the offline small-model path. Keep the attended half-duplex sentence. Drop the Wyoming recipe, the bridge script and `--resume` text, the Wyoming and openclaw-radio sources and the other recipes.

### 22. Restrict the bridge agent's tools

**Severity:** medium. **Tag:** external, overstated, corrected. **Stage 1:** E2

**Files:** `speech-plan.md:185-190`, `:195-196`.

`--bare` leaves the Bash, file read and file edit tools. `--tools ""` disables all built-ins and `--permission-mode dontAsk` exists. Strangers on the air feed text to this agent, so the transcripts are untrusted input. Under `--bare`, MCP servers load only from `--mcp-config` and the plan passes none, so `--disallowedTools "mcp__*"` has no effect on this command. The documented Manual-mode default (v2.1.302) is newer than the installed v2.1.283.

**Fix:** Add `--tools "" --permission-mode dontAsk` to the claude command at lines 185-186 and a bench check that a spoken "run ls" makes no tool call. Add `--disallowedTools "mcp__*"` only if `--mcp-config` is ever passed.

### 23. Add the missing files to Docs to change

**Severity:** medium. **Tag:** codebase, holds. **Stage 1:** C13

**Files:** `speech-plan.md:32`, `:346-367`, `:396`, `.gitignore:1-8`, `.claude/skills/uv5r/SKILL.md:3`, `:55-60`, `README.md:101-103`.

`.gitignore` lists `channels.json` and omits `uv5r.json`, `models/` and `rx/`, so the gitignore claim at line 32 does not hold. The SKILL `description` has no speech triggers, so the skill will not load for say or transcribe requests. The signals bullet and the "After a failed key" bullet need edits. The README says `key`, `listen` and `help` ignore `UV5R_MAGIC`, which `hear` would not.

**Fix:** Add `.gitignore` (`uv5r.json`, `models/`, `rx/`), the SKILL description, the two SKILL bullets and the README `UV5R_MAGIC` line to "Docs to change".

### 24. Specify `keyWhile` against `holdPtt`

**Severity:** low. **Tag:** codebase, simplicity, holds. **Stage 1:** C8, S16

**Files:** `speech-plan.md:111-119`, `:280`, `:282`, `:389`, `src/core/radio.ts:572-610`, `src/core/index.ts:69`, `:74`, `test/cli/key.test.ts:84-100`.

`holdPtt` keeps the first failure (`if (failure === undefined) failure = err` in the release catch), so line 117's "A failed release outranks a player failure, as today" is wrong. `key.test.ts` asserts that `pttAsserted` and `released` are absent from `ptt-control-failed`, which clashes with the extras the plan adds to `audio-process-failed`. `KeyResult` (282) appears nowhere else, and `HoldResult` is the existing exported type.

**Fix:** State that the first failure wins and that the unplug remedy follows from `released`. Say whether `keyWhile` awaits the body after a signal or `maxMs`, and whether it reuses `HoldResult`.

### 25. Fix the certification sentence and cut the GMRS narrative

**Severity:** low. **Tag:** regulatory, consistency, simplicity, holds. **Stage 1:** R7, R9, I15, S14

**Files:** `speech-plan.md:34`, `:242-254`, `:268-270`, `:398-402`, `:410-411`.

Line 270 says "A stock UV-5R is certified for amateur use only". §97.315 requires certification only for external RF amplifiers, so no amateur-use certification exists for a handheld. §95.335 and §95.1761(c) bear on GMRS. The Open item at 400-402 restates lines 34 and 252, and "the interval becomes 900 s" has no key behind it. Its claim that "the rest of the design holds" skips §95.1733(a), which restricts content, wireline control and messages to amateur stations. The §97.109 bullet (246-248) is the legal basis for the attended rule and stays.

**Fix:** Replace the sentence at line 270 with "This radio is not certified for GMRS or FRS. Transmit only on amateur frequencies, under your own license." Delete the GMRS Open item, the line 34 Decisions row and the §95.1751 bullet (252-253). Keep §97.119, §97.109 and §95.1761(c) in Sources.

### 26. Drop level targets from `say`

**Severity:** low. **Tag:** simplicity, consistency, holds. **Stage 1:** S17, I5

**Files:** `speech-plan.md:40`, `:58`, `:77-94`, `:108-109`, `:337`, `:373-377`.

The conditioning chain has resample, mono, highpass, lowpass, `alimiter` and padding, with no gain stage. Step 4 only measures and warns above -1 dBFS, and the default voice measures -3.4 dBFS peak, so nothing moves levels to the -6 dBFS target. `--rehearse` is "synthesize, measure and play", so measurement code stays. The `utterance-too-long` check enforces the TOT cap and stays. The -3.4 and -21.9 figures cover one default voice.

**Fix:** Drop the volume read, the -6 and -20 dBFS targets, the level warnings and the `peakDbfs` and `rmsDbfs` keys from `say`. Keep the duration cap and keep measurement for `--rehearse`. Set levels from the macOS output volume in bench item 2.

### 27. Cut the `say` and `hear` flag set

**Severity:** low. **Tag:** simplicity, consistency, overstated, corrected. **Stage 1:** S10, I4, I25

**Files:** `speech-plan.md:52-58`, `:62`, `:64-65`, `:78-79`, `:86`, `:107-109`, `:239-240`, `:325`.

`--max-seconds` on `say` overlaps the TOT cap (54, 108-109), and on `hear` it means segment length (62). `--engine` and `--output` duplicate config, and `--no-id` needs the state file. `--clear` listens inside the same `say` run before keying and is the only source of `channel-busy` for `say`. `--out` keeps the conditioned WAV that `--rehearse` does not. The padding is ambiguous: lines 78-79 give 300 ms of silence at both ends and `--tail` adds a 400 ms wait, so the tail runs 700 ms.

**Fix:** Cut `--engine`, `--output` and `--no-id`, and fold `say --max-seconds` into the TOT cap. State that `--lead` and `--tail` set the `adelay` and `apad` lengths in the chain and delete the fixed 300 ms. Keep `--clear` and `--out`.

### 28. Use `whisper-cli` per segment

**Severity:** low. **Tag:** simplicity, external, runtime, overstated, corrected. **Stage 1:** S6, E7, F6, F7

**Files:** `speech-plan.md:29`, `:130`, `:148-158`, `:295`, `:381`, upstream whisper.cpp `examples/server/server.cpp:184`, `:248`, `:1076-1078`.

`whisper-cli` JSON output carries timestamps, offsets, text and per-token `p`, and no `no_speech_prob` or `avg_logprob`, which line 29 gives as a reason for the server. A per-segment spawn still needs a FIFO, because `hear` keeps capturing during inference. Model load time under Metal is unmeasured, and the plan already lists `whisper-cli` as a fallback (157). The server adds a free-port choice, readiness polling, a language-detection flag (`-nlp`) and orphan cleanup after a SIGKILL of `hear`. All four go with it.

**Fix:** Start with `whisper-cli` per segment (`--vad`, `-vm` and `-sns` exist there) and keep the FIFO. Add the server only if bench item 5 shows load time dominates.

### 29. Cut the hallucination filters to the phrase list

**Severity:** low. **Tag:** simplicity, external, overstated, corrected. **Stage 1:** S7, E5, E6

**Files:** `speech-plan.md:29`, `:148-155`, `:163-166`, `:342`, upstream whisper.cpp `examples/server/server.cpp:90`, `:1111-1154`.

Lines 152-153 describe three rules: a compound `no_speech_prob` and `avg_logprob` test, a gzip ratio and a phrase list. The server emits no `compression_ratio` (commented out at line 1153). `avg_logprob` divides by the raw token count and returns null for a zero-token segment, which fails the `< -1.0` test. `-nth` defaults to 0.6, so `-nth 0.6` changes nothing. The Silero file is `ggml-silero-v6.2.0.bin` from `./models/download-vad-model.sh silero-v6.2.0`.

**Fix:** Keep the phrase list, matched against the whole normalized segment, and drop the gzip and `no_speech_prob` conditions with the `avgLogprob` and `noSpeechProb` output fields. Write `-vm models/ggml-silero-v6.2.0.bin`, list that file in the pinned model set, drop `-nth 0.6` and calibrate on bench item 5.

### 30. Fix the avfoundation argv

**Severity:** low. **Tag:** external, holds. **Stage 1:** E12

**Files:** `speech-plan.md:125`, `:130`.

The local ffmpeg run through direct argv returned exit 0 for `-i ":AIOC Audio"` and exit 251 ("Error opening input") for `-i ":AIOC\ Audio"`. Line 130 says to use `spawn`, so the backslash form in the command block fails when copied.

**Fix:** Write `-i ":AIOC Audio"` in the command block.

### 31. State the Ollama requirements for the bridge command

**Severity:** low. **Tag:** external, overstated, corrected. **Stage 1:** E1, E3, E13

**Files:** `speech-plan.md:185-186`, `:191-194`, `:425`.

Docs say `--bare` reads auth only from `ANTHROPIC_API_KEY` or `apiKeyHelper`. A local fake server on v2.1.283 shows `claude --bare -p` with `ANTHROPIC_AUTH_TOKEN=ollama` and `ANTHROPIC_API_KEY=` sends `Authorization: Bearer ollama`, and Ollama does not validate it. The recipe works under `--bare`, and that token path is undocumented. The Ollama integration page asks for a 64k+ context window and the plan names none. The sentence "Anthropic does not support that path" has a source the plan omits: https://code.claude.com/docs/en/llm-gateway.

**Fix:** Keep the command and add a bench check that `--bare` against Ollama returns a completion. State that the cloud path under `--bare` needs a real `ANTHROPIC_API_KEY`. Add a 64k+ context window (`OLLAMA_CONTEXT_LENGTH` or the model setting) and a tool-capable model to the offline bullet and the bench list, and link the gateway page after the sentence.

### 32. Fix bench item 2

**Severity:** low. **Tag:** regulatory, runtime, holds. **Stage 1:** R10, F15

**Files:** `speech-plan.md:28`, `:375-378`, `src/core/codec.ts:311-320`.

Bench item 2 plays a tone with PTT down and a second receiver on the frequency, and names no frequency or ID. §97.111(b)(1) allows brief adjustment transmissions, and §97.119(a) still asks for the callsign at the end. `SETTINGS_FIELDS` has no `vox` field and no VOX mention exists in the repo. The plan names the output device by UID and leaves the system default alone. If the human makes the AIOC the default, system audio can reach it, and VOX would add to PTT.

**Fix:** Run the tone test into a dummy load, or on a named amateur frequency, and finish with `uv5r id`. Add "VOX off" to bench item 2.

### 33. Trim prose and sections after the cuts land

**Severity:** slop. **Tag:** simplicity, consistency, overstated, corrected. **Stage 1:** S20, S24, S25, I26, I29

**Files:** `speech-plan.md:4-5`, `:130-132`, `:190`, `:202-203`, `:249`, `:306-309`, `:316-344`, `:346-366`, `:363-367`, `:386-396`, `:401-402`, `:408-426`.

The agent census at lines 4-5 announces a list. Line 6 defines "bench" and stays. The prose trims in S25 cover lines 130-131 ("since `execFile` buffers"), 190, 202-203, 249, 363-367 and 401-402. The parenthetical defaults at 54-55 and 61-63 and the control-operator sentence at 268-270 stay. The test list omits cases for behaviour the plan describes. Sources lists §97.3, §97.105, §97.213, §95.1733, the ARRL VoIP FAQ and RadioTranscriber without citing them, and the text uses the `say` man page, aplay, avfoundation and Moonshine without a source.

**Fix:** Delete the agent census at lines 4-5. Apply the S25 trims that survive the cuts. List tests and Sources only for behaviour and citations that survive.

## Cut

- S22: refuted. ffmpeg lists two devices named "AIOC Audio" and the UID separates them.
- R1: lost on settlement.
- S4: lost on settlement. Keeping `id` is simpler than an `--id-only` path.
- S8: lost on settlement.
- C14: nit. Tests can point `--config` at a temp path.
- C16: nit. The plan already lists `play` in `audio.ts`.
- C17: nit. Bench item 4 covers the 0.88 ratio.
- E11: nit. Only the 335 ms figure lacks a source.
- F3: nit. Needs a wedged driver.
- F17: nit. Separate devices and cheap to bench.
- F18: nit. Bench item 4 covers it.
- I23: nit. Wording of the "bench" tag.
