# Move CLI tests to the golden set and retire the dated fixture

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Test changes" steps 5 to 8.

## What to build

The CLI `restore` tests write `PRIMARY.image` to a temp file and restore that. `fixtureRadio()` becomes `FakeRadio.fromImage(PRIMARY.image)`. Delete `fixtures/uv5r-hn5rv011-2026-10-12.img`.

In the README "Bench files" section, replace the fixture line with `fixtures/golden/`, one line on the manifest and one on `npm run golden`. Keep the README free of dates and run counts. Update any README-grep test in the CLI tests that matches the old line.

In `docs/clone-protocol-review.md`, mark the "Golden files" open item done with a link to the plan. Leave the dated history in `docs/rx-audio-investigation.md` as it is.

## Acceptance criteria

- [ ] `git ls-files fixtures` lists only files under `fixtures/golden/`.
- [ ] `grep -rn "2026-10-12" src test README.md` prints nothing.
- [ ] `grep -n "fixtures/golden" README.md` prints the new Bench files entry.
- [ ] `npm test` and `npm run typecheck` pass.

## Blocked by

- #003
- #004
