# Review of the whole repository, 2026-10-13

Review of main at `a7b1d94`. Uncommitted changes excluded; line numbers refer to that commit.

## Defects

1. `src/protocol.ts:129`: low-level settings writes can corrupt EEPROM. This already
   wiped the bench radio; `docs/rx-audio-investigation.md` records the partial-commit
   reproduction. An uncommitted half-write is dropped; committing at 0x0E40 with only
   one half staged zeros the other. Current CLI callers write both halves correctly.
   Track acknowledged 16-byte halves and reject commits without both; clear tracking
   on commit, restart or failure. Reject malformed and unaligned writes. Test partial
   and repeated commits, and keep ordered restore working.
2. `src/main.ts:229`: verbs ignore extra positionals. `dump` takes its path from `--out`
   and `restore` takes it as a positional, so `baofeng dump radio.img` writes to
   `uv5r-<timestamp>.img` and reports success. A later `restore radio.img` fails or
   loads an older file. `tune 146.82 5 --channel 7` and `read 5 6` also ignore extras.
   Reject unused positionals with exit 2 before opening the transport.
3. `src/radio.ts:199`: a short image raises `DeviceStateError` (exit 5). The CLI has
   already started the handshake, although `restoreImage` itself checks length first.
   Validate length in `restoreVerb` before `withTransport`; test exit 2 even without a
   radio. Also fix `.claude/skills/baofeng/SKILL.md`: exit 5 covers identity mismatches,
   bad replies and verification failures, not just a radio that did not answer.
4. `src/codec.ts:187`: `encodeName` masks each char with `& 0x7f` and does no
   validation. `--name CAFÉ` is stored as `CAFI`, `Ñ` as `Q`, and a tab as byte 0x09.
   Reject non-printable/non-ASCII input before uppercasing (`ß` becomes `SS` otherwise);
   preserve the tested seven-character truncation. Test Unicode and control characters.
5. `src/main.ts:119`: offsets bypass the 10 Hz precision check. With RX 146.820 MHz,
   `--offset -0.6000049` requests TX 146219995.1 Hz but encodes 146220000 Hz.
   Validate signed MHz offsets against 10 Hz increments before rounding. Do not reuse
   `parseFrequency` directly: it rejects negatives and rounds away sub-Hz precision.
   Test valid negative offsets and rejection of finer increments before transport access.
6. `src/main.ts:217`: on an uninterrupted key, the output reports the requested seconds.
   The interrupted path reports the measured `held.seconds`. Report the measured hold on
   both paths; test a delayed timer so requested and measured times differ.
7. `src/main.ts:330`: both completion handlers call `process.exit` immediately after
   writing output. Asynchronous pipe writes can be truncated. Set `process.exitCode`
   and let stdout and stderr drain. In both success and error paths, assert the expected
   `exitCode` is set and `process.exit` is never called.

## Defensive hardening

8. `src/protocol.ts:105`: a 16-byte read at 0x0E20 returns the 0x0E40 record without
   error. `readBlock` does not decode it; current settings callers already read full pages.
   For aliased reads, read the aligned 64-byte page and slice, or reject the request.
   Test that each affected address returns its own bytes or an explicit error.

## Optional follow-ups

9. `src/radio.ts` (`writeChannel`): the returned name comes from the intended bytes,
   not read-back. Verifying it costs one extra block read per channel write. Treat this
   separately from name validation; test an acked but ignored name write if implemented.
10. `src/radio.ts:30`: `ChannelPayload` re-declares `ChannelJson` field by field,
   `channelPayload` copies each field by hand, and `RadioStatus` repeats the
   `ChannelResult` union inline. Use `{ channel: number } & Omit<ChannelJson, 'scan'>`
   and reuse `ChannelResult`. Remove `scan` at runtime before spreading: `Omit` alone
   does not remove it. Keep the JSON shape unchanged.
11. `src/main.ts:49`: `APPLIES_AFTER_SECONDS = 3` duplicates `SETTLE_MS` in
    `protocol.ts`. A change to the measured settle time leaves `tune` reporting a stale
    wait. Derive it from `SETTLE_MS / 1000`.

## Plan

Guard settings writes first, then fix input validation and output reporting. Harden
aliased reads next; leave optional follow-ups last. Use fake-radio and CLI regressions;
these changes need no hardware writes.
