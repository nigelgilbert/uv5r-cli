# README and docs review

Review of d1f4a8b. Claude drafted twelve suggestions. Sol and an Opus agent reviewed them adversarially against the files, `src/core/plan.ts` and `uv5r help --json`. This file records the consensus.

## Apply

### README.md

1. Install. Replace the alias block with a comment `# run from the repo root` and the line `echo "alias uv5r='node \"$PWD/src/cli/main.ts\"'" >> ~/.zshrc`. The original `$PWD` expanded at profile load.
2. Line 55. Replace the last sentence, which copies the agent rule, with "Check the display when it matters which channel the radio is on."
3. Things that bite. Keep the speaker, deaf receiver, slot 0, serial port and transmit-channel lines. Cut the 3 s, squelch, microphone and display lines; step 6, step 3 and Troubleshooting carry them. Reword the slot 0 line: `check` writes the slot it is given, so say "The `check` examples and `sweep` overwrite slot 0."
4. Transmit. Keep the control-operator paragraph and the config lookup order. Drop the JSON block; `uv5r.example.json` shows the shape. Change "Each transmission ends with the callsign" to say completed `say` and `id` transmissions end with it. Wrap the paragraph near 100 columns.
5. Plans and sweep. Change "A plan is a JSON list of channels" to "A plan is a JSON object with a `channels` array."
6. Output and errors. Scope the error-object sentence to JSON mode. On a terminal the CLI prints the message and remedy as text.
7. Troubleshooting `session-unavailable` row. Say to use the `pin` line when `identify` prints one. `pin` is `null` when the default magic answered.
8. Plan fields. Keep the section and one table where it is; `help load` cites it by name. Move `checkMhz` out of the table into prose: "`checkMhz` is the frequency `sweep` checks slot 0 with. It takes the band and 10 Hz rules of `rxMhz`. `load` validates it and writes nothing for it." Change "each entry field maps onto one `tune` flag" to "each entry field except `notes`".
9. Spelling. Use "license" throughout.
10. Gloss VFO, squelch, PTT and VOX in a few words at first use.

### docs/

11. transmit.md. Apply the callsign wording from item 4.
12. receive.md. Put the `transmission` example on one line, as `hear` emits it. In Signals, add that a segment already in inference finishes and prints.
13. receive.md. Cut announcing sentences such as "Hear receive audio in one of three ways:". Do the same in the README ("Set it up once:").
14. development.md. Add one bench-files bullet: "`docs/bench-two-station.md`, `docs/readme-rewrite-plan.md`, `docs/readme-review.md`: plan and review files kept for the record."

## Dropped

- Reordering steps 4 and 5. The plan keeps the order, the empty-slot skip is unverified, and "expect audio-inactive" can be false on a busy frequency.
- Splitting the Plan fields table or moving it to docs/. Item 8 covers the defect.
- Removing the second development.md link. Both are navigation.
- Moving the ffmpeg 0.88 note out of receive.md. The plan assigns it there.

## Departures from readme-rewrite-plan.md

Items 3 and 4 shorten the nine-item "Things that bite" list and drop the README config block that the plan prescribed.

## Unchanged

protocol.md and errors.md. Both reviewers found nothing wrong.
