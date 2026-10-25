# Radio survey of reference units 1 to 3

**Type**: HITL (the human swaps radios on the AIOC and reads each display)

**Status:** 🔲 Not started

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Bench pass" and "Files".

## What to build

Dump the reference UV-5Rs read-only and commit the images with a manifest. Label the radios 1 to 3 with tape on the battery. Radio 1 is the 2026-10-12 fixture radio. Radio 3 is the 25th anniversary edition. A radio whose aux block matches an earlier unit is left out of the set and noted in the manifest. Files are `unit-1.img` to `unit-3.img`.

Run `mkdir -p fixtures/golden` before the first dump.

Per radio:

1. Seat it on the AIOC and power on.
2. Run `uv5r identify --json` and record the `magic`, `ident` and `firmware` fields. Do not store the `pin` line.
3. When `pin` is null, run `uv5r dump --out fixtures/golden/unit-<n>.img --json`. Otherwise put the `pin` line before that command.
4. Dump again to the scratchpad and `cmp` the two. Redo both on a mismatch.
5. Record the sha256 of the last 320 bytes of the image, offsets 0x1808-0x1947.
6. After both dumps, the human reads three programmed channels off the display in MR mode. The display shows a name, a channel number or a frequency, per MDF-A and MDF-B. Per channel record `slot` (CLI numbering, 0 to 127), `displayNumber`, `mdf` (`freq`, `ch` or `name`) and the one field the display shows, in `rxMhz` or `name`.

Write `fixtures/golden/manifest.json` with one entry per unit in the shape the plan gives, plus a `displayed` array holding the three channels from step 6:

```json
{ "label": "1", "image": "unit-1.img", "dumped": "2026-10-25", "ident": "aa 30 76 04 00 05 20 dd",
  "firmware": "HN5RV011", "magic": "291", "auxSha256": "…", "notes": "2026-10-12 fixture radio",
  "displayed": [{ "slot": 0, "displayNumber": 1, "mdf": "freq", "rxMhz": "162.400" }] }
```

When two `auxSha256` values are equal, re-seat each radio once and compare the tape labels. When the labels differ, add `"sameRadioAs": "<label>"` to the later unit.

A radio that does not ack 291 or reports another firmware stays in the set with a note.

Run only `uv5r identify` and `uv5r dump`.

Before the commit, the human reviews the channel names and the power-on message lines at image offsets 0x1808-0x1947. The repo is public.

## Acceptance criteria

- [ ] `fixtures/golden/` holds `unit-1.img` to `unit-3.img`, each exactly 6472 bytes.
- [ ] `manifest.json` has three entries with every field filled, `magic` included, and three `displayed` entries each carrying `slot`, `displayNumber`, `mdf` and the displayed field.
- [ ] The `auxSha256` values differ except units that carry `sameRadioAs`.
- [ ] `cmp` of each committed image against its second dump exits 0.
- [ ] `unit-1.img` differs from `fixtures/uv5r-hn5rv011-2026-10-12.img` only at image offsets 0x0E52, 0x0E55, 0x0F26, 0x0F47 and 0x1008, and its last 320 bytes hash to `7a5252d198f8da8e14821172b62debbee83895c14f7b7d32f58165b6d87f96c1`. If other offsets differ, stop and ask the human.
- [ ] The human has approved the names and message lines.
- [ ] `npm test` still passes; nothing reads the new files yet.

## Blocked by

None - can start immediately
