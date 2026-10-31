# Bench volume trial 0

Date: 2026-10-31
Commit: 1ef4b5e on feature/volume-verb
Hardware as seen in `status`: none. The radio did not answer the clone handshake, so `status` reported no firmware, work mode or squelch.

The trial stopped after the identify rule. Steps 2 to 10 did not run. Nothing was written to the radio.

## Reading the docs

Order: `.claude/skills/uv5r/SKILL.md`, `uv5r help --json`, `uv5r help volume --json`, `uv5r help volume`, README "First fifteen minutes" steps 1 to 5, `docs/receive.md`.

Notes from the read:

- `uv5r help volume` from an agent shell printed JSON. The agent's stdout is a pipe, and `help --json` says piped output is JSON. Text mode needed a pseudo-terminal: `script -q /dev/null node src/cli/main.ts help volume`. That printed the text help with a leading `^D`.
- `uv5r help --json` is 50.5 KB on one line. The agent tool saved it to a file instead of showing it, and a trailing line after the JSON object broke a plain `json.load`. Reading it took a parse of the first line only.
- SKILL.md and README step 3 say "select a quiet channel" before `volume`. README puts `volume` at step 3 and MR mode with slot 0 at step 4. The docs do not say whether "quiet channel" means a VFO frequency or a memory slot, or which one to pick.
- The precondition "Open squelch shows the human nothing on the display, so name the channel the display shows before running" took two reads. I took it to mean: ask the human what the display shows before the run, because the display gives no sign that squelch is open.
- `docs/receive.md` says "Open-squelch static reads above -30". The help band for `ok` is -28 to -22 dBFS. The two numbers are close but differ.
- The macOS input volume of `AIOC Audio` at 100 percent is a precondition the CLI cannot read. The agent has to ask the human and trust the answer.
- `help volume` lists exit 3 for a short capture and exit 5 for a failed squelch write or read-back. It does not list `session-unavailable` at the start. `help --json` covers that under exit 5.

## Step 1: status

Command: `uv5r status --json`
Exit: 5
Wall time: 5.7 s
Sandbox bypass: not needed. The serial port opened and the handshake got no reply.

stderr:

```json
{"reason":"session-unavailable","message":"radio did not answer the clone handshake; check the radio is on and the cable is seated","remedy":"ask the human to check the radio is on and the cable is seated; if both hold, run uv5r identify with no UV5R_MAGIC prefix and put the pin line it prints before every later uv5r command, as in UV5R_MAGIC=ORIG uv5r status; when pin is null, run later commands with no prefix","retry":"after-remedy","magic":"291","got":""}
```

The remedy asks the human to check power and the cable. The human was not confirmed at the radio. The brief said to run identify once without waiting.

## Identify rule

Command: `uv5r identify --json`
Exit: 5
Wall time: 29.7 s
Sandbox bypass: not needed.

stderr:

```json
{"reason":"session-unavailable","message":"radio did not answer any classic magic, foreign magic or 115200 program magic","remedy":"ask the human to check the radio is on and the cable is seated","retry":"after-remedy","answers":[]}
```

No magic answered. The radio is probably off, or the K1 plug is short of its contact. The trial stopped here as the brief directs.

## Steps 2 to 10

Not run. Each needs a radio that answers the handshake, except step 8 (`listen`), which the brief also held back once the radio did not answer.

- Step 2 `uv5r settings --json`: not run.
- Step 3 `uv5r volume --json`: not run.
- Step 4 restore check: not run.
- Step 5 `uv5r volume` in text mode: not run.
- Step 6 second `uv5r volume --json`: not run.
- Step 7 instruction review: no instruction to review.
- Step 8 `uv5r listen --seconds 3 --json`: not run.
- Step 9 SIGINT during `uv5r volume`: not run.
- Step 10 final settings check: not run. No write happened, so the radio is as found.

Needs the human: power on the radio, seat the AIOC in the K1 jack, confirm the macOS input volume of `AIOC Audio` is 100 percent, and name the channel the display shows.

## Worked

- `uv5r help volume --json` and `uv5r help volume` printed the full verb contract: effects, preconditions, judge band, exit codes and a sample result.
- `status` failed fast in 5.7 s with a JSON error on stderr and nothing on stdout.
- The `session-unavailable` remedy named the next step, `uv5r identify`, and the `pin` handling.
- `identify` ran in 29.7 s, matching the "about 29 s" in SKILL.md.
- No sandbox bypass was needed for the serial port.

## Rough edges

- Expected from the brief and SKILL.md that `uv5r help volume` shows text. From an agent shell it printed JSON, because stdout is a pipe. Text needed `script -q /dev/null`, which added a leading `^D`.
- Expected `uv5r help --json` to be readable in one pass. It is 50.5 KB on one line with a trailing line after the object, so the agent tool spilled it to a file and a plain JSON parse failed.
- Expected the docs to say which channel to use for `volume`. SKILL.md and README say "a quiet channel" and README runs `volume` at step 3, before MR mode and slot 0 at step 4. The mode and the channel were a guess.
- Expected the precondition "Open squelch shows the human nothing on the display, so name the channel the display shows before running" to read as one instruction. It took two reads to see it as "ask the human what the display shows".
- Expected one number for open-squelch static. `docs/receive.md` says static reads above -30 dBFS, and `help volume` sets `ok` at -28 to -22 dBFS.
- Expected the `status` remedy to let the agent continue without the human. It starts with "ask the human to check the radio is on and the cable is seated", and SKILL.md runs identify only after the human confirms. With the human away, the agent ran identify on the brief's say-so.
- Expected the trial to reach `volume`. The radio did not answer `status` or `identify`, so no `volume` behaviour was observed.
