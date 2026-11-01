# Drop the size caps and read --offset by the frequency rule

**Type**: AFK

**Status:** Done, a59dd39

## Parent

none

## What to build

`test/cli/cli.test.ts` caps help output by size: the catalog at 4096 bytes, each `help VERB --json` at 3072, and the unknown-verb error under 340. The catalog sits at 4048, so #007, #009, #010 and #011 each push it over.

- In the test at line 221, delete the two byte assertions and keep the check that catalog flag names match each verb's help. Rename the test to say what it checks.
- In the test at line 305, delete the 340-byte assertion and keep the check that the error carries no help text.
- Delete the test at line 361 that caps `.claude/skills/uv5r/SKILL.md` at 60 lines, and the `SKILL` constant at line 21.

`--offset` on `tune` reads every value as MHz, so `--offset 600000` asks for a 600000 MHz shift and fails the band check. Read it by the frequency rule in #007, on the magnitude so the sign carries through: below 1000 is MHz, else Hz.

- Change the parse in `channelSpec` in `src/cli/main.ts` line 985 to apply the rule, then `checkTenHz` as now.
- Set the flag's `value` to `FREQ` and its `help` at line 344 to "signed repeater offset; MHz below 1000, else Hz, as in -0.6".
- Leave `offsetMhz` in plan files as MHz.

## Acceptance criteria

- [ ] No test in `test/cli/` asserts a byte size of help or error output or a line count of SKILL.md.
- [ ] The flag-name and no-help-text checks remain.
- [ ] `uv5r tune 146.82 --channel 5 --offset -600000 --target fake --json` writes the same TX frequency as `--offset -0.6`.
- [ ] `npm run typecheck` and `npm test` pass.

## Blocked by

- none
