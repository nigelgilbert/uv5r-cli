# Review 2: swarm report 1

Scope is 47b0344..4e2348f. Tests pass (599) and typecheck is clean. The items below close the two Open entries in `docs/swarm-report-1.md` and correct three lines in that report.

## Bugs

1. **Fix the issue 001 example entry**
   - Files: `issues/001-radio-survey.md`
   - Wrong: the example is labelled unit 1 and shows 162.400 on slot 0. Unit 1 slot 0 is empty. 162.400 sits on unit 2.
   - Fix: replace the `"displayed"` line (line 31) with
     `  "displayed": [{ "slot": 1, "displayNumber": 1, "mdf": "freq", "rxMhz": "452.125" }] }`
     This matches `fixtures/golden/manifest.json` for unit 1.

## Gaps

2. **State which display field each mdf mode carries**
   - Files: `issues/001-radio-survey.md`
   - Wrong: line 24 says every entry carries the field the display shows, in `rxMhz` or `name`. A `ch` entry shows only `displayNumber`. Line 45 repeats the assumption. `test/core/golden.test.ts` requires `rxMhz` for `freq` and `name` for `name`.
   - Fix, line 24: end the sentence after `mdf` with
     "`mdf` (`freq`, `ch` or `name`) and the field the display shows: `rxMhz` for `freq` and `name` for `name`. A `ch` entry carries no further field."
   - Fix, line 45: replace "`mdf` and the displayed field" with "`mdf` and, for `freq` and `name`, the displayed field".

3. **Correct three lines in the swarm report**
   - Files: `docs/swarm-report-1.md`
   - Line 11: "Both now give the 3, 3 and 2 split." becomes "The body now says eight slots across the three units and the criterion gives the 3, 3 and 2 split." The issue 003 body gives no split.
   - Line 23 (Item 1, rx-audio bullet): "The history is unchanged." becomes "The history stays, with the `mdfa` cells annotated."
   - Line 69 (Open list): replace the quoted phrase with "claim names on all 15 of unit 2's slots". `docs/swarm-report-0.md:81` reads "names on all 15 slots".
