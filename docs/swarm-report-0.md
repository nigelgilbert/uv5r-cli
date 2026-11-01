# Swarm report 0: API unification issues

Date: 2026-10-31. Branch `feature/unify-api`, base `e4cfd17`, final `8d16215`.
Work: the six files in `issues/`, from `../bench-operator/docs/api-unification-2026-10-31.md`.
Run: `swarm:implement-no-validate`, three sequential Opus agents in worktrees. The issues share `src/cli/help.ts`, `src/cli/main.ts`, README, SKILL.md and `docs/errors.md`, so they ran as one ordered group: 004 and 005, then 006 and 001, then 002 and 003.

Final checks on `8d16215`: `npm run typecheck` passes. `npm test` passes 989 of 989 tests in 37 files.

## Per item

### 004 The audio input flag is --input

- Landed: `check`, `listen`, `hear`, `sweep` and `volume` take `--input NAME`. `--device` on those verbs exits 2 with "--device is now --input NAME". Results and capture error details carry `input`. The config field stays `inputDevice`.
- Also renamed: the `device` detail on `audio-process-failed`, `capture-incomplete` and the `say --clear` `channel-busy` error. The `say` and `id` result field `device` names the output and stays.
- Files: `src/cli/{audio,check,help,main,sweep,volume}.ts`, `src/core/errors.ts`, `src/tts/{hear,monitor}.ts`, tests, README, SKILL.md, `docs/{errors,receive,transmit}.md`.
- Commits: `34d36cd`, status `55a7237`.
- Checks: `listen --seconds 1 --input "AIOC Audio" --json` ran on the real radio and returned `input`. `listen --seconds 1 --device x` exits 2. No verb in `help --json` lists `--device`.

### 005 say and id read voice, lead, tail and maxSeconds from the station config

- Landed: `voice`, `leadMs`, `tailMs` and `maxSeconds` in `uv5r.json` with defaults Samantha, 300, 400 and 30. `parseStation` checks the ranges and exits 2 with `invalid-argument` and `field`. The dropped flags exit 2 naming the config field. `id` now reads `maxSeconds` from the config. Every `say` and `id` result reports the four values. The `utterance-too-long` and `speech-engine-failed` remedies name the config fields.
- Files: `src/cli/main.ts`, `src/tts/{speak,station}.ts`, tests, README, SKILL.md, `docs/transmit.md`, `docs/errors.md`, `uv5r.example.json`.
- Commits: `68e7601`, status `b2603d0`.
- Checks: `say --rehearse "test" --lead 500` exits 2 naming `leadMs`. A config with `leadMs: 500` gives `leadMs: 500` in the rehearse result. `maxSeconds: 90` exits 2 with `field: "maxSeconds"`. `help say --json | jq '.flags | length'` is 7 on the final commit. `say` ran only with `--rehearse`; `id` never ran on the radio.

### 006 Machine results carry integer Hz

- Landed: `read`, `tune` and `load` report `rxHz` and `txHz` as integers. `check` and `sweep` report `requestedHz`. `erase` reports no frequency and no result reports an offset. Text output prints MHz with three to five decimals through a new `mhzText`. Plan files keep `rxMhz` and `offsetMhz`.
- Also changed: the golden snapshots `fixtures/golden/unit-{1,2,3}.json`, which hold `read --json` output. Only the frequency keys and values changed.
- Files: `src/core/{codec,radio}.ts`, `src/cli/{check,main,sweep}.ts`, fixtures, tests, README, SKILL.md, `.claude/skills/channel-plan/SKILL.md`, `docs/errors.md`.
- Commits: `4aa99b2`, status `e888e0f`.
- Checks: `tune 446.00625 --channel 1 --target fake --json` returns `rxHz: 446006250`. `read 1 --target fake` prints `rx 446.00625` on a terminal. `help read --json | jq .result` shows integer fields. A read-only `read 0 --json` on the real radio returned `rxHz: 162400000`.

### 001 Errors carry type and kind, and verification failures name the fields

- Landed: every error serializes `type: "error"`, `kind`, `reason`, `message`, `remedy` and `retry`, then the detail, then the six again so a detail key cannot replace them. `kind` is one of `usage`, `transport`, `timeout`, `device-state`, `busy` and `unexpected`, following the exit code. `docs/errors.md` holds the mapping table and a JSON example.
- `verification-failed` from `tune`, `load`, `erase` and `settings` carries `failed` and `settings` with `{desired, observed}`. Record verbs compare `rxHz`, `txHz`, `txTone`, `rxTone`, `bandwidth`, `power`, then `name`. Erase desires `null` per record field and `""` for the name. Bytes that differ outside the decoded fields report as `raw`. The `wrote` and `read` hex fields stay.
- The fake fault `tune-wrong-freq` now adds 1 MHz to TX on each record write so the read-back fails with `failed: ["txHz"]`. It used to drop the name write and shift TX at port close, which failed `tune` on `name`.
- Files: `src/core/{errors,fake,radio,settings}.ts`, `src/cli/main.ts`, tests, `docs/{errors,development}.md`.
- Commits: `54918e6`, status `cddc1fc`.
- Checks: `status --target /dev/null --json` exits 3 with `type: "error"`, `kind: "transport"`, `reason: "device-unavailable"`. `name-not-taken` exits 5 with `failed: ["name"]` and `settings.name`. `tune-wrong-freq` gives `failed: ["txHz"]`, desired 446006250, observed 447006250. `test/core/errors.test.ts` walks every reason in `REASONS`.

