# Decoded expectations per unit

**Type**: AFK

**Status:** 🔲 Not started

## Parent

[docs/golden-set-plan.md](../docs/golden-set-plan.md), "Files" and "Test changes" step 2.

## What to build

`npm run golden` runs a script that decodes every image in the manifest and writes `fixtures/golden/unit-<n>.json`. Each file holds the decoded settings and all 128 slots, in the shape `read --json` and `settings --json` print. Empty slots are `null`. Malformed slots keep the `{ malformed, raw }` shape.

The loader adds `expected` to each `GOLDEN` entry. The golden test gains three checks per unit:

- Decoding the image gives `expected`.
- Each `displayed` channel in the manifest matches the slot of the same number in `expected` on frequency and name. This ties the snapshot to what the radio showed.
- Encoding each well-formed decoded record gives back its 16 bytes from the image.

Commit the generated JSON.

## Acceptance criteria

- [ ] `npm run golden` writes four JSON files, and running it again leaves `git diff` empty.
- [ ] Each JSON has a settings object and 128 slot entries.
- [ ] `npm test` passes, including 20 `displayed` checks (5 per unit) and the encode round trip on every well-formed slot.
- [ ] Changing one channel frequency in a JSON file makes the test fail.
- [ ] `npm run typecheck` passes.

## Blocked by

- #002
