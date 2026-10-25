# Radio survey of reference units 1 to 4

**Type**: HITL (the human swaps radios on the AIOC and reads each display)

**Status:** 🔲 Not started

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Bench pass" and "Files".

## What to build

Dump the four reference UV-5Rs read-only and commit the images with a manifest. Label the radios 1 to 4 with tape on the battery. Radio 1 is the 2026-10-12 fixture radio. These labels replace A to D in the plan, so files are `unit-1.img` to `unit-4.img`.

Per radio:

1. Seat it on the AIOC, power on, set the volume knob to the reference position.
2. Run `uv5r identify --json` and record `pin`, ident and firmware.
3. Run `UV5R_MAGIC=<pin> uv5r dump --out fixtures/golden/unit-<n>.img --json`.
4. Dump again to the scratchpad and `cmp` the two. Redo both on a mismatch.
5. Record the sha256 of the aux block 0x1EC0-0x1FFF and the 0x1F60 row.
6. The human reads five programmed channels off the display in MR mode: slot number, frequency, name.

Write `fixtures/golden/manifest.json` with one entry per unit in the shape the plan gives, plus a `displayed` array holding the five channels from step 6:

```json
{ "label": "1", "image": "unit-1.img", "dumped": "2026-10-25", "ident": "aa 30 76 04 00 05 20 dd",
  "firmware": "HN5RV011", "pin": "291", "auxSha256": "…", "notes": "2026-10-12 fixture radio",
  "displayed": [{ "channel": 1, "rxMhz": "162.400", "name": "NOAA1" }] }
```

A radio that does not ack 291 or reports another firmware stays in the set with a note.

Send no write command. Do not run `tune`, `settings`, `restore`, `load`, `sweep`, `check` or `key`.

## Acceptance criteria

- [ ] `fixtures/golden/` holds `unit-1.img` to `unit-4.img`, each 6472 bytes or the length `dump` reports for its ident.
- [ ] `manifest.json` has four entries with every field filled and five `displayed` channels each.
- [ ] The four `auxSha256` values differ.
- [ ] `cmp` of each committed image against its second dump exits 0.
- [ ] `unit-1.img` differs from `fixtures/uv5r-hn5rv011-2026-10-12.img` only at 0x0E4A, 0x0E4D, 0x0F1E, 0x0F3F and 0x1000, or the differing addresses are listed in unit 1's `notes`.
- [ ] `npm test` still passes; nothing reads the new files yet.

## Blocked by

None - can start immediately
