# Help catalog under a byte budget with a shared schema version

**Type**: AFK

**Status:** ✅ Done (23a46f8)

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, items 3 and 5.

## What to build

`uv5r help --json` is 51665 bytes today. The catalog drops to one entry per verb with `summary`, `usage` and the flag names, plus `schemaVersion`, `name`, `version`, `output`, `rules`, `errors` and `exitCodes`. Everything else a verb carries today (`example`, `args`, flag specs, `effects`, `preconditions`, `writesToRadio`, `result`, `exits`, `fields`, `lines`) stays in `help VERB --json`. `schemaVersion` becomes the one constant tinysa-cli shares; bump it with this change. `uv5r --version --json` prints `{name, version, schemaVersion}`.

The catalog stays at most 4096 bytes and each per-verb object at most 3072. Record the measured sizes in a test.

## Acceptance criteria

- [x] `uv5r help --json | wc -c` is at most 4096.
- [x] `uv5r help say --json` has every field the verb carries today and is at most 3072 bytes.
- [x] `uv5r --version --json` prints `name`, `version` and `schemaVersion`.
- [x] A test walks every verb: the catalog flag names equal the per-verb spec names and each object stays under its budget.
- [x] SKILL.md and README still direct the agent to `help --json` once and `help VERB --json` before a verb's first run. `npm run typecheck` and `npm test` pass.

## Blocked by

None - can start immediately
