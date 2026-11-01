# Code review 2

Inline `code-review` at effort medium on `e031394..6ba5e6d`, the loop 1 diff for the 24 findings in `docs/review-1.md`. Each finding carries the verdict the review gave: reported, unverified against a run.

1. `src/cli/main.ts:656`. `settings` declares `partialWrite: false`, but `writeSettings` writes three blocks (`SETTINGS_BASE`, `SETTINGS_BASE+0x10`, `SETTINGS_COMMIT`), so a failure between blocks leaves the settings half written. Review 1 finding 1 ruled `settings` stays false because the radio commits the block only on the 0x0E40 write. Fix: settle which reading holds; if the first, set `partialWrite: true` for `settings` and update issue 003 and the `DEVICE` row. Verdict: reported.

2. `docs/errors.md:45`. Splitting the `verification-failed` bullet moved the `raw` sentence under the `settings` bullet only, yet `tune`, `load` and `erase` also report `failed: ["raw"]` from the record and name comparisons. Fix: move the `raw` sentence to cover every verb in the bullet. Verdict: reported.

3. `src/core/radio.ts:104`. The `nameMismatch` docstring and the `VERIFY_EXIT` text say `raw` appears when only padding differs, but `decodeName` maps every non-printable byte to a space, drops everything after the first 0xFF and trims trailing spaces, so a real difference inside the name decodes equal and is reported as `raw`. Fix: compare the seven name bytes before decoding, or word the docstring and help as "the decoded names match and the bytes differ". Verdict: reported.

4. `test/cli/fake-target.test.ts:157`. The tune-delay test no longer compares the delayed run against the plain run, so a fake that ignores `tune-delay:4000` still passes when a plain tune takes 4 s or more. Fix: keep the absolute bounds and add a comparison against a plain run with a margin that holds on a loaded machine. Verdict: reported.

5. `src/tts/speak.ts:251`. Only `id` gets a remedy for `utterance-too-long`; `say` passes empty guidance, so its error carries no `remedy`. Fix: give `say` the remedy "shorten the text or raise maxSeconds in the config". Verdict: reported.

6. `src/cli/main.ts:392`. Removing `device()` left ten seven-line `DeviceDoc` literals that repeat `opensPort: true, cloneSession: true, writesToRadio: true`. Fix: add a `WRITES` base and spread it, as `dump` already spreads `READS_ONLY`. Verdict: reported.

7. `test/cli/cli.test.ts:317`. The per-verb field test checks key presence with `toHaveProperty` and never the exact key set, so a stray key or a `fields` entry on the wrong verb passes. Fix: assert the exact sorted key set per verb, as the catalog half of the test does. Verdict: reported.

Outside the diff: the worktree at `.claude/worktrees/agent-a1e03b15dd9488d7c` still holds pre-review code.
