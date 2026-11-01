# Name UV5R_FAKE_STATE in the --target help

**Type**: AFK

**Status:** Done, de837b8

## Parent

`../bench-operator/docs/decisions-2026-11-01.md`, item 5.

## What to build

`help <verb>` describes `--target` as "serial device, or fake". The first run with `--target fake` exits 2:

```
{"type":"error","kind":"usage","reason":"invalid-argument","message":"UV5R_FAKE_STATE is unset; --target fake keeps the fake radio in the file it names","remedy":"set UV5R_FAKE_STATE to an absolute path for the fake radio state file","retry":"after-remedy","variable":"UV5R_FAKE_STATE"}
```

Add to the `--target` help text in `src/cli/main.ts` line 155 that `fake` reads and writes the state file named by `UV5R_FAKE_STATE`.

## Acceptance criteria

- [ ] `uv5r help tune --json` names `UV5R_FAKE_STATE` in the `--target` help.
- [ ] `npm run typecheck` and `npm test` pass.

## Blocked by

- #012, which drops the help byte budgets
