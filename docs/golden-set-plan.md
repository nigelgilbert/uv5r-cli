# Golden set rebuild plan

Branch: `feature/new-golden-set`, base `21dbcb7`. The PR goes into `main`.

## Goal

Replace the single dated fixture with a golden set dumped from four reference UV-5Rs. Tests read the set through one loader. No test, README line or fake names a bench date.

## Current state

One image, `fixtures/uv5r-hn5rv011-2026-10-12.img`, 6472 bytes: ident `aa 30 76 04 00 05 20 dd`, firmware `HN5RV011`, 127 slots used, channel 127 a corrupted 155.700 record.

Readers of the image:

| File | Use |
|---|---|
| `test/core/protocol.test.ts:9` | `restoreImage` round trip against the fake. |
| `test/core/settings.test.ts:9-10` | Decodes the settings block; `FIXTURE_SETTINGS` hard-codes the decoded values. |
| `test/cli/cli.test.ts:9`, `:1023` | `restore` verb tests and `fixtureRadio()`, which copies channels and names into a `FakeRadio`. |
| `README.md:253` | "Bench files" entry. |
| `docs/clone-protocol-review.md:66` | Open item: rebuild the golden files from the reference UV-5Rs. |

`test/core/fake.ts` hard-codes the same unit in its constructor: the ident, the firmware string, the 32 settings bytes at 0x0E20 and the bytes at 0x0F08. Nothing ties those values to an image.

The bench unit on 2026-10-24 is the radio the 2026-10-12 image came from. The 2026-10-13 and 2026-10-17 images came from a second unit and were never committed. `docs/rx-audio-investigation.md` records both.

## Decisions

- Label the radios A to D with tape on the battery. Unit A is the 2026-10-12 fixture radio. Name every file by label: `unit-a.img`.
- Dump each radio as it is. The bench pass writes nothing.
- Put the dump date, ident, firmware and pin magic in a manifest. File names carry no date.
- Delete `fixtures/uv5r-hn5rv011-2026-10-12.img`. Unit A's new dump replaces it. Git history keeps the old file.
- Keep `FakeRadio`'s default constructor. Add `FakeRadio.fromImage()` for tests that want a real unit's memory.

## Bench pass

The human swaps radios. Claude runs the commands. Per radio:

1. Seat the radio on the AIOC, power on, volume at the reference knob position.
2. `uv5r identify --json`. Record `pin`, ident and firmware.
3. `UV5R_MAGIC=<pin> uv5r dump --out fixtures/golden/unit-<x>.img --json`.
4. Dump a second time to the scratchpad and `cmp` the two. A mismatch means a read error; dump again.
5. Record the aux block 0x1EC0-0x1FFF hash and the 0x1F60 row.

After all four:

- Compare the aux blocks pairwise. Four distinct hashes confirm four distinct units. Two equal hashes mean the same radio went on the port twice; redo that unit.
- Compare unit A against the old fixture. Expect the 5 bench-written bytes from 2026-10-24 (0x0E4A, 0x0E4D, 0x0F1E, 0x0F3F, 0x1000) and nothing else.
- A radio that does not ack 291, or reports a firmware other than `HN5RV011`, still goes in the set. Note it in the manifest.

## Files

```
fixtures/golden/
  manifest.json
  unit-a.img   unit-a.json
  unit-b.img   unit-b.json
  unit-c.img   unit-c.json
  unit-d.img   unit-d.json
```

`manifest.json` lists one entry per unit:

```json
{
  "label": "a",
  "image": "unit-a.img",
  "dumped": "2026-10-25",
  "ident": "aa 30 76 04 00 05 20 dd",
  "firmware": "HN5RV011",
  "pin": "291",
  "auxSha256": "…",
  "notes": "2026-10-12 fixture radio"
}
```

`unit-<x>.json` holds the decoded settings and every slot's decoded channel, as `read` and `settings` print them. A script writes it: `npm run golden` runs `scripts/golden.ts` over every image in the manifest. The human checks five channels per unit against the radio display before the JSON is committed.

## Test changes

1. Add `test/core/golden.ts`. Export `GOLDEN`, one `{ label, image, manifest, expected }` per unit, and `PRIMARY`, unit A.
2. Add `test/core/golden.test.ts`:
   - Each image's first 8 bytes equal the manifest ident; the firmware at 0x1EF0 equals the manifest firmware.
   - Each image's aux hash equals `auxSha256`, and the four hashes differ.
   - Decoding every slot and the settings block equals `unit-<x>.json`.
   - Encoding each decoded, well-formed record gives back its 16 bytes.
3. `FakeRadio.fromImage(image)`: load the ident, main memory 0x0000-0x17FF and aux 0x1EC0-0x1FFF, then reload the page.
4. `protocol.test.ts` and `settings.test.ts`: read `PRIMARY` in place of the fixture path. Run the restore round trip with `it.each(GOLDEN)` on `FakeRadio.fromImage(unit.image)`. Take the expected settings from `unit.expected.settings` and drop `FIXTURE_SETTINGS`.
5. `cli.test.ts`: write `PRIMARY.image` to a temp file for the `restore` tests. Replace `fixtureRadio()` with `FakeRadio.fromImage(PRIMARY.image)`.
6. Remove the old image.
7. README "Bench files": replace the fixture line with `fixtures/golden/`, one line on the manifest, one on `npm run golden`. Check the README-grep tests in `test/cli/cli.test.ts`.
8. `docs/clone-protocol-review.md`: close the golden-files open item with a link to this plan.

`npm run typecheck` and `npm test` pass. CI needs no change.

## Brief for the implementation agent

- Reset your worktree to `feature/new-golden-set` at the tip that holds this plan before editing. Agent worktrees start on `main`.
- The bench pass needs the human and the radio. Do it in the main checkout with Claude, before the agent starts. The agent gets the four images and the manifest as committed files.
- Work steps 1 to 8 in order. Commit after steps 2, 5 and 8.
- End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Keep the code style of `test/core/fake.ts`: one-sentence doc comments, no new dependencies.
