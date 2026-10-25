# Move CLI tests to the golden set and retire the dated fixture

**Type**: AFK

**Status:** ✅ Done 2026-10-25, commit ff4d18e

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Test changes" steps 5 to 8.

## What to build

Reset the worktree to the tip of `feature/new-golden-set` after #001 is committed, before editing.

The CLI `restore` tests write `PRIMARY.image` to a temp file and restore that. `fixtureRadio()` becomes `FakeRadio.fromImage(PRIMARY.image)`. Add `test/core/golden.ts` to the allowlist in `test/core/imports.test.ts:31` next to `FAKE`. Delete `fixtures/uv5r-hn5rv011-2026-10-12.img`.

In the README "Bench files" section, replace lines 253-254 together with `fixtures/golden/`, one line on the manifest and one on the unit JSON snapshots. Keep a slot 127 line only if `unit-1.img` at offset 8+0x7F0 still holds a record behind an FF first byte. Keep the README free of dates and run counts. Update any README-grep test in the CLI tests that matches the old lines.

In `docs/clone-protocol-review.md`, mark the "Golden files" open item done with a link to the plan. Leave the dated history in `docs/rx-audio-investigation.md` and the `defaultDumpName` comment in `src/cli/main.ts` as they are.

## Acceptance criteria

- [x] `git ls-files fixtures` lists only files under `fixtures/golden/`.
- [x] `grep -rn "hn5rv011-2026-10-12" src test README.md` prints nothing.
- [x] `grep -n "fixtures/golden" README.md` prints the new Bench files entry.
- [x] `npm test` and `npm run typecheck` pass.

## Blocked by

- issues/003-decoded-expectations.md
- issues/004-restore-round-trip.md
