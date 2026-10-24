# `identify` verb: classic 9600 scan

**Type**: AFK

**Status:** ✅ Done

## Parent

[docs/clone-protocol-plan.md](../docs/clone-protocol-plan.md), slice 2. Read nothing under `docs/chirp-notes/` and nothing from the Chirp repo.

## What to build

A read-only `identify` verb that tries each classic magic in `SCAN_ORDER` and reports which one the radio answers. A pinned `UV5R_MAGIC` moves to the front of the order. The first magic gets the same second attempt every verb gets. Each later outcome pauses `SCAN_SILENT_PAUSE_MS` (silence, wrong ack) or `SETTLE_MS` (invalid ident, refused closing ack) before the next magic. The scan engine lives in core as `identify(transport, onAttempt, options)`; the verb prints one stderr line per attempt in text mode and the result on stdout.

Outcomes: a supported magic that completes the handshake runs the post-ident reads and reports `magic`, `ident`, `firmware`, `firmwareHex`, `family`, `flags`, `droppedByte` and `pin`. `pin` is the `UV5R_MAGIC=NAME` export line when the answering magic differs from the one the verbs select now, else `null`. `F11`, `UV6` and `UV6_ORIG` acks stop with `radio-unsupported`, with no closing ack and no block read. A 14-byte ident stops with `radio-unsupported`. When no magic completes: an invalid classic ident reports `protocol-reply-invalid` with the first bad reply; otherwise `session-unavailable` with retry `after-remedy`, a remedy that does not name `identify`, and an `answers` detail listing every wrong ack and refusal by magic name.

The verb handshake remedy for `session-unavailable` changes to the grill text: check the radio and cable; if both hold, run `uv5r identify` and export the line it prints. The help entry states the scan can take about a minute. The README verb table and operating rules and the SKILL.md gain the `identify` row and bullet; SKILL.md stays within its 60-line cap.

## Acceptance criteria

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] Fake-timer tests show: the second magic answers after the first is silent and elapsed time equals the attempt costs plus `SCAN_SILENT_PAUSE_MS`; an invalid ident on the first magic pauses `SETTLE_MS`; a UV6 ack reports `radio-unsupported` naming the UV-6 with no block read written to the fake; a 14-byte ident on the second magic ends the scan.
- [ ] Silence on every classic magic gives `session-unavailable`, retry `after-remedy`, a remedy without the word `identify`, and an empty `answers`.
- [ ] A wrong ack followed by silence lists the byte and magic name in `answers`; an invalid ident followed by silence gives `protocol-reply-invalid` with the bytes.
- [ ] A stale `UV5R_MAGIC=ORIG` with only `291` acking reports `pin` `UV5R_MAGIC=291`; a bench-default radio reports `pin` `null`.
- [ ] A verb handshake that gets no ack carries the new remedy text naming `uv5r identify` and `UV5R_MAGIC`.
- [ ] `uv5r help identify` exists, `uv5r help --json` lists the verb, and the README verb table has an `identify` row.
- [ ] The SKILL.md line-count test passes with the new bullet.
- [ ] On the bench, `uv5r identify` stops at the first magic and prints the stderr attempt line.

## Blocked by

- #001
