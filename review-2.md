# Review 2: trim the API surface, PR #1

Date: 2026-10-22

This review looks for knobs and output fields that a small model can misuse. Each item names a cut, says whether this PR added the surface, and lists the [review.md](review.md) findings it removes. Do items 1–5 in this PR. Items 6–10 can follow.

## Do in this PR

### 1. Delete `keyVerb`'s catch block

Location: [src/main.ts:734-739](src/main.ts#L734-L739). Added in this PR.

The error reasons already carry the right advice:

- An open failure throws `device-unavailable` or `device-busy`. Their remedies fix the cable or the port, and both retry after the remedy.
- A failed initial `setPtt(false)` in [src/transport.ts:84](src/transport.ts#L84) throws `ptt-control-failed`. Its remedy says to unplug the AIOC, with `retry: 'no'`.

The catch block exists only to put `pttAsserted`, `released` and `phase` on every `key` error. It overrides the retry and causes review #1.

Cut:

- Delete the catch block.
- Drop `phase` from the documented contract and the `key` help.
- Drop the "when `released` is false, ask the human to unplug" rule from the README, SKILL.md and help. `remedy` already says it.

Removes: review #1 and the phase wording it covers. Shrinks #6.

### 2. Drop `written` and `recordWritten` from the contract

Location: [src/main.ts:679-695](src/main.ts#L679-L695), [src/main.ts:914](src/main.ts#L914), [src/radio.ts:159-181](src/radio.ts#L159-L181). Added in this PR.

`load` is safe to rerun. It rewrites every plan slot and leaves the rest alone. The error keeps `slot` to name the failing entry. For `sweep`, `slot0` says what slot 0 holds. The `verification-failed` remedy ("read the slot, then rerun the write") covers both values of `recordWritten`.

Cut: remove `written` from `load` and `sweep` errors. Remove `recordWritten` from the docs.

Removes: review #3. Shrinks #6.

### 3. Send `sweep` failures to stderr only

Location: [src/main.ts:909-914](src/main.ts#L909-L914). Added in this PR.

A failed sweep prints a partial summary on stdout and the error on stderr. Every other verb prints only the error.

Cut: attach the partial summary to the error detail and print nothing on stdout. One rule then covers all verbs: exit 0 means read stdout, any other code means read stderr. An interrupted sweep keeps its stdout result, the same as `key`.

Removes: review #4.

### 4. Cut `check` to `check FREQ --channel N`

Location: [src/main.ts:216](src/main.ts#L216). Predates this PR.

`check` proves the radio receives slot N in MR mode. Two of its flags let a model defeat that:

- `--floor` makes a failing check pass with a lower threshold.
- `--rx-tone` on a NOAA frequency silences the audio. The check then fails and blames VFO mode.

`--seconds`, `--narrow`, `--low-power`, `--name` and the no-op `--rx-only` add nothing to the job.

Cut: remove all seven flags. Keep `--device`.

### 5. Drop `sweep --verbose`

Location: [src/main.ts:425](src/main.ts#L425), [src/main.ts:903](src/main.ts#L903). Predates this PR.

It writes one JSON line per dwell to stderr, the stream that carries the error object. A model scanning stderr for the error can pick up a dwell line.

Cut: remove the flag and `onDwell`.

## Follow-ups

In priority order.

### 6. Drop the EEPROM channel fields from `status`

Location: [src/main.ts:173](src/main.ts#L173), [src/radio.ts:28-38](src/radio.ts#L28-L38). Predates this PR.

`channelA`, `channelB`, the active record and `note` come with a warning not to trust them. SKILL.md repeats it. A small model reads the number anyway.

Cut: remove the four fields and the SKILL.md rule about them. Check whether `workmode` comes from the same EEPROM read; if it does, cut it too.

### 7. Drop `sweep --play` and `sweep --floor`

Location: [src/main.ts:422](src/main.ts#L422).

`--floor` lets a model lower the threshold until a quiet sweep looks active, the same hole item 4 closes on `check`. `--play` ties itself to `--out-dir` and to `afplay`. The human can play the WAVs in `--out-dir` after the run. Keep `--play` and `--floor` on `listen` for diagnostics.

Cut: remove both flags. Rewrite the SKILL.md rule that names `sweep --out-dir DIR --play` to point at the WAVs in `--out-dir`.

Removes: review #8.

### 8. Shrink per-verb `exits` in the help JSON

The global exit table and the runtime `remedy` cover the shared cases. SKILL.md tells the agent to read `help VERB --json` before each verb, so the length costs context every session.

Cut: keep only verb-specific notes in each verb's `exits`. A verb-specific twist on a shared code stays, such as `backup` adding "FILE not writable" to exit 2.

### 9. Drop `--text`

Location: [src/main.ts:124](src/main.ts#L124).

The terminal default and `--json` cover both audiences.

### 10. Drop `kind` from the error JSON

Location: [src/errors.ts:207](src/errors.ts#L207).

The exit code and `reason` already carry it.

## Keep

- `restore --force`, the `tune` flags and `key --seconds`.
- The MHz, Hz and exponent frequency forms. A wrong form fails as out of band before the port opens.
- `slot` in the sweep records. It names the physical memory apart from the plan `channel`.

## Effect on review.md

| Finding | After this review |
| --- | --- |
| #1 `key` acquisition failures | removed by item 1 |
| #2 `help` and `--version` piped | stays |
| #3 two `written` schemas | removed by item 2 |
| #4 exit-6 sweep summary | removed by item 3 |
| #5 `help help` | stays |
| #6 error-contract docs | shrinks to the exit-2 wording and the `key` usage-error fields |
| #7 `check` capture context | stays |
| #8 `afplay` preflight | removed by item 7 |
| #9, #10 nits | stay |

About 60 test assertions reference `written`, `recordWritten` or `phase`. Items 1 and 2 include updating them.
