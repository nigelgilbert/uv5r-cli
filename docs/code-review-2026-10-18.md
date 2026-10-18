# Code review, 2026-10-18

Scope: entire repo at commit abe59f8. First pass by Claude, adversarial pass by Codex against the source, then one round of discussion. Eleven findings, most severe first. The original finding about `holdPtt` keying after an interrupt was dropped: the signal handlers and the first `setPtt(true)` run in the same tick, so a pre-check has nothing to catch.

## 1. High: receive-only channels cannot be written and lose inhibition on tune

Files: `src/codec.ts:170`, `src/main.ts:142`, `.claude/skills/channel-plan/SKILL.md:67`

channel-plan marks sheriff, fire and EMS channels "receive only", but its schema and command template carry no RX-only field, and `tune` has no flag for one. `main.ts` defaults the offset to zero and computes `txHz = rxHz + offsetHz`. `encodeChannel` falls back to `spec.txHz ?? spec.rxHz`, so a null TX is replaced by RX. `decodeChannel` already reads four 0xFF TX bytes as `txHz: null`, so the representation is understood on the read side only.

Failure scenario: a RadioReference sheriff frequency goes in through `uv5r tune <rxMhz> --channel <n>`. The record gets a valid TX frequency equal to RX. Tuning a channel that CHIRP had already set receive-only replaces its inhibit bytes the same way, since `writeChannel` never reads the prior record. PTT on that channel transmits on a public-safety frequency.

Fix: add an explicit inhibit field to `ChannelSpec`, a `--rx-only` flag that writes `FF FF FF FF` at bytes 4..7, and a matching field in the plan schema and command template. Define how the flag interacts with `--offset`.

## 2. Medium: the two skills send every plan entry to one channel

Files: `.claude/skills/uv5r/SKILL.md:24`, `.claude/skills/channel-plan/SKILL.md:109`

The uv5r skill says "Call it N" and "Pass `--channel N` to every `tune`". channel-plan loads the uv5r skill and maps each entry to `--channel <channel>`. `main.ts` passes the number straight to `tune`, which writes `CHANNEL_BASE + n * 16` with no guard against repeated writes to one slot.

Failure scenario: an agent follows the uv5r rule while loading a plan. All entries land in slot N, each overwriting the last. Only the final entry survives and no error is raised.

Fix: scope the displayed-channel rule to tuning the channel on the display. State in channel-plan that each entry goes to its own number and that programming another slot does not select it on the radio.

## 3. Medium: tune silently resets channel extras

File: `src/codec.ts:182`

`encodeChannel` builds a fresh zero-filled record. It clears bytes 12-13 (scode, txtoneicon), sets PTT-ID and BCL to 0 and forces scan on with `out[15] = (wide ? 0x40 : 0) | 0x04`. `writeChannel` calls it without reading the existing record. CHIRP's uv5r driver exposes bcl, pttid and scode as per-memory extras and writes the existing values back on edit; that comparison comes from CHIRP's source and sits outside this repo.

Failure scenario: a channel set up in CHIRP with BCL on and a signal code loses both after `uv5r tune 146.52 --channel 5`. The read-back compares against the record the CLI just built, so verification passes.

Fix: decide whether tune replaces or modifies a slot. If it modifies, read the old record and retain the supported fields for an initialized slot. Use explicit defaults for an erased slot; its 0xFF flags are not values to keep.

## 4. Medium: `listen` rejects captures with fewer whole frames than requested

File: `src/audio.ts:101`

`wholeSeconds` counts leading frames with a full second of samples. `listen` rejects when that count is below `seconds`. `docs/rx-audio-investigation.md:293` reports 5 s asked, 4.46 s returned. By that figure a 5 s request yields four whole frames and rejects. `README.md:128` says failures start above about 6 s and recommends 4 to 5 s. Both statements cannot hold. Either the 88 percent figure is wrong for short captures or the README threshold is.

Failure scenario: a documented `listen --seconds 5` call either fails, or the README's threshold is wrong and help advertising 1..600 is wrong by a different margin. Nobody has the astats log that settles it.

