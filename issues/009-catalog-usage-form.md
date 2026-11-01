# Match the tinysa help catalog shape

**Type**: AFK

**Status:** Done, 27d22c6

## Parent

`../bench-operator/docs/decisions-2026-11-01.md`, item 1.

## What to build

`uv5r help --json` and `tinysa help --json` both report schemaVersion 3 and differ in shape. tinysa-cli #011 is the counterpart and bench-operator #022 moves the harness contract.

`usage` lists only positionals and required flags: `uv5r key --seconds S`. tinysa lists optional flags in brackets and exclusive groups in parens: `tinysa stream (--count N | --follow) [--json] [--port N]`. Both CLIs use tinysa's form. tinysa adds the flag prefix and the top-level fields on its side.

- Build the catalog `usage` line from the verb's args and flags: positionals, then every flag in `flags` array order, required flags bare and optional flags as `[--flag VALUE]`. uv5r has no exclusive groups. Apply the same line in `help <verb>` text and JSON.
- Set `SCHEMA_VERSION` in `src/cli/help.ts` to 4. `uv5r --version --json` already prints it.
- Update the help tests under `test/cli/` for the new usage lines.

## Acceptance criteria

- [ ] `uv5r help --json` shows `uv5r key --seconds S [--json] [--target PATH]` for `key`, and every verb follows the same form.
- [ ] `uv5r help key --json` carries the same usage line.
- [ ] `schemaVersion` is 4. `npm run typecheck` and `npm test` pass.

## Blocked by

- #012, which drops the help byte budgets
- tinysa-cli #011, which lands first
