# Code review 3

Inline `code-review` at effort medium on `d5db0df..52c272a`, the loop 2 diff for the two nits in `docs/review-2.md`. The diff changes the `nameMismatch` docstring in `src/core/radio.ts` and the `raw` sentences in `docs/errors.md`. Each finding carries the verdict the review gave: reported, unverified against a run. Findings 1, 3 and 5 sit in code next to the diff that predates this range.

1. `src/core/radio.ts:88`. On an erase, a read-back that decodes to no channel yields all-null record fields that equal the erase's desired nulls, so the error reports `failed: ["raw"]` in place of the fields that did not erase. Fix: when the read-back is not blank and `decodeChannel` returns undefined, list every record field as failed with the observed value `null`. Verdict: reported.

2. `src/cli/main.ts:232`. `VERIFY_EXIT` help text still says `raw` appears "when only other bytes differ", while the docstring and `docs/errors.md` now say `raw` appears when the decoded fields match and the bytes differ. Fix: align the help text with the two corrected texts, within the byte budget. Verdict: reported.

3. `src/core/radio.ts:78`. `RECORD_FIELDS` leaves out `scan`, which `read` prints as a named field, so a scan-bit mismatch reports only `raw`. Fix: add `scan` to `RECORD_FIELDS` and to the compared-field list in `docs/errors.md:44`. Verdict: reported.

4. `docs/errors.md:42`. The new sentence says `raw` appears and does not say where: in `failed`, and as a `settings` key whose `desired` and `observed` hold hex. Fix: name both places in the sentence. Verdict: reported.

5. `src/core/radio.ts:88`. The raw branch copies the `wrote` and `read` hex into `settings.raw.desired` and `observed`, so each error carries the same bytes twice. Fix: list `failed: ["raw"]` and point at `wrote` and `read`, or drop the top-level copies. Verdict: reported.

6. `docs/errors.md:44`. The doc says `tune`, `load` and `erase` compare the record fields "then name", but the name check is a separate error with its own message, and the doc does not say which write a `raw` failure came from. Fix: state that the record and the name are verified as two writes and that the message names which one failed. Verdict: reported.
