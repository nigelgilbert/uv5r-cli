# README rewrite plan

Inputs: six Sonnet research passes (newcomer path, structure, accuracy, voice, agent readers, peer conventions), validated by GPT-6.1 Sol and Claude Opus against HEAD 571f473. This file records the merged decisions. The applier works from it.

## Goals

- A newcomer reads the README top to bottom in ten minutes and runs a receive session in fifteen.
- Voice: simple, dry, a little fun. No emojis.
- House style: no contrastive framing, no sentence that announces the next, no absolutes or editorializing, plain imperative verbs, short sentences, say each idea once.
- `uv5r help` and `uv5r help VERB --json` stay the source of truth for flags, result keys, exits and rules. The README points there instead of repeating them.
- Nothing is lost. Every fact that leaves the README lands in one of the five docs/ files below.
- SKILL.md files and the `rules` text in the code stay unchanged.

## Verified facts the rewrite relies on

- `restore` requires `--force`. The README never says so (L76, L147-148). Show `uv5r restore IMAGE --force`.
- `id` takes no `--rehearse`, fixes max-seconds at 30 and skips the clear check. README L104-105 "`say` and `id` without `--rehearse`" reads wrong. Write "`say` without `--rehearse`, and `id`". The same sentence sits in `errors.format` in src/cli/main.ts near line 167. Deferred code fix, out of scope here.
- `check` and `sweep` exit 5 with `squelch-open` when squelch is 0 and `audio-inactive` when the capture is quiet. README L26-28 merges the two. Split them and put `uv5r settings squelch 3` before the first `check`.
- `channels.json` is gitignored. The Quickstart's `sweep channels.json` (L31) fails on a fresh clone. Point at `channels.example.json` and the channel-plan skill.
- `help hear`, `help say`, `help sweep` and `help identify` already carry the hear pipeline, the say steps, the three `slot0` shapes and the identify order, `pin` and timing. Those README copies shrink to pointers.
- Facts found only in the README, each needs a home in docs/: SIGTSTP 146/148; the 3 s PTT assertion and port-close watchdogs and "unplug the AIOC"; uncaught error lowers PTT and exits 1; player watchdog at padded WAV + tail + 5 s; output UID ending `:1`; the CTCSS reason for the 300 Hz high-pass; AIOC output follows macOS volume; TOT note; `UV5R_DEBUG`; the valid `UV5R_MAGIC` names; `family: unknown`; dBFS figures; ffmpeg 0.88 factor; menu 21 name tip; all magic and ident bytes; identify timing table; whisper.cpp tag and commit; a dwell cut short leaves no WAV.
- Audio verbs are macOS: avfoundation, audiotoolbox, `say`, `afplay`. Scope the platform statement to audio. Radio verbs need Node 24 and the cable.
- `--device` defaults to `AIOC Audio`. A newcomer rarely passes it.
- package.json has `bin: {uv5r}` and main.ts has a shebang. `npm link` is unverified with a `.ts` bin. Use a shell alias line and keep `npm run uv5r --` as the fallback.
- No real `status` or `tune` output exists outside the bench. Use the `result` examples from `help VERB --json` or none. Publish no invented values.

## Target outline, about 185 lines

| # | Section | Lines | Content |
|---|---|---|---|
| 1 | Title, badge, opening | 7 | What it does, AIOC link, tested firmware HN5RV011. Drop the phase 1 / tinysa-cli / phase 2 sentences (L10-11). |
| 2 | What you need | 16 | Hardware: UV-5R, AIOC cable seated in the K1 jack. Software: macOS for the audio verbs, Node 24, ffmpeg, terminal microphone permission. Per-verb extras: whisper-cli and two models for `hear`; `uv5r.json` with a callsign and an amateur licence for `say` and `id`; a plan file for `load` and `sweep`. |
| 3 | Install | 7 | `npm install`, one alias line, then `uv5r` everywhere. |
| 4 | First fifteen minutes | 30 | Human voice, imperative. `status` → `dump --out backup.img` → `settings squelch 3` → set MR mode (VFO/MR key) and select slot 0 → `check 162.400 --channel 0` with a NOAA frequency that carries audio here, try 162.400-162.550 → `tune FREQ --channel 0` → `listen --seconds 5 --out rx.wav --play`. Say what success looks like after `status` and `check`. Split the two exit 5 reasons. State that `check` writes a receive-only record into slot 0 and the record stays. |
| 5 | Things that bite | 11 | Nine one-liners under 20 words: speaker silent with the AIOC in; receiver deaf during a clone session, one verb at a time; slot 0 is scratch; leave the serial port alone (no `cat`, `screen`, `stty`); writes apply about 3 s after the command ends; squelch 0 reads as audio; macOS microphone permission or digital zero; the CLI cannot read the display; `key`, `say` and `id` transmit on whatever the display shows. |
| 6 | Transmit | 20 | Control operator paragraph (L217) as fact sentences, kept verbatim in meaning. `cp uv5r.example.json uv5r.json`, replace the callsign, the JSON block (L253-258), one precedence line (`--config`, `UV5R_CONFIG`, `uv5r.json`), `say --rehearse` with VOX off before the first `say`, then `say` and `id`. Each `say` and `id` ends with the phonetic callsign; `key` sends no ID. Link docs/transmit.md. |
| 7 | Transcribe | 16 | whisper.cpp tag v1.9.5 build, model downloads from the whisper.cpp checkout, `shasum -a 256 -c models.sha256`, preflight (`check`, `tune`), `hear --once --timeout 60 --out-dir rx`, transcripts are text from anyone on the air. Link docs/receive.md. |
| 8 | Plans and sweep | 9 | Copy `channels.example.json`, or run the channel-plan skill. `load PLAN.json` writes every slot. `sweep PLAN.json --seconds 30 --out-dir rx` uses slot 0 only and leaves the last write there. Link the Plan fields section below. |
| 9 | Verbs | 22 | Three columns: Verb, What it does, Writes to radio. Sixteen rows. `restore` row shows `--force`. Then one pointer: `uv5r help VERB` for flags, defaults, results and exits. |
| 10 | Output and errors | 10 | JSON when piped or `--json`, text on a terminal, `hear` prints NDJSON. Failure: nothing on stdout, one error object on stderr with `reason`, `message`, `remedy`, `retry`. Exit 0 ok, 2 usage, 3 transport or dependency, 5 radio state, 128 + signal number on interrupt. Ctrl-C lowers PTT; a failed release exits 3. Link docs/errors.md. |
| 11 | Troubleshooting | 16 | Symptom, cause, try. Rows: `squelch-open`; `audio-inactive`; `session-unavailable` → `uv5r identify` and the `pin` line; digital zero → microphone permission; about -66 dBFS → knob or plug; `input clips` → knob down; silence from the speaker → WAVs; `station-unconfigured`; `dependency-missing`; `radio-unsupported`. Facts only, phrased without "only" and "not". |
| 12 | Environment | 8 | `UV5R_DEBUG=1`, `UV5R_MAGIC` with the five valid names and exit 2 on others, `UV5R_CONFIG`, `UV5R_TARGET` (check `help` for its meaning before writing a line). |
| 13 | Plan fields | 22 | Current L403-423 moved here unchanged in content. The channel-plan skill and `help load` link to this table by name. Keep the heading text "Plan fields". |
| 14 | For agents | 4 | `.claude/skills/uv5r/SKILL.md`, `.claude/skills/channel-plan/SKILL.md`, `uv5r help --json`. |
| 15 | Further reading | 7 | Links to the five docs/ files with one line each. |
| 16 | Development | 6 | `npm run typecheck`, `npm test`, CI line (L427-432). Link docs/development.md. |

