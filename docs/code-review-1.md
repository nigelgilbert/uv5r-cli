# Code review 1

Inline `code-review` at effort medium on `e4cfd17..ec045f8`, the loop 0 diff for the six issues in `issues/`. Each finding carries the verdict the review gave: reported, unverified against a run.

1. `src/tts/station.ts:58`. `parseStation` range-checks `voice`, `leadMs`, `tailMs` and `maxSeconds`, and `hear` calls the same `readStation`, so a bad transmit-only field stops `hear`. With `leadMs: 6000` in `uv5r.json`, `uv5r hear --once` exits 2 before capture. Fix: validate the four transmit fields only on the transmit path, or let `hear` read the callsign without the transmit checks. Verdict: reported.

2. `src/cli/main.ts:375`. The `tune` device block sets `partialWrite: false`, but `tune` writes the record and then the name as separate verified blocks; `erase`, `check`, `sweep` and `settings` do the same. With `UV5R_FAKE_FAULT=name-not-taken`, `tune` exits 5 after the record landed in the slot. Fix: set `partialWrite: true` for every verb that writes more than one block, or define `partialWrite` as "a failure can leave a block half written" and say so in the help. Verdict: reported.

3. `src/cli/main.ts:1221`. `id` takes `maxSeconds` from the station config and the `utterance-too-long` remedy says to shorten the text, which `id` cannot do. With `maxSeconds: 3`, every `uv5r id` exits 2. Fix: exempt `id` from `maxSeconds`, or give the `id` remedy its own text naming the config field. Verdict: reported.

4. `src/cli/main.ts:133`. `OUTPUT_RULE` says a failed command prints its error and no result; the exception for the NDJSON lines `hear` prints before a failure was removed. Fix: restore the `hear` exception in the rule or in the `hear` help. Verdict: reported.

5. `src/cli/main.ts:1059`. `tune`, `load` and `erase` results report `appliesAfterSeconds` while the help device block reports `appliesAfterMs`. Fix: report `appliesAfterMs` in the results and update the result docs. Verdict: reported.

6. `src/cli/main.ts:291`. `say` and `id` use `PTT_ONLY`, which sets `opensPort: true`, but `say --rehearse` plays through afplay with the port closed. Fix: document that `opensPort` describes the keyed path, or report `--rehearse` as a mode that keeps the port closed. Verdict: reported.

7. `src/cli/main.ts:285`. The `device()` helper takes five unlabeled positional booleans and numbers. Swapping two arguments still type-checks. Fix: pass a `DeviceDoc` object literal with named fields. Verdict: reported.

8. `src/tts/speak.ts:95`. The `Pacing` interface and the `pacing` object restate four `Station` fields, and `main.ts` adds a third copy in `TRANSMIT_RESULT` and `TRANSMIT_FIELDS`. Fix: use `Pick<Station, ...>` or one shared constant. Verdict: reported.

9. `src/cli/main.ts:486`. The `--rehearse` help text reads "play through afplay instead of keying", contrastive framing. Fix: "play through afplay with the port closed". Verdict: reported.
