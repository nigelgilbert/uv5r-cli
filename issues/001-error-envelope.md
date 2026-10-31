# Errors carry type and kind, and verification failures name the fields

**Type**: AFK

**Status:** 🔲 Not started

## Parent

`../bench-operator/docs/api-unification-2026-10-31.md`, items 1 and 2.

## What to build

Every error object gains `type: "error"` and `kind` beside `reason`, `message`, `remedy` and `retry`, so tinysa-cli and uv5r-cli print one envelope. The canonical fields come after the detail fields so a detail key cannot shadow them.

A `verification-failed` error from `tune`, `load`, `erase` or `settings` carries `failed`, the list of field names that read back wrong, and `settings`, a map from each failed field to `{desired, observed}`. For `tune` the fields are the record fields `read` prints plus `name`. The message stays one sentence. The harness then stops matching message text to find a name-only failure.

## Acceptance criteria

- [ ] `uv5r status --target /dev/null --json` prints an error with `type: "error"`, `kind: "transport"` and `reason: "device-unavailable"`.
- [ ] `UV5R_FAKE_FAULT=name-not-taken uv5r tune 446.00625 --channel 1 --target fake --json` exits 5 with `failed: ["name"]` and `settings.name.desired` and `settings.name.observed`.
- [ ] `UV5R_FAKE_FAULT=tune-wrong-freq` lists `txMhz` in `failed`.
- [ ] A test asserts every reason in `REASONS` serializes with `type` and `kind`.
- [ ] `uv5r help --json | jq .errors.format` names `type` and `kind`. `docs/errors.md` shows the shape.
- [ ] `npm run typecheck` and `npm test` pass.

## Blocked by

None - can start immediately
