# Each verb's help states its port, session and delay cost

**Type**: AFK

**Status:** ✅ Done (1f10545)

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, item 4.

## What to build

Each per-verb help object gains a `device` block: `opensPort` (serial port opened), `cloneSession` (receiver deaf for the call), `appliesAfterMs` (delay after exit before the radio runs the write, 3000 for `tune`, `load`, `erase` and `settings` with pairs, 0 otherwise) and `partialWrite` (whether a failure can leave bytes half written, true for `load` and `restore`). `writesToRadio` folds into this block. The harness constant for the tune apply delay then has a source in the help.

## Acceptance criteria

- [x] `uv5r help tune --json | jq .device` has `opensPort: true`, `cloneSession: true`, `appliesAfterMs: 3000`, `partialWrite: false`.
- [x] `uv5r help listen --json | jq .device.opensPort` is `false`.
- [x] `uv5r help key --json | jq .device.cloneSession` is `false`.
- [x] A test asserts every verb has the block and the per-verb budget from #002 holds.
- [x] `npm run typecheck` and `npm test` pass.

## Blocked by

- #002