Fix: capture the astats output of a 5 s run and record the real threshold. Then request a padded duration in `ffmpegArgs`, keep slicing the first `seconds` frames, and stretch `timeoutMs` by the same padding. Keep the whole-frame check: without it an empty capture resolves with `rmsDbfs: []`.

## 5. Medium: restore verifies settings only

Files: `src/radio.ts:221`, `src/main.ts:308`

`restoreImage` writes each block and counts it with no read-back. `restoreVerb` then verifies only the settings block in a fresh session.

Failure scenario: the radio acks but drops channel or name writes. If the settings block already matched the image, restore reports every block written and exits 0 while the channel table differs from the image.

Fix: read back the writable channel and name ranges after the reload and report mismatches. Account for the regions the radio ignores on write.

## 6. Medium: a stored transport error blocks PTT release

File: `src/transport.ts:114`

`fail` records the first serial error or close event. `setPtt` rejects on a stored failure before calling `port.set`, for both key and release. `holdPtt`'s finally block therefore never reaches the port after an error. `close` does not lower DTR and ignores close errors.

Failure scenario: an error event fires while PTT is asserted and the device is still connected. Release is never attempted. A close event means the device is gone, so the exposure is the transient-error case.

Fix: apply the stored-failure guard only when asserting PTT. Let `setPtt(false)` reach the port as a best effort.

## 7. Low: skill maps exit 3 to "no device" only

File: `.claude/skills/uv5r/SKILL.md:19`

`listen` raises `TransportError` for a missing ffmpeg, an ffmpeg failure or timeout, and a short capture. `errors.ts` maps every transport error to exit 3. The skill has rules for exits 2, 3 and 5 and none for 4 (timeout) and 6 (busy).

Failure scenario: `listen` fails on a short capture or ffmpeg is off PATH. The agent asks the human to reseat the AIOC cable. A port held by another process or a missing ack gets no handling rule.

Fix: tell the agent to read `kind` and `message` before choosing a remedy. Document exits 4 and 6.

## 8. Low: `eraseChannel` never verifies the name block

File: `src/radio.ts:169`

`eraseChannel` writes 0xFF over the record and the name, then reads back only the record. `writeChannel` verifies both.

Failure scenario: the radio acks but drops the name write. erase reports `empty: true`. `readChannel` still shows the slot empty because `decodeChannel` returns nothing for an 0xFF record, so the stale name shows up only in a raw dump. The next tune replaces it, since `writeChannel` always writes a name.

Fix: read back and compare the name block after erase.

## 9. Informational: three ways to start a session

File: `src/main.ts:304`

Sessions start inline in the main.ts verbs, inside the `tune` and `erase` wrappers in radio.ts, and lazily through `s.ident ?? await s.start()` in `readStatus`, `dumpImage` and `restoreImage`. `Session.start` stores `ident`, so the lazy form skips the handshake on a started session and no double handshake occurs today.

Fix: one `withSession(t, fn)` helper and radio.ts functions that take a started session. Leave `verifySettingsInFreshSession` alone; its second session is deliberate.

## 10. Informational: settings page alias handled in two layers

Files: `src/protocol.ts:120`, `src/radio.ts:59`

`Session.readBlock` redirects 16-byte reads in 0x0E10..0x0E4F to an aligned 64-byte page read. radio.ts also reads 64-byte pages directly for the settings block and the commit record. The radio-layer calls already request 64 bytes, so the redirect never fires twice and nothing is corrupted today. The knowledge lives in two places with two comments.

Fix: keep one layer. Dropping the radio-layer page reads in favour of 16-byte reads at `SETTINGS_BASE` and `SETTINGS_BASE + 0x10` costs an extra wire read per settings fetch, so removing the protocol-layer redirect is the cheaper direction.

## 11. Informational: absolute wording in the skill

File: `.claude/skills/uv5r/SKILL.md:15`

The line opens with "Never", which the house style rule on absolutes rules out. The README wording at line 41 drops `stty` and adds a scope, so it is not a drop-in replacement.

Fix: "Do not open, `cat`, `screen` or `stty` the serial port."
