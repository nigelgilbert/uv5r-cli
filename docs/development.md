# Development

The files on the bench, the code layering and the fake radio the tests run against.

## Bench files

- `fixtures/golden/`: CHIRP images of the reference radios, `unit-<n>.img`. Slots 22-127 of
  `unit-1.img` hold a 155.700 record behind an FF first byte and decode as empty.
  - `manifest.json`: each unit's ident, firmware, magic, aux hash and the slots its display
    showed.
  - `unit-<n>.json`: the decoded settings and all 128 slots, written by
    `test/core/golden.test.ts`.
- `scenarios/big-sky-2026-10.json`: test data, channels and sweep windows from the Big Sky
  SITREP. No code reads it.
- `channels.example.json`: the reference shape for generated plans.
- `channels.json`: the plan the `channel-plan` skill writes for the current location. Ignored by
  git.
- `uv5r.example.json`: the reference shape for the station config.
- `uv5r.json`: the station config with the callsign. Ignored by git.
- `models/`: the whisper.cpp models `hear` loads. Ignored by git. [receive.md](receive.md) has
  the download steps.
- `models.sha256`: the SHA-256 of both models. Check them with `shasum -a 256 -c models.sha256`.
- `docs/bench-two-station.md`, `docs/readme-rewrite-plan.md`, `docs/readme-review.md`: plan and
  review files kept for the record.
- `.claude/skills/uv5r/SKILL.md`: the operating rules an agent loads to drive the radio.
- `.claude/skills/channel-plan/SKILL.md`: the research recipe an agent loads to build a channel
  plan for a new location into `channels.json`, shaped like `channels.example.json`.

## Layering

`src/core/` talks to the radio: transport, protocol, codec, radio, plan and errors. `src/cli/`
parses arguments, prints and exits. `cli` imports `core` through `src/core/index.ts`. `core`
imports nothing from `cli`.

`test/core/imports.test.ts` fails on any import path under `src/core/` that contains `cli/`, and
on any `core/` import from `src/cli/` or `test/cli/` other than `src/core/index.ts` and
`test/core/fake.ts`.

`src/tts/` holds the speech code. It imports `core` through `src/core/index.ts` and nothing from
`cli` but `src/cli/audio.ts`. `test/core/imports.test.ts` checks `src/tts/` and `test/tts/` for
both rules.

## The fake radio

`test/core/fake.ts` is an in-memory radio with the bench behaviour: aligned reads, acked writes,
VFO writes ignored, settings reload on session drop, the 16-byte read alias in
`0x0E10..0x0E4F`, and the staged settings block committed by a write at `0x0E40`.
