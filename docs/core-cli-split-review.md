# Review findings: core and cli split

Status: findings 1 to 4 fixed, 2026-10-23. Finding 5 and the bench check are open. Findings
from the adversarial review of 78bda2d..dde9ad0 on `feature/core-cli-split`, agreed between
the Opus reviewer and GPT-6.1 Sol in one cycle.

Verdict: the range keeps the no-behavior-change contract. Typecheck and tests pass at every
commit. Twenty offline CLI invocations at base and HEAD give identical stdout, stderr and exit
codes. All five findings are low or informational.

## 1. imports.test.ts misses some import forms

Fixed in c30aa59.

`test/core/imports.test.ts:5`. The `SPECIFIER` regex skips bare side-effect imports
(`import '../cli/x.ts';`) and template-literal dynamic imports. `readdirSync` at line 9 reads
one level, so a future subdirectory of `src/core` goes unchecked. README line 221 says the test
fails on any import path.

Fix: add the alternative `\bimport\s*['"`]([^'"`]+)['"`]`, widen the dynamic-import
alternative to backticks, update the capture extraction at line 13, and pass
`{ recursive: true }` to `readdirSync`.

## 2. package-lock.json keeps the old bin path

Fixed in 0d13f69.

`package-lock.json:12` lists `"uv5r": "src/main.ts"`. `package.json` says `./src/cli/main.ts`.

Fix: run `npm install --package-lock-only`. In a temp worktree this changed that line and the
`version` field.

## 3. Stale paths in docs

Fixed in 0cd3c4d.

`docs/rx-audio-investigation.md:97` runs `node src/main.ts dump --out before-repair.img`.

Fix: point it at `src/cli/main.ts`.

## 4. The cli half of the import rule is untested

Fixed in c30aa59.

The plan says `src/cli` and `test/cli` import core through `src/core/index.ts`.
`test/core/imports.test.ts:4` scans `src/core` only.

Fix: extend the test to scan `src/cli` and `test/cli`. Fail on a specifier containing `core/`
other than `core/index.ts`, and allow `test/core/fake.ts`.

## 5. args.ts and audio.ts load all of core

`src/cli/args.ts:1` and `src/cli/audio.ts:2` import `core/index.ts`, which loads `serialport`
through `transport.ts`. `main.ts` loaded it before the split, so verbs see no change.
Informational. Revisit when `core` ships as a package.

## Raised and dropped

- `review-5.md` links to old `src/*.ts` paths. Historical record, out of scope.
- The plan says `help.ts` imports from `exit.ts`. `help.ts` uses none of the exit exports.
- In 518a18f the `./exit.ts` import sits among the core imports in `main.ts`. 6f838b5 reorders it.

## Not run

Plan item 7, the read-only bench check: `uv5r status --json` and `uv5r read 0` on the AIOC.
`protocol.ts`, `radio.ts` and `transport.ts` are pure renames.
