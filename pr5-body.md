Adds `docs/speech-plan.md`, the plan for speaking text over the UV-5R and transcribing received speech offline from the `uv5r` CLI. Nothing is implemented.

## Verbs

- `uv5r say TEXT` synthesizes with `say` on macOS or Piper on Linux, keys PTT over DTR, plays into the AIOC through ffmpeg and prints a JSON result.
- `uv5r talk` is a REPL that speaks one line at a time.
- `uv5r hear` captures continuously, segments on energy with hang time, transcribes each transmission through a warm whisper.cpp server and prints one JSON line per transmission.
- `uv5r converse` runs `hear` and `talk` in one process and owns the half-duplex state machine.
- `uv5r id` sends the phonetic callsign.

## Design

- Core gains `keyWhile`, which holds PTT while a body runs and drops it on settle, signal or timeout. `holdPtt` wraps it.
- The AIOC output index is resolved by UID on every run because the audiotoolbox index moves when other devices connect.
- Glue lands in three phases: JSON lines over stdio with a bridge into `claude -p --input-format stream-json`, then `uv5r converse`, then `uv5r mcp` with the channel capability.
- `uv5r.json` at the repo root holds the callsign. Every `say` ends with the NATO-phonetic callsign. `talk` and `converse` identify every 10 minutes and at the end, per §97.119.
- `service: gmrs` exits 2 because a stock UV-5R has no Part 95 certification.
- `audio.ts`, `check.ts` and `sweep.ts` move to `src/audio/`. Speech code goes in `src/speech/`.

## Next

- Run the six bench items under "Before implementation".
- Land the seven PRs under "Order of work", each with README, help and SKILL.md updates.
- Settle the "Open items": GMRS, barge-in, Linux device names and the `hear` squelch read.

Eight research agents fed the plan: transmit audio and TTS, receive STT, three on harness glue, station identification rules, Claude Code CLI conventions and codebase fit.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
