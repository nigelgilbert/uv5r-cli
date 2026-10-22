# Docs trimmed and aligned

**Type**: AFK

**Status:** 🔄 Implemented, awaiting review

## Parent

review.md, work item 6.

## What to build

README opens with a quickstart and a verb table (verb, writes to radio, time, result keys); protocol notes stay below. SKILL.md becomes a short adapter of at most 60 lines: the operating rules and how to find `uv5r help VERB --json`. Flags and result shapes live only in CLI help.

Removed: the voice/beep repair instruction, the 2026-10-18 history, `--verbose` from the routine sweep example. Added: `--seconds 5` on the `listen --out FILE --play` example; the radio speaker is silent while the AIOC is plugged in and the human hears audio only through `--play`; the receiver is deaf during a clone session and back-to-back verbs take about 3 s longer for the handshake retry. One clipping rule: either `listen` warns when `peakDbfs` is above 0, or the peak-above-0 sentence leaves README and SKILL.md. Big Sky material and `scenarios/big-sky-2026-10.json` are marked historical test data with no current recommendation based on them.

## Acceptance criteria

- [x] `wc -l .claude/skills/uv5r/SKILL.md` is at most 60
- [x] README starts with a quickstart and a verb table
- [x] `grep -n "voice\|beep" .claude/skills/uv5r/SKILL.md` shows no repair instruction
- [x] `grep -rn "2026-10-18" .claude/skills/uv5r/SKILL.md` is empty
- [x] The peak-above-0 rule is either implemented as a `listen` warning with a test, or absent from README and SKILL.md
- [x] README and SKILL.md state the speaker and clone-session facts
- [x] `npm test` and `npm run typecheck` pass

## Result

Files changed:

- `README.md`: quickstart (install, check, tune, sweep), the operating facts, a verb table
  (verb, writes to radio, time, result keys) and one sentence pointing at `uv5r help VERB`.
  Flag and result-shape prose left for CLI help. The radio facts, a short receive audio
  section, protocol notes, bench files, plan fields and development stay below.
- `.claude/skills/uv5r/SKILL.md`: 57 lines. Frontmatter unchanged, how to find help, the
  operating rules and the error fields. Flags, result shapes, the voice/beep repair, the
  2026-10-18 history and the Big Sky mention removed.
- `channels.example.json`: top-level `name` ends with "historical test data".
- `test/cli.test.ts`: a test that SKILL.md runs at most 60 lines.

Clipping rule: the peak-above-0 sentence left README and SKILL.md. The `input clips`
warning on full-scale samples stays the one clipping rule.

Deviations:

- README keeps a "Receive audio" section for the AIOC floor, knob level, `input clips`
  warning, microphone permission and the ffmpeg length fix. These are radio and capture
  facts that CLI help does not carry.
- README drops the exit-code list. `uv5r help` carries it, and the old README list named a
  session idle past 2.2 s that help's exit 5 line does not.
- The `channel-plan` skill keeps its `BIG SKY` candidate-format example. It shows an entry
  shape and makes no recommendation.

Review fixes: `uv5r help` carries the one-verb, clone-session and speaker facts as the
`oneVerb`, `clone` and `speaker` rules. README says a radio verb runs one or more short clone
sessions: `sweep` one per write, `settings` with pairs and `restore` add a verification
session, and `key` opens none. SKILL.md runs 60 lines. Its `recordWritten: true` line says
the name is unverified, since a name timeout also sets it.

## Blocked by

- #012
