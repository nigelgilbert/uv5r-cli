# Magic table, `Session.start(magic)` and `UV5R_MAGIC`

**Type**: AFK

**Status:** ✅ Done

## Parent

[docs/clone-protocol-plan.md](../docs/clone-protocol-plan.md), slice 1. The wire protocol is [docs/clone-protocol.md](../docs/clone-protocol.md). Read nothing under `docs/chirp-notes/` and nothing from the Chirp repo.

## What to build

Every radio verb opens its clone session with a magic chosen from a table of the eight classic magics, defaulting to `291`. `UV5R_MAGIC=NAME` in the environment selects another one. The name is resolved before the port opens, so a bad or unsupported name exits 2 with no serial traffic. The verification sessions of `settings` and `restore`, the `check` session and the `sweep` slot-0 session all open with the selected magic.

One handshake attempt becomes a function that returns a tagged outcome (`silent`, `wrong-ack`, `invalid`, `foreign`, `refused`, `ident`) and a `finish` step that runs the post-ident reads. `Session.start(magic)` keeps today's two attempts `SETTLE_MS` apart, retries only on `silent` and `wrong-ack`, and keeps today's remedy text. The ident read is one bounded call of up to 14 bytes. A 14-byte `AA` .. `DD` reply names a UV-5X3-type radio and fails with the new `radio-unsupported` reason, exit 5, retry `no`.

A pure classification module turns the answering magic, the 14 raw version bytes and the ident into `family` and `flags` (`basetype`, `orig`, `voiceBool`, `band220`, `triPower`, `dtmfTable`). It never throws; no match gives `unknown` unless the magic maps to one family. The plan's `ident.ts` section fixes the rules, including the `HN5RV01` rule running first, basetypes counting only within the magic's families, and the `orig` exclusions. The flags are reported only; nothing reads them yet.

`status` adds `family`, `magic`, `ident` and `firmwareHex`; `dump` adds `family` and `magic`. Their help results, `REASON_ENUM` and the hand-written exit 5 line gain the new keys and reason. The fake radio gains the magics it acks, an ack byte override, an ident reply of any length and a firmware string. `MAGIC` stays exported as the `291` bytes.

## Acceptance criteria

- [ ] `npm run typecheck` and `npm test` pass.
- [ ] `test/core/ident.test.ts` covers every case listed under work item 1 of the plan, with the magic named in each.
- [ ] Tests show: 8-byte ident accepted; 12-byte ident collapses to 8; 14-byte ident exits 5 with `radio-unsupported` and the radio name; 9-byte ident exits 5 with the bytes in `got`; a wrong ack byte appears in `got`; the second attempt runs after `SETTLE_MS` on silence only.
- [ ] A test with `UV5R_MAGIC=UV82` sees the UV82 bytes on the `settings` write session and on its verification session.
- [ ] `UV5R_MAGIC=BOGUS` and `UV5R_MAGIC=UV6` exit 2, list the supported names, and never open the port.
- [ ] `uv5r status --json` output and the `status` help result both carry `family`, `magic`, `ident` and `firmwareHex`; `dump` carries `family` and `magic`; the existing key-check test in `cli.test.ts` passes.
- [ ] `uv5r help --json` lists `radio-unsupported` with exit 5 and retry `no`.
- [ ] On the bench, `uv5r status --json` reports `magic` `291`, `family` `uv5r` and firmware `HN5RV011`.

## Blocked by

None - can start immediately
