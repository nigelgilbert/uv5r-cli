# Swarm report 0: `uv5r volume`

Work file: [plan-volume.md](plan-volume.md). Base commit `2fe5507` on `feature/volume-verb`.
Two Opus agents ran, one per file group. Each ran in its own worktree from the base commit.

## Items

### Code: `src/cli/volume.ts`, `src/cli/main.ts`, `test/cli/volume.test.ts`

Landed in `80a727b`, merged in `3933417`.

- `volume.ts` holds `VOLUME_SECONDS` 2, `TARGET_LOW_DBFS` -28, `TARGET_HIGH_DBFS` -22,
  `COARSE_STEP_DB` 6, the eight instruction sentences, `judgeVolume` and `readVolume`.
- `readVolume` takes a port opener in place of an open transport. The plan's step 2 puts the
  signal handlers in before the port opens, and a `Transport` argument means the port is
  already open. The handlers stay until the restore ends.
- `main.ts` adds the `volume` entry after `sweep` and `volumeVerb`. Text mode prints `state`,
  `rms` and `instruction`.
- Two existing tests changed. `cli.test.ts` lists `volume` in the two verb lists. The sweep
  overview test matched the word `knob` to guard against the removed knob mode; it now matches
  `knob mode`, since the volume instructions name the knob.
- The squelch detail and remedy go on an error only when the kept squelch is above 0. The
  error also carries `retry: after-remedy`, since a rerun at squelch 0 would keep 0 and skip
  the restore.
- Help wording: "reads as the signal instead of static" became "reads as signal level and
  hides the static".
- Tests: 36 in `volume.test.ts`. Every judge row, the band edges, clipping at low, in-band and
  null RMS, the full flow against `FakeRadio`, squelch already 0, restore after a capture
  error, a failed verification, a lost ack and SIGINT, restore failure detail, ffmpeg missing,
  unknown flags, help contents, handlers in place before the port opens.

### Docs: `README.md`, `docs/receive.md`, `docs/bench-two-station.md`, `.claude/skills/uv5r/SKILL.md`

Landed in `097c7d1`.

- README: verb table row after `listen`, setup step 3 gains the loop before
  `settings squelch 3`, `volume` joins the audio verbs list, the `squelch-open` line in step 5
  names the command, the `input clips` troubleshooting row points at `volume`.
- receive.md: the knob paragraph becomes the loop and the input volume precondition. The
  floor and clip explanations stay.
- bench-two-station.md: preflight step 4 becomes `uv5r volume` until `ok`. The dated setup
  notes keep the old recipe as the record.
- SKILL.md: a setup line and the `input clips` line run the loop.

### Issue 001 measurement rows

Deferred. The rows come from the bench pass in "Setting the band", which runs after this
branch is tried on the radio.

## Checks on `3933417`

- `npm run typecheck`: clean.
- `npm test`: 37 files, 928 tests passed. Base was 36 files, 891 tests.
- The repo has no `lint` script. Typecheck stands in for it.

## Findings dropped

None.

## Open items

- The bench pass in "Setting the band": three knob positions, live speech peaks, `say` and
  NOAA at the chosen position. Sets the two constants and adds the issue 001 rows.
- Validation of `2fe5507..HEAD` against the plan runs next as `swarm:validate`.
