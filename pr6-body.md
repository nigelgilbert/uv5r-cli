Replaces the dated fixture `fixtures/uv5r-hn5rv011-2026-10-12.img` with a golden set dumped from three reference UV-5Rs, read by the tests through one loader.

## Golden set

- `fixtures/golden/` holds `unit-1.img` to `unit-3.img`, `manifest.json` and `unit-1.json` to `unit-3.json`.
- All three units report ident `aa 30 76 04 00 05 20 dd`, firmware HN5RV011 and magic 291. Their aux blocks differ.
- Unit 1 is a new dump of the old fixture radio. It differs from the old image at 0x0E52, 0x0E55, 0x0F26, 0x0F47 and 0x1008.
- A fourth radio was dumped and left out because its aux block matches unit 1's. The manifest lists it under `skipped`.
- The manifest records the slots each display showed: 8 in all, 3, 3 and 2 per unit.

## Tests

- `test/core/golden.ts` loads the set into `GOLDEN` and `PRIMARY`.
- `test/core/golden.test.ts` pins the set to units 1, 2 and 3. It checks ident, firmware and aux hash per unit and snapshots the decode. It compares each recorded display reading with a fresh decode of the image and runs a masked encode round trip.
- `FakeRadio.fromImage` builds a fake from an image and rejects an image of the wrong length. The restore round trip runs per unit in `protocol.test.ts` and `settings.test.ts`.
- The CLI tests use `PRIMARY`, unit 1. The dated fixture is deleted.
- `npm test`: 601 tests in 20 files, up from 575 in 19 on main. `npm run typecheck` is clean.

## Source and CLI

- `src/core/radio.ts` adds `IMAGE_AUX` and extracts `decodeSlot` from `readChannel`.
- `src/core/protocol.ts` exports `VERSION_OFFSET`, `VERSION_LENGTH` and `firmwareText`. `Session.finish` slices the version bytes with the constants and decodes them with `firmwareText`.
- eecd428 orders the MDF names `['ch', 'name', 'freq']`, as CHIRP's `MODE_LIST` does at `chirp/drivers/uv5r.py:298` (kk7ds/chirp 21e42e4518c1). All three units store 2 in `mdfa` and `mdfb` and display Frequency.
- CLI change for `mdfa` and `mdfb`: `name` writes 1 where it wrote 2, `freq` writes 2 where it wrote 0 and `ch` writes 0 where it wrote 1. A stored 2 prints as `freq` where it printed `name`. The `settings` help example shows `freq`.
- `docs/rx-audio-investigation.md` carries a dated correction for the old labels.

## Docs

- `docs/golden-set-plan.md`, `docs/golden-set-review.md` and `docs/golden-set-swarm-log.md` record the plan, its review and the swarm runs with commits and test counts.
- Issues 001 to 005 are closed, each with a Result section.
- The README Bench files entry and `docs/clone-protocol-review.md` point at the golden set.

## Next

- Remove `pr5-body.md` and `review-1.md` from the branch before merge.
- Change the manifest `skipped` note to read "Fourth radio dumped".

🤖 Generated with [Claude Code](https://claude.com/claude-code)
