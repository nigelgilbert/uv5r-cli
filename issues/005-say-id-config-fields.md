# say and id read voice, lead, tail and maxSeconds from the station config

**Type**: AFK

**Status:** ✅ Done (68e7601)

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, item 13.

## What to build

`uv5r.json` gains optional `voice`, `leadMs`, `tailMs` and `maxSeconds` with the defaults the flags hold today: Samantha, 300, 400 and 30. The ranges stay and a value outside them exits 2 with `invalid-argument` naming the field. `say` drops `--voice`, `--lead`, `--tail` and `--max-seconds`; `id` drops `--voice`, `--lead` and `--tail`. A dropped flag exits 2 naming the config field. `say` keeps `--output`, `--config`, `--clear`, `--out` and `--rehearse`; `id` keeps `--output` and `--config`. The `utterance-too-long` remedy names `maxSeconds` in the config. `uv5r.example.json` shows the four fields.

## Acceptance criteria

- [x] `uv5r say --rehearse "test" --lead 500` exits 2 and the message names `leadMs`.
- [x] With `leadMs: 500` in the config, the `say --rehearse` result reports `leadMs: 500`.
- [x] A config with `maxSeconds: 90` exits 2 with `invalid-argument` and `field: "maxSeconds"`.
- [x] `uv5r help say --json | jq '.flags | length'` is 7 (`--output --config --clear --out --rehearse --json --target`).
- [x] README, `docs/transmit.md` and SKILL.md show the config fields. `npm run typecheck` and `npm test` pass.

## Blocked by

None - can start immediately