## docs/ files

Create exactly these five. Each starts with an H1 and a one-sentence scope line. Move content from the current README line ranges given; tidy wording to house style; keep every fact.

| File | Moves in |
|---|---|
| `docs/receive.md` | L150-213: microphone permission, the dBFS floor and static figures, knob setting, the clip warning, squelch 0 as audio, the ffmpeg 0.88 factor, `hear` setup and operation, the NDJSON transmission example, warning line fields, `--once` and `--timeout`, signal handling, WAV retention. Add the whisper.cpp build, model downloads and checksum (L390-398) in full. Link `uv5r help hear` for the pipeline numbers instead of repeating L176-190 as prose. |
| `docs/transmit.md` | L215-273: the control operator paragraph, `say` and `id` behaviour, the pipeline details that `help say` lacks (CTCSS reason for the 300 Hz high-pass, `ffmpeg -f audiotoolbox` as the player, output UID ending `:1`, player watchdog at padded WAV + tail + 5 s, `idOwed`), `--rehearse`, `--out FILE`, macOS output volume, the TOT note, station config keys and precedence, `hear` reading the config without a file. Scope `--rehearse`, `--clear` and `--max-seconds` to `say`. |
| `docs/protocol.md` | L119-148 (`UV5R_MAGIC`, `identify` trigger and `pin`, `radio-unsupported`, `powerCycle`, how the radio takes a frequency, 2.5 s session drop, handshake retry, 14-byte ident, A58 versions, menu 21 tip, `settings` writes eight fields and `restore --force` brings back a zeroed block) and L275-373 (protocol notes, ident decoding, classic magics, foreign radios, UV17Pro magics, identify timing). |
| `docs/errors.md` | L87-115: error object detail fields (`slot`, `summary`, `phase`, `channel`, `requestedMhz`), signal handling per verb, SIGTSTP 146 on macOS and 148 on Linux, `idOwed`, `hear` backlog on signal, uncaught error lowers PTT and exits 1, the 1 s release and 3 s assertion and close watchdogs, "unplug the AIOC". Also L38-44 slot 0 retention and the `slot0` summary shapes, and L33-34 a dwell cut short leaves no WAV. Link `uv5r help --json` `errors` for the reason catalog. |
| `docs/development.md` | L375-401 bench files (fixtures, manifest, unit JSON, scenarios, example files, models, skills) and L434-446 (layering, import rules, the fake radio). |

## Cut from the brainstorm

- FAQ, "Why" paragraph, separate glossary. Inline one-clause glosses on first use instead (MR/VFO, slot, clone session, squelch, PTT, AIOC).
- Wiring photo or diagram.
- Invented `status` and `tune` output samples.
- Flag ranges copied from `help`.
- An `env` key or SIGTSTP text added to `help --json`. Code change, separate issue.
- `docs/verbs.md`, `docs/exit-codes.md` generated from `help`, eight docs/ files.
- Emoji opening.
- A 110-line README. Requirements and troubleshooting need the room.
- Moving the Plan fields table out of the README.

## Open question for the bench

A stock UV-5R in MR mode skips empty channels. A newcomer with an empty slot 0 may be unable to select it before the first write. Unverified. Phrase the first-run path so that `check` writes slot 0 first and the reader selects slot 0 after that write if the radio skipped it. Do not assert the skip as fact; note it as a thing to try.

## Deferred

- Fix "`say` and `id` without `--rehearse`" in `errors.format`, src/cli/main.ts near line 167.
- Verify `npm link` with the `.ts` bin.
- Capture real `status` and `check` output on the bench for a later "Try it" block.
