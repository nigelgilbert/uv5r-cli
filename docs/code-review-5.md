# Code review 5

Review of `9fdb31c..166912e` at effort high. The review ran no verify pass and gave no per-finding confidence, so every verdict below is unverified.

1. `src/cli/main.ts:562`
   - Problem: code review 4 finding 1 is unresolved. The dump `exits` code 3 entry says FILE may be left partial. The effects line says a hung close after the write leaves FILE with the full image. An agent reading `uv5r help dump --json` discards a good 6472-byte image and dumps again. Review 4 dropped code review 4 findings 1, 2, 3, 5 and 6 without a record, and swarm report 4 does not carry them forward.
   - Fix: make the code 3 entry match the effects line. Record the dropped code review 4 findings in the next review file.
   - Verdict: unverified.

2. `test/cli/audio.test.ts:193`
   - Problem: no test covers `clearTimeout(escalate)` at `src/cli/audio.ts:277`. The timeout tests at lines 193 and 211 stop at 21 s. Deleting `clearTimeout(escalate)` sends SIGKILL at 23 s to a child that exited during the grace, and all 851 tests still pass.
   - Fix: after the child exits, add `await vi.advanceTimersByTimeAsync(5000); expect(child.kills).toEqual(['SIGTERM'])`.
   - Verdict: unverified.

3. `docs/swarm-report-4.md:62`
   - Problem: the "Outside this diff" item names only `swarm-report-2.md` for the repeated "No item was dropped.". `docs/swarm-report-1.md:13` has the same repeat.
   - Fix: name `swarm-report-1.md` in the item as well.
   - Verdict: unverified.

4. `docs/swarm-report-4.md:63`
   - Problem: the report calls the `swarm-report-2.md` repeat optional and leaves it open. Line 30 says review 3 dropped that finding for a reason no repo rule contains.
   - Fix: queue the `swarm-report-2.md` repeat as a work item in the next review file.
   - Verdict: unverified.

5. `docs/swarm-report-4.md:30`
   - Problem: the sentence about review 3 dropping code review 3 finding 7 sits in the Item 2 section. That finding concerns `swarm-report-2.md:12`. Item 2 came from code review 4 finding 7 about `swarm-report-3.md`. A reader takes the Item 2 edit as the fix for both.
   - Fix: move the sentence to the "Outside this diff" item at line 62.
   - Verdict: unverified.

6. `docs/swarm-report-4.md:55`
   - Problem: "Open items" opens with items closed in swarm report 1. The "Still open" list copies the open list in `docs/review-4.md` word for word. This repeats the pattern code review 4 finding 6 flagged and breaks the rule to say each idea once.
   - Fix: drop the closed items. Point to the open list in `docs/review-4.md` in place of the copy.
   - Verdict: unverified.

7. `docs/swarm-report-4.md:29`
   - Problem: "The file stays committed. Both models agree the in-place edit follows the repo rule." pre-empts an objection to editing a committed report and adds no fact.
   - Fix: delete both sentences.
   - Verdict: unverified.

8. `docs/swarm-report-4.md:46`
   - Problem: the dropped-finding entry ends with a justification after it records that Sol withdrew the finding. The sentence pre-empts an objection and restates the reason for the drop.
   - Fix: delete the sentence that starts "Line 11 reports the work items".
   - Verdict: unverified.

9. `test/cli/audio.test.ts:227`
   - Problem: the test name "reports a signal stop when the timer did not kill the child" omits its new job of checking that the timeout timer is cleared after a non-timeout exit. Someone tidying the suite could remove the 30 s advance, and the gap from review 4 item 1 returns.
   - Fix: rename the test to name the cleared timer, or split the timer check into its own test.
   - Verdict: unverified.