### 002 Help catalog under a byte budget with a shared schema version

- Landed: `help --json` is the catalog: `schemaVersion` 3, `name`, `version`, `output`, `rules`, `errors` (`format` and `retry`), `exitCodes` and one `{summary, usage, flags}` entry per verb. `help VERB --json` keeps every key the verb carried. `usage` is the short form: arguments and required flags. `--version --json` prints `{"name":"uv5r","version":"0.1.0","schemaVersion":3}`.
- New topic `uv5r help errors [--json]` lists each reason with exit, retry, meaning and remedy, 4596 bytes.
- Verb-specific error prose moved from `errors.format` to the exits and effects of the verbs it describes. The `hear` operator loop moved from `rules.hear` to `help hear`. `rules.station` merged into the transmit exits and `--config`. `rules.scratchSlot` merged into `checkFirst`.
- Files: `src/cli/{help,main}.ts`, `src/core/errors.ts`, tests, README, SKILL.md, `docs/errors.md`.
- Commits: `23a46f8`, status `df2d06b`, `--json` restored in `8d16215`.
- Checks: catalog 4036 bytes. `help say --json` 3017 bytes. A test walks every verb, compares catalog flag names with the per-verb specs, and checks the budgets and the recorded sizes.

### 003 Each verb's help states its port, session and delay cost

- Landed: every per-verb object has `device` with `opensPort`, `cloneSession`, `writesToRadio`, `appliesAfterMs`, `partialWrite` and a `note`. `writesToRadio` moved into the block. `appliesAfterMs` is 3000 for `tune`, `load`, `erase` and `settings`, whose note says it reads only and applies after 0 ms with no pairs. `check`, `sweep`, `restore` and `volume` wait for the reload before exit and show 0. `partialWrite` is true for `load` and `restore`.
- Measured sizes recorded in `test/cli/cli.test.ts` as `HELP_BYTES` with a 64-byte tolerance, after 003 and 005 landed: catalog 4036; hear 3022, say 3017, sweep 2706, check 2435, tune 2318, id 2288, volume 2225, identify 2027, listen 1663, load 1541, restore 1505, settings 1480, key 1463, dump 1299, status 1115, read 1022, erase 994.
- Files: `src/cli/{help,main}.ts`, tests, README.
- Commits: `1f10545`, status `a2a7e39`.
- Checks: `help tune --json | jq .device` gives `opensPort: true`, `cloneSession: true`, `appliesAfterMs: 3000`, `partialWrite: false`. `listen` has `opensPort: false`. `key` has `cloneSession: false`.

## Overseer corrections

- The wave 3 agent first dropped `--json` from every per-verb flag list to save bytes, which broke the 005 check of 7 flags on `help say`. It restored `--json` with the help "print JSON" and trimmed wording elsewhere to stay inside the budgets (`8d16215`).

## Findings dropped

None. No item guarded only against misuse of the user's own config.

## Open items

- bench-operator breaks against this branch: its `rxMhz`/`txMhz` parsing and `mhzArg()`, the dual-shape error sniff in `src/cli.ts`, the message suffix match in `src/schedule-run.ts`, and `test/schedule-faults.test.ts`, which expects `tune-wrong-freq` to fail on the name. `TUNE_APPLY_MS` can read `device.appliesAfterMs` from `help tune --json`.
- tinysa-cli still has to adopt `schemaVersion` 3, the envelope and the help shape.
- Issue 001's third criterion still reads `txMhz`. The run plan wrote the field list once with `txHz`.
- `partialWrite` follows the issue. `tune`, `erase`, `check` and `sweep` write the record and then the name, and `settings` writes three blocks, so a failure there can leave part of a write. Decide whether to mark them true.
- Help headroom is 50 bytes on `hear`, 55 on `say` and 60 on the catalog. `help errors --json` is 4596 bytes and has no budget.
- `docs/plan-volume.md` and `docs/bench-volume-trial-0.md` describe the old help shape and `writesToRadio`.
- The fake-target `tune-delay:4000` timing test failed once during wave 1 and passed on every later run.
