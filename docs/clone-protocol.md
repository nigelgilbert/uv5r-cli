# UV-5R clone-mode serial protocol

## 1. Scope and sources

This spec describes the serial clone protocol of the classic Baofeng UV-5R family and the neighbor protocols a radio sold as a "UV-5R" may speak instead. It derives from Chirp at commit `c604141b` (2026-10-17) through four research notes that carried `file:LINE` citations into the Chirp tree. The notes are no longer in the repo. Facts marked **Bench** were measured on the project's radio: a UV-5R with firmware `HN5RV011`, ident `AA 30 76 04 00 05 20 DD`, on an AIOC cable (USB `1209:7388`). Unmarked facts describe Chirp's behavior.

Terms:

| Term | Meaning |
|---|---|
| Magic | The 7-byte string the host sends to open a clone session. |
| Ident | The 8-byte reply the radio sends after the magic is acknowledged. It becomes image offsets `0x0000`-`0x0007`. |
| Version string | 14 bytes at radio `0x1EF0`-`0x1EFD`. Chirp calls it the firmware version. |
| Basetype | A short byte string Chirp searches for inside the version string. |
| Orig | A radio whose version string contains `BFB` followed by three ASCII digits that parse below 291. |
| Radio address | The address carried on the wire. |
| Image offset | A byte offset into the saved image file. |

All multi-byte header fields are big-endian.

## 2. Serial link

| Parameter | Chirp | Bench |
|---|---|---|
| Baud | 9600 | 9600 |
| Framing | 8N1 (library default, never set) | 8N1 |
| Flow control | None | None |
| DTR | Asserted on open | Driven low before the first byte |
| RTS | Asserted on open | Driven low before the first byte |
| Read timeout | 1 s per read call, set at the start of every ident attempt and kept for the rest of the session | - |
| Buffer flush | None, at any point | - |

The 1 s timeout is a total budget per read call. A request for N bytes returns whatever has arrived after 1 s.

**Bench.** The AIOC keys PTT when DTR is high and RTS is low. Opening the port raises DTR. Drop both lines before sending anything. The handshake and all transfers succeed with both lines low.

One byte at 9600 8N1 is 10 bit times, about 1.04 ms on the wire. A `0x40` read costs 74 bytes of line time, about 77 ms, plus the 50 ms host pause.

## 3. Handshake

### 3.1 Happy path

UV-5R, BFB291 or later firmware, magic `291`:

```
Host                                        Radio
 | open 9600 8N1, DTR=0 RTS=0, timeout 1 s    |
 | 50 ------------------------------------->  |  10 ms pause after each magic byte
 | BB ------------------------------------->  |
 | FF ------------------------------------->  |
 | 20 ------------------------------------->  |
 | 12 ------------------------------------->  |
 | 07 ------------------------------------->  |
 | 25 ------------------------------------->  |  10 ms
 |  <------------------------------------- 06 |  ACK, wait up to 1 s
 | 02 ------------------------------------->  |
 |  <--------- AA 30 76 04 00 05 20 DD        |  read 1 byte at a time, stop at DD
 | 06 ------------------------------------->  |
 |  <------------------------------------- 06 |  wait up to 1 s
 |                                    session open
 | 53 1E 80 40 ---------------------------->  |  first read: no leading 06 in reply
 |  <------------------------ 58 1E 80 40     |
 |  <------------------------ 64 data bytes   |
 | 06 ------------------------------------->  |  then 50 ms
 | 53 1E C0 40 ---------------------------->  |
 |  <------------------------------------- 06 |  every later read: leading 06
 |  <------------------------ 58 1E C0 40     |
 |  <------------------------ 64 data bytes   |
 | 06 ------------------------------------->  |  then 50 ms
```

**Bench.** The bench radio follows this sequence byte for byte.

### 3.2 Rules for one attempt

1. Set the read timeout to 1 s.
2. Send the 7 magic bytes one at a time. Pause 10 ms after each byte, including the last. The send phase takes about 77 ms.
3. Read 1 byte. Continue on `06`. Fail as no-contact on silence or any other byte.
4. Send `02` with no pause before or after.
5. Read the ident one byte per read call, up to 12 reads, each with the 1 s timeout. Stop as soon as a `DD` byte arrives. A read that times out adds no byte and still counts toward the 12.
6. Accept a total length of 8 or 12 bytes. Fail as bad-ident on any other length.
   - 8 bytes: the ident is the reply unchanged.
   - 12 bytes: keep reply positions 0, 3, 5, 7, 8, 9, 10, 11, in that order. Drop positions 1, 2, 4, 6 without checking their values. Chirp's comment says those bytes hold `01`.
7. Send `06`. Read 1 byte. Fail as clone-refused on silence or any byte other than `06`.
8. Return the 8-byte ident. It becomes the first 8 bytes of the image.

Chirp checks nothing in the ident beyond the length and the `DD` terminator. It dropped its leading-`AA` check in 2016.

The 12-byte form comes from the current UV-6: `AA 01 01 36 01 74 01 04 00 05 20 DD` collapses to `AA 36 74 04 00 05 20 DD`. Chirp first stripped every `01` byte. It switched to the positional rule after a UV-82HP with a band limit ending in `01` lost a real `01` byte.

Consequences of rules 5 and 6:

| Radio behavior after `02` | Outcome |
|---|---|
| 8 or 12 bytes ending in `DD` | Accepted at once |
| Exactly 8 bytes, no `DD` | Four more 1 s timeouts, then accepted. About 4 s extra. |
| `DD` before position 8 | Short length, bad-ident |
| More than 12 bytes, no `DD` | First 12 accepted, the rest stays in the input buffer |
| Silence | 12 timeouts, about 12 s, then bad-ident |

### 3.3 Failure classes

| Class | What the wire shows | Chirp message | Chirp retries the next magic |
|---|---|---|---|
| no-contact | No byte within 1 s of the last magic byte | "No response from radio. Check connector and cabling!" | Yes |
| wrong-ack | A byte other than `06` after the magic | Same as no-contact. The byte appears only in the debug log. | Yes |
| bad-ident | `06`, then an ident of a length other than 8 or 12 | "Unexpected response from radio." | Yes |
| clone-refused | Valid ident, then silence or a byte other than `06` after the host's `06` | "Radio refused clone" | Yes |
| foreign | Every model magic failed and a foreign magic got `06` and a valid-length ident | "Radio identifies as <model>. Please choose the proper vendor/model and try again." | No |
| port-error | Serial exception | "Failed to communicate with radio: <detail>" | No |

Report wrong-ack separately from no-contact and include the byte. Chirp merges them, which hides a radio that speaks a different protocol at 9600.

When every model magic fails, Chirp reports the error from the last magic it tried. For a UV-5R that is the `ORIG` attempt.

### 3.4 Retry pacing

- Chirp pauses 2 s after each failed model-magic attempt, including the last.
- Chirp sends the foreign probes back to back with no pause.
- Chirp never drains the input buffer. Late bytes from a failed attempt are read as the first reply to the next one.
- A silent UV-5R costs about 8.3 s: two magics at 77 ms + 1 s + 2 s each, then two foreign probes at 77 ms + 1 s each.

**Bench.** A second handshake inside a live session fails, and the radio drops an idle session after about 2.5 s (section 8). An attempt that got the `06` may leave a session open. Chirp's 2 s pause is shorter than the drop, so Chirp's next magic can land inside that session. This is an inference from the two measurements.

Recommended pacing:

1. Drain the input buffer before each magic.
2. After a failure with no `06`, pause 2 s.
3. After a failure that got the `06`, pause at least 3 s.

### 3.5 Probe without the closing `06`

A probe runs rules 1-6 and skips rule 7. Chirp uses it for foreign magics. It tells the host whether the radio answers that magic and what ident it returns. The host never confirms the session. The state of the radio after a probe is undocumented; pause at least 3 s before the next magic.

## 4. Device ID table

### 4.1 Classic magics

All eight classic magics share the prefix `50 BB FF`. Bytes 3-6 of most of them read as BCD dates. Chirp attaches no meaning to that.

| Name | Bytes | Chirp sends it for |
|---|---|---|
| `291` | `50 BB FF 20 12 07 25` | UV-5R, UV-5G Pro, UV-5RX3, GT-5R, KT-980HP, BF-F8HP |
| `ORIG` | `50 BB FF 01 25 98 4D` | UV-5R, UV-5G Pro, UV-5RX3, GT-5R |
| `A58` | `50 BB FF 20 14 04 13` | BF-F8HP |
| `UV82` | `50 BB FF 20 13 01 05` | UV-82, UV-82X3, UV-82HP |
| `F11` | `50 BB FF 13 A1 11 DD` | F-11 |
| `UV6` | `50 BB FF 20 12 08 23` | UV-6 |
| `UV6_ORIG` | `50 BB FF 12 03 98 4D` | UV-6 |
| `UV5G` | `50 BB FF 20 12 06 25` | Radioddity UV-5G. Every other model also sends it as a foreign probe. |

Try order per model:

| Model | Magics, first to last |
|---|---|
| UV-5R and its aliases, UV-5G Pro, UV-5RX3, GT-5R | `291`, `ORIG` |
| BF-F8HP and its aliases | `291`, `A58` |
| KT-980HP | `291` |
| UV-82, UV-82X3, UV-82HP | `UV82` |
| F-11 | `F11` |
| UV-6 | `UV6`, `UV6_ORIG` |
| UV-5G | `UV5G` |

Chirp tried `ORIG` first until 2014, then reordered so newer radios answer sooner. Chirp never scans across models. The user's model choice fixes the list.

UV-5R aliases in Chirp: Baofeng UV-5X, Retevis RT5R, RT5RV, RT5, Rugged RH5R, Radioddity UV-5R EX, Ansoko A-5R. BF-F8HP aliases: Retevis RT5 (tri-power), Radioddity GA-5S, Baofeng UV-5XP, TechSide TI-F8+ and TS-T9+, Tenway UV-5R Pro, TIDRADIO TD-UV5R TriPower. UV-82HP alias: Tenway UV-82 Pro. Chirp's alias map also sends UV-5R+, UV-5R MK4/MK5, UV-5R HTQ, UV-5R7W/8W, UV-5RTP, UV-5RHP and UV-5RM HP to BF-F8HP; UV-5RA/AX, UV-5RB through RU, UV-5R V2+, UV-5R2, UV-5R++ and UV-5S to UV-5R; UV-5RA3 and UV-5RIII to UV-5RX3.

### 4.2 Foreign magics on the same 9600 link

A reply to any of these means the radio belongs to another driver and has a different memory layout.

| Bytes | Radio | Ident reply | Other differences |
|---|---|---|---|
| `50 0D 0C 20 16 03 28` | BTECH UV-5X3 | 14 bytes, `AA` .. `DD` | Contiguous `0x0000`-`0x1FFF` read, ident appended at the image end. Chirp probes it as a blacklist entry. |
| `50 0D 0C 20 17 09 19` | MTC UV-5R-3 | 14 bytes, `AA` .. `DD` | As UV-5X3 |
| `50 BB FF 20 14 11 22` | UV-6R | 8 bytes | Version at `0x1FF0`, no per-block ACK |
| `50 BB FF 20 12 05 25` | UV-9G (WP970I driver) | 8 bytes | WP970I layout |
| `50 BB DD 55 63 98 4D` | Baojie BJ-UV55 | 8 bytes | 6-byte version at `0x1FF0`, own memory map |

Two classic magics are shared with the WP970I driver. `A58` equals the WP970I magic and also opens the BF-A58. `291` also opens the UV-S9X3 and the 5RX. A reply to either one leaves the classic and WP970I families unseparated. The version string separates them: the BF-A58 reports `BFT515 ` or `BFT517 `.

Chirp's TD-H8 driver keeps its own blacklist magic `50 56 4F 4A 48 1C 14` for the TIDRADIO TD-H8. The notes do not record its baud.

### 4.3 Firmware basetype table

| String | Family |
|---|---|
| `BFS`, `BFB`, `N5R-2`, `BTS`, `D5R2`, `B5R2` | UV-5R |
| `N5R2` | UV-5R and UV-82HP |
| `N5RV` | UV-5R and BF-F8HP |
| `USA` | F-11 |
| `US2S2`, `B82S`, `BF82`, `N82-2`, `N822` | UV-82 |
| `N82-3`, `N823` | UV-82HP |
| `HN5RV01` | UV-82X3 |
| `BF1`, `UV6` | UV-6 |
| `BFP3V3 B` | KT-980HP |
| `BFP3V3 F`, `N5R-3`, `N5R3`, `F5R3`, `BFT` | BF-F8HP |
| `BJ55` | BJ-UV55 |

Matching is a case-sensitive substring test anywhere in the 14-byte version string.

Overlaps:

- `N5R2` belongs to UV-5R and UV-82HP. Chirp added it to UV-82HP for a GT-5TP that reports a UV-5R style string.
- `N5RV` belongs to UV-5R and BF-F8HP. Chirp added it to BF-F8HP for the UV-5XP.
- `HN5RV01` contains `N5RV`, so it also matches UV-5R and BF-F8HP. Chirp's UV-5G and UV-5G Pro test images carry `HN5RV011`. **Bench:** the bench UV-5R carries `HN5RV011`. History records `HN5RV001` in both 2-power and 3-power radios.

Recorded version strings:

| String | Radio |
|---|---|
| `  Ver  BFB231 ` | Orig UV-5R |
| `USA307 USA349 ` | F-11 |
| `HN5RV011` padded with `FF` or `00` | UV-5G, UV-5G Pro, bench UV-5R |
| `N5R2401BFB297`, `HN5RV011FB297`, `BTS311`, `BFB297` | UV-5R variants |
| `N5R3401`, `F5R3407` | BF-F8HP |
| `BF8210`, `B82S21` | UV-82 |
| 14 x `FF`, 7 x `FF`, 14 x `20` | Radios that report no version |

### 4.4 What the ident carries

| Fact | Detail |
|---|---|
| Framing | Starts with `AA` in every recorded sample and ends with `DD`. Chirp checks only the `DD` terminator and the length. |
| 220 MHz flag | Byte 3 equal to `02` marks a radio whose second band is 220-260 MHz. Chirp guards the feature with "not orig". The upload band check has no guard. |
| Band limits, post-291 | Inferred: bytes 1-6 hold the band limits in BCD. Byte 1 is the VHF lower limit minus 100 MHz, byte 2 the VHF upper limit minus 100 MHz, bytes 3-4 the second-band lower limit, bytes 5-6 its upper limit. |
| Version, orig | Orig radios spell the BFB version in ASCII between `AA` and `DD`. |

Samples under the inferred band-limit layout:

| Ident | Reading |
|---|---|
| `AA 44 48 04 30 04 50 DD` (bytes 1-6 from a 2012 BFB291 report) | 144-148, 430-450 MHz |
| `AA 36 74 04 00 05 20 DD` (old UV-6; also Chirp's F-11 test image) | 136-174, 400-520 MHz |
| `AA 30 76 04 00 05 20 DD` (UV-5G Pro test image; **Bench** UV-5R) | 130-176, 400-520 MHz |
| `AA 44 46 04 00 04 70 DD` (UV-5G test image) | 144-146, 400-470 MHz |
| `AA 42 46 42 32 33 31 DD` (orig UV-5R) | ASCII `BFB231`. Byte 3 is `32`, an ASCII digit. |

### 4.5 What the ident does not carry

- Model identity. Post-291 idents change with the user's band-limit settings. Different models return identical idents.
- Firmware version on post-291 radios.

History. In 2012 Chirp parsed ident bytes 1-6 as `BFB` and a version number. When BFB291 radios arrived, rebranded units returned other bytes, and Chirp deleted the parsing in December 2012: "It was never reliable, and apparently not very identifying anyway." The version moved to the aux string at `0x1EF0`. In 2014 a basetype mismatch on download became fatal, to stop users picking the wrong model. In 2017 Chirp exempted `HN5RV` and blank strings, because `HN5RV001` ships in both 2-power and 3-power radios. In October 2023 Chirp removed basetype from live-radio logic entirely (issue #10505). Since then the user's model choice fixes the class, the ident gives only the 220 MHz flag, and basetype matches saved image files only.

### 4.6 Classification procedure

1. Drain input. Try the classic magics in this order: `291`, `ORIG`, `UV82`, `F11`, `UV6`, `UV6_ORIG`, `A58`, `UV5G`. Pace per section 3.4. The first magic that completes the handshake wins. This order is a proposal; Chirp never scans.
2. If every classic magic fails, probe each foreign magic without the closing `06`. A reply names the foreign radio. Report it and stop.
3. Narrow the family by the magic that answered:

| Magic | Candidates |
|---|---|
| `291` | UV-5R, UV-5G Pro, UV-5RX3, GT-5R, KT-980HP, BF-F8HP; UV-S9X3 and 5RX in the WP970I family |
| `ORIG` | UV-5R, UV-5G Pro, UV-5RX3, GT-5R |
| `A58` | BF-F8HP; WP970I and BF-A58 in the WP970I family |
| `UV82` | UV-82, UV-82X3, UV-82HP |
| `F11` | F-11 |
| `UV6`, `UV6_ORIG` | UV-6. Skip step 4; the radio has no aux block. |
| `UV5G` | UV-5G |

4. Read `0x1E80`, `0x1EC0`, `0x1FC0` (section 6.4). Take the version string at `0x1EF0`-`0x1EFD`. Record whether `0x1FCF` reads `FF`.
5. Match the version string against the candidates, most specific first. Stop at the first hit.
   1. `HN5RV01`: UV-82X3 when the magic was `UV82`. With `291` or `UV5G` it marks the HN5RV family and leaves the model to the magic.
   2. `BFP3V3 B`: KT-980HP.
   3. `BFP3V3 F`, `N5R-3`, `N5R3`, `F5R3`, `BFT`: BF-F8HP. `BFT` with magic `A58` may also be a BF-A58.
   4. `N82-3`, `N823`: UV-82HP.
   5. `US2S2`, `B82S`, `BF82`, `N82-2`, `N822`: UV-82.
   6. `USA`: F-11.
   7. `BF1`, `UV6`: UV-6.
   8. `N5R2`: UV-82HP with magic `UV82`, else UV-5R.
   9. `N5RV`: UV-5R. Tri-power cannot be read from this string.
   10. `BFS`, `BFB`, `N5R-2`, `BTS`, `D5R2`, `B5R2`: UV-5R.
6. No hit, or a blank version string: classify as an unknown classic variant. Keep the magic-derived family, use the UV-5R memory layout and two power levels, derive the flags in section 5, and report the version bytes in hex. Chirp's wire path accepts such a radio.
7. Store the ident at image `0x0000`-`0x0007` and the version at `0x1838`-`0x1845`, so steps 5-6 can run again on a saved image.

## 5. Firmware-dependent behavior

| Item | Rule |
|---|---|
| Orig | The version string contains `BFB` and the three bytes after the first `BFB` parse as a decimal integer below 291. No `BFB` means not orig. `BFB` followed by non-digits is an error in Chirp. F-11, UV-82 family, UV-6, KT-980HP, BF-F8HP and UV-82HP always count as not orig. |
| Voice prompt | Boolean when orig and the BFB number is below 251, and on the TI-F8+ and TS-T9+ aliases. Otherwise a list: Off, English, Chinese. Image `0x0E36` (radio `0x0E2E`). |
| 220 MHz bands | Not orig and ident byte 3 = `02`: bands are VHF and 220-260 MHz, with no UHF. |
| Band limits, orig | `limits_old` at radio `0x1FC8` (24 bytes). VHF entry at `0x1FCA`, UHF entry at `0x1FDA`. |
| Band limits, not orig | `limits_new` at radio `0x1FC0` (10 bytes). VHF entry at `0x1FC0`, UHF entry at `0x1FC5`. |
| Band limit entry | 5 bytes: enable byte, lower limit as 2-byte big-endian BCD, upper limit as 2-byte big-endian BCD. The notes give this layout for `limits_new` and leave the old entry layout unstated. |
| Tuning steps | Chirp defines a 6-entry list (2.5, 5, 6.25, 10, 12.5, 25 kHz) and an 8-entry list adding 20 and 50 kHz. Orig radios use the 6-entry list and later radios the 8-entry list, as the VFO A/B step setting in bits 4-6 of radio `0x0F1E` and `0x0F3E`. |
| Service squelch | Not orig with an aux block: 10 VHF thresholds at radio `0x1F60` and 10 UHF thresholds at `0x1F80`. Old-firmware tables at `0x1FA0` and `0x1FB0` are defined and unused. |
| DTMF character table | Version line 1 (first 7 bytes) equal to `HN5RV01`: `0123456789ABCD*#`. Otherwise `0123456789 *#ABCD`. |
| Tri-power | KT-980HP, BF-F8HP, UV-82HP and their aliases. Power field 0 = High 8 W, 1 = Med 4 W, 2 = Low 1 W. Two-power radios: 0 = High 4 W, 1 = Low 1 W. |
| Aux block | Absent on the UV-6 only. |
| BJ-UV55 | Power-on message at image `0x1928`, version at image `0x1938`-`0x193D`. |

### 5.1 Dropped-byte defect

Some newer radios drop the byte at radio `0x1FCF` when the aux area is read in `0x40` blocks. The next `0x30` bytes shift down one place, `0x1FCF` reads as `FF`, and `80` pads the missing last byte at `0x1FFF`.

Detection: read `0x1FC0` with length `0x40`. Byte 15 equal to `FF` sets the flag.

Read strategy:

| Flag | Aux read |
|---|---|
| Set | `0x1EC0`-`0x1FBF` in four `0x40` blocks, then `0x1FC0`-`0x1FFF` in four `0x10` blocks |
| Clear | `0x1EC0`-`0x1FFF` in five `0x40` blocks |

Chirp keeps `0x40` blocks on clear radios because firmware before BFB291 rejects `0x10` reads in the aux area.

### 5.2 `0x1E80`-first ordering

Read one block outside `0x1EC0`-`0x1FFF` before the first aux read. Chirp reads `0x1E80` with length `0x40` and discards it. Newer radios return a different version string and bad aux data when the aux area is read first. Reading one or more blocks beforehand returns the same data a full download sees. This read is also the first command after the ident, so its reply has no leading `06`. Chirp added the ordering in 2023 under issue #10505.

## 6. Block read and write

### 6.1 Read request, host to radio

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `53` (`S`) |
| 1 | 2 | Radio address |
| 3 | 1 | Length |

Send the 4 bytes in one write with no pause before them.

### 6.2 Read reply, radio to host

| Part | Size | Content |
|---|---|---|
| Leading ACK | 1 | `06`. Present on every read except the first one after the ident. |
| Header | 4 | `58` (`X`), radio address, length. All three echo the request. |
| Data | length | The block. No checksum. |

Leading-ACK rule: the handshake's final `06`/`06` exchange consumes the radio's ACK before the first read. After every block the host sends `06` and reads no reply. The radio's answering `06` is read as the leading byte of the next block's reply. The UV-6 path follows the same rule with `0x0000` as its first read.

**Bench.** Reads of the second and later blocks start with `06` from the radio. The radio serves 16-byte-aligned blocks and echoes the requested address.

### 6.3 Host ACK and pacing

After the data, send `06`, then pause 50 ms. Chirp originally used 5 ms and raised it to 50 ms in 2015 to fix "radio refused to send block 0x1ec0".

### 6.4 Read sizes and alignment

| Size | Use |
|---|---|
| `0x40` | Main area, probe reads, aux area on clear radios |
| `0x10` | `0x1FC0`-`0x1FFF` on dropped-byte radios |

Every read address in Chirp is a multiple of `0x10`. Main and `0x40` aux reads are `0x40`-aligned.

**Bench.** A 16-byte read at `0x0E10`, `0x0E20`, `0x0E30` or `0x0E40` returns the `0x0E40` record. A 64-byte read at `0x0E00` returns the true layout. Read the settings region in 64-byte blocks.

### 6.5 Write frame

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `58` (`X`) |
| 1 | 2 | Radio address, `0x10`-aligned |
| 3 | 1 | `10` |
| 4 | 16 | Payload |

Send header and payload in one write. Pause 50 ms, then read 1 byte and require `06`. Send nothing after the ACK. The next frame follows at once.

**Bench.** Every 16-byte aligned write is acked. Writes land in channel memory and names. Section 8 covers the settings block and the regions that ignore writes.

### 6.6 Errors

| Condition | Chirp message |
|---|---|
| Non-first read: leading byte missing or not `06` | "Radio refused to send second block 0x%04x" |
| Fewer than 4 header bytes | "Radio refused to send block 0x%04x" |
| Header command, address or length does not echo the request | "Unknown response from radio" |
| Zero data bytes | "Radio did not send block 0x%04x" |
| Some data bytes, fewer than the length | "Radio sent incomplete block 0x%04x" |
| Write ACK missing or not `06` | "Radio refused to accept block 0x%04x" |

Chirp does not retry block errors.

## 7. Download and upload

### 7.1 Image layout

| Image offset | Size | Content | Radio address |
|---|---|---|---|
| `0x0000`-`0x0007` | 8 | Ident | none |
| `0x0008`-`0x1807` | `0x1800` | Main area | `0x0000`-`0x17FF` |
| `0x1808`-`0x1947` | `0x140` | Aux area | `0x1EC0`-`0x1FFF` |

Main: image offset = radio address + 8. Aux: image offset = `0x1808` + (radio address - `0x1EC0`). Radio `0x1800`-`0x1EBF` is never read or written.

| Image size | Meaning |
|---|---|
| `0x1808` | No aux block. UV-6 images. |
| `0x1948` | Current image |
| `0x1950` | Current image plus an 8-byte model-name trailer at `0x1948`, written by older Chirp versions |

Chirp may also append a metadata blob that starts with `00 FF 63 68 69 72 70 EE 69 6D 67 00 01` (`chirp`, `img`). Strip it before checking the size.

Key regions, radio addresses:

| Address | Size | Content |
|---|---|---|
| `0x0000` | 128 x 16 | Channel records 0-127. First byte `FF` marks an empty channel. |
| `0x0B00` | 15 x 16 | PTT-ID DTMF codes |
| `0x0C80` | `0x34` | ANI and DTMF special codes |
| `0x0E20` | `0x2E` | Settings block |
| `0x0E76` | 2 | MR channel for A and B |
| `0x0F08`, `0x0F28` | 24 each | VFO A, VFO B |
| `0x1000` | 128 x 16 | Channel names, 7 characters each |
| `0x1ED0` | 14 | Second power-on message, read-only |
| `0x1EE0` | 14 | Power-on message |
| `0x1EF0` | 14 | Version string |

**Bench.** The bench radio uses this layout. Work mode sits at `0x0E4C` and the display line flag in bit 7 of `0x0E4A`.

### 7.2 Download

1. Handshake. The ident starts the image.
2. Probe reads, each length `0x40`:
   - UV-6: `0x0000`, discarded.
   - All other classic models: `0x1E80` (discarded), `0x1EC0` (version in bytes 48-61), `0x1FC0` (dropped-byte flag in byte 15).
3. Main area: `0x0000`-`0x17FF` in 96 ascending `0x40` reads.
4. Aux area per section 5.1. The UV-6 skips it.
5. Chirp sends nothing further.

A full download is about 104 reads, about 13 s.

### 7.3 Upload

1. Handshake.
2. Band check. If radio ident byte 3 or image byte `0x0003` equals `02`, the two have to match. Otherwise refuse: "Image not supported by radio".
3. Probe reads, each length `0x40`, aux-block models only: `0x1E80` (discarded), `0x1EC0`, `0x1F00`, `0x1F40`, `0x1F80`, `0x1FC0`. Dropped-byte radios also use `0x40` here.
4. Orig check. Apply the orig rule to the radio's version string and to image `0x1838`-`0x1845`. Refuse on a mismatch: "Image not supported by radio".
5. Aux comparison. Compare the three protected areas between radio and image. All three equal sets `aux_matched`.
6. Refuse when the radio has the dropped-byte flag, `aux_matched` is false and no override is set: "Image not supported by radio. You must... 1. Download from radio. 2. Make changes. 3. Upload back to same radio."
7. Write the main ranges ascending, then the aux ranges ascending. No pause separates step 3 from the first write.

Protected aux areas:

| Area | Radio address | Image offset | Source block bytes |
|---|---|---|---|
| 1 | `0x1F00`-`0x1F5F` | `0x1848`-`0x18A7` | all of `0x1F00`, bytes 0-31 of `0x1F40` |
| 2 | `0x1F70`-`0x1F7F` | `0x18B8`-`0x18C7` | bytes 48-63 of `0x1F40` |
| 3 | `0x1F90`-`0x1FBF` | `0x18D8`-`0x1907` | bytes 16-63 of `0x1F80` |

The default ranges never write these areas. The BJ-UV55 map places TX power tuning tables in area 1, so the areas likely hold per-unit calibration.

Default main ranges, radio addresses:

| Range | Blocks |
|---|---|
| `0x0000`-`0x0CEF` | 207 |
| `0x0CF0`-`0x0CFF` skipped | 1 |
| `0x0D00`-`0x0DEF` | 15 |
| `0x0DF0`-`0x0DFF` skipped | 1 |
| `0x0E00`-`0x17FF` | 160 |

Chirp gives no reason for the skips. From 2014 to 2016 Chirp read `0x0CF0` as a "special block" and refused uploads when it differed from the image.

Range selection:

| Condition | Main | Aux |
|---|---|---|
| UV-6 | Default | None |
| BJ-UV55 | `0x0000`-`0x17FF` | `0x1EC0`-`0x1FFF` |
| Override set | `0x0000`-`0x17FF` | `0x1EC0`-`0x1FFF` |
| Image is orig | Default | `0x1EE0`-`0x1EEF`, `0x1FC0`-`0x1FDF` |
| Dropped-byte flag, or `aux_matched` | Default | `0x1EC0`-`0x1FFF` |
| Otherwise | Default | `0x1EE0`-`0x1EEF`, `0x1F60`-`0x1F6F`, `0x1F80`-`0x1F8F`, `0x1FC0`-`0x1FCF` |

The last row writes the power-on message, VHF squelch, UHF squelch and new band limits.

Override: the Chirp setting "Range Override Parameter" set to `UseAtOwnRisk` enables the override. It also skips the step-6 refusal. The band and orig checks still apply. After the writes Chirp clears the flag and raises "This is NOT an error. The upload has finished successfully. Please restart CHIRP."

A default upload is 382 writes, about 28 s. The full aux range adds 20 writes.

## 8. Session lifetime

Chirp has no end-of-session command. It sends nothing after the last block, adds no delay, and has no idle-timeout handling. Its prompts tell the user to power-cycle the radio before each download or upload.

**Bench** measurements:

- The radio drops the session after about 2.5 s without a command, then reloads its settings.
- A second handshake inside a live session fails. Wait for the drop.
- Reads of `0x0E00`-`0x0E7F` return the values loaded at the last reload. A settings write reads back unchanged until the next session.
- After a reload the settings page reads back the written channel A/B value while the display shows the knob channel.
- 16-byte writes at `0x0E20` and `0x0E30` go into a 32-byte staging buffer that starts zero-filled each session.
- A 16-byte write at `0x0E40` commits the staging buffer to EEPROM.
- Writing one half and then `0x0E40` commits zeros over the other half.
- A lone write at `0x0E20` or `0x0E30` is acked and dropped. So are a 32-byte write at `0x0E20` and a 64-byte write at `0x0E00`. `0x0E20` followed by `0x0E30`, or by `0x0000`, commits nothing.
- Writes to the VFO region `0x0F08`-`0x0F3F` and to the channel selection at `0x0E4C` and `0x0E76`-`0x0E77` are acked and ignored.

Rules that follow:

1. Keep every gap between commands under 2.5 s. A download or upload stays well inside this.
2. To change settings, write `0x0E20`, `0x0E30`, then `0x0E40` in one session. Chirp's ascending upload does this.
3. Verify a settings write in a fresh session.
4. After a session, wait at least 3 s before the next handshake.

## 9. Non-classic radios sold under the UV-5R name

| Family | Baud | Opening exchange | Names a buyer sees |
|---|---|---|---|
| Baofeng-common | 9600 | Magic `50 0D 0C ...` or another foreign magic from section 4.2; 14-byte `AA` .. `DD` ident on UV-5X3 and UV-5R-3 | BTECH UV-5X3, MTC UV-5R-3, UV-6R, WP970I, BF-A58, UV-82WP (UV-5RWP), BF-A58S, UV-S9X3, 5RX |
| UV17Pro | 115200 | 16-byte ASCII magic `PROGRAM...U` in one write, reply `06` | UV-17Pro (UV-17R), UV-17ProGPS, UV-21ProV2, UV-21ProGPS, UV-25, UV-28Plus, UV-32, GM-21, GM-30 Plus/Pro, 5RM (AR-5RM, UV-5RH Pro Max), MaxTalker P15 / MT-5RM, K5-Plus, UV-5RM Plus, GM-5RH, Radioddity UV-5G Plus, UV-17R-Plus (UV-17M), BF-F8HP-PRO, UV-5RH (BF-5RH), K6, UV-5R Mini, UV-5G Mini |
| UV17 "blue screen" | 57600 | `PSEARCH`, reply `06` + `UV15999`, or `06` + `DMR1702` on the GA-510 V2 | UV-17, UV-13Pro (P15UV), Radioddity GA-510 V2 |
| Quansheng UV-K5 | 38400 | Frames `AB CD`, length, `00`, obfuscated payload with CRC16, `DC BA`; hello payload `14 05 04 00 6A 39 57 64` | Quansheng UV-5R Plus |

"UV-5R Plus" is ambiguous: the Baofeng UV-5R+ is classic and the Quansheng UV-5R Plus is a UV-K5. "UV-5R Pro 2nd gen" and "UV-5R EX Gen3" have no Chirp entry.

UV17Pro magics. The CLI probes the first two, since the others name no radio sold as a UV-5R.

| ASCII | Models |
|---|---|
| `PROGRAMBFNORMALU` | UV-17Pro, UV-21ProV2, UV-25, 5RM, P15, MT-5RM, K5-Plus, UV-5RM Plus, UV-17R-Plus, UV-5RH |
| `PROGRAMCOLORPROU` | UV-17ProGPS, GM-21, GM-30 Plus/Pro, UV-32, UV-21ProGPS, UV-28Plus, UV-5R Mini, UV-5G Mini fw 0.01 |
| `PROGRAMBFGMRS05U` | GM-5RH, Radioddity UV-5G Plus |
| `PROGRAMBF5RTECHU` | BF-F8HP-PRO |
| `PROGRAMBF-K6PROU` | K6 |
| `PROGRAMGMRS5RMIU` | UV-5G Mini fw 0.05 |

UV17Pro radios answer with one `06`. They use no `02` request and no `AA` .. `DD` ident, read with `52` (`R`) and write with `57` (`W`), carry no per-block host ACK, and XOR-obfuscate the payload.

Probe sequence:

| Step | Baud | Send | Classic UV-5R | Other family |
|---|---|---|---|---|
| 1 | 9600 | Classic magic, byte-paced | `06` within 1 s | Chirp has no record of a UV17 or UV17Pro reply at 9600 |
| 2 | 9600 | `02` after `06` | 8 or 12 bytes, `AA` .. `DD` | 14 bytes `AA` .. `DD`: UV-5X3 or UV-5R-3 |
| 3 | 9600 | Foreign magics as probes | No `06` | `06` names the radio in section 4.2 |
| 4 | 115200 | Each of the two 16-byte `PROGRAM...U` magics | - | `06`: UV17Pro family; the magic narrows the model group |
| 5, Chirp only | 57600 | `PSEARCH` | - | `06 UV15999`: UV-17 or UV-13Pro. `06 DMR1702`: GA-510 V2. |
| 6, Chirp only | 38400 | UV-K5 hello frame | - | Reply starting `AB CD`: Quansheng UV-K5 family |

The CLI runs steps 1 to 4. A UV-17, UV-13Pro, GA-510 V2 or UV-K5 has no step there, so it gets the same report as a cable fault.

Messages:

| Result | Report |
|---|---|
| No reply at steps 1 to 4 | Cable or K1 plug fitment problem, or a radio from step 5 or 6 |
| Reply at step 3 or 4 | The detected family, and that this CLI speaks only the classic UV-5R protocol |
| `06` at step 1, 14-byte ident | UV-5X3-type radio |
| `06` at step 1, ident of another length | Unknown UV-5R variant, with the ident bytes in hex |

After a reply at step 4 the radio sits in program mode until power-cycled. Chirp has no exit command for the UV17Pro or UV17 family.

## 10. Timing constants

| Constant | Value | Applies to | Source |
|---|---|---|---|
| Baud | 9600 | Whole classic session | Chirp, Bench |
| Byte time | 1.04 ms | 9600 8N1 | Derived |
| Read timeout | 1 s per read call | ACK, each ident byte, second ACK, every block read | Chirp |
| Magic byte pause | 10 ms after each byte, including the last | Handshake | Chirp |
| Ident read limit | 12 single-byte reads | Handshake | Chirp |
| Pause after a failed model magic | 2 s | Retry | Chirp |
| Pause between foreign probes | 0 s | Retry | Chirp |
| Pause after host `06` on a read | 50 ms | Each block read | Chirp |
| Pause after a write frame, before reading its ACK | 50 ms | Each write | Chirp |
| Idle session drop | about 2.5 s | Any live session | Bench |
| Recommended pause before a new handshake after an ACKed attempt or a session | 3 s | Retry, reconnect | Derived from Bench |
| `0x40` read | about 127 ms | 77 ms line time + 50 ms | Derived |
| `0x10` write | about 72 ms | 22 ms line time + 50 ms | Derived |
| Full download | about 13 s | 104 reads | Derived |
| Default upload | about 28 s | 382 writes | Derived |
| Port timeout at open | 0.25 s (GUI), 0.5 s (CLI) | Replaced before first use | Chirp |

## 11. Open questions for the bench

1. Does the radio send its `06` in reply to the host's block ACK, or as a prefix to the next reply? Wait 1 s after the host `06` and check for a byte before sending the next `S`.
2. Is the first command after the ident special to the radio, or only to the host's ACK bookkeeping? The UV-6 path discards its first read at `0x0000` with no stated reason.
3. Upload ACK skew. If the answer to Q1 is "reply to the host ACK", the trailing `06` after the last probe read is read as the first write's ACK, and every later ACK is read one frame late. Confirm, or drain input before the first write.
4. Which radios send the 12-byte ident? Are positions 1, 2, 4 and 6 always `01`?
5. Does every classic ident start with `AA`?
6. Ident layout. Confirm the BCD band-limit reading by changing the band limits on the bench radio and reading the ident again.
7. Does one radio ACK more than one classic magic? For example, does the bench radio ACK both `291` and `ORIG`? The classification order assumes the first ACK is authoritative.
8. Is the 10 ms magic pacing needed? Baofeng-common drivers send the magic in one write.
9. Are the 50 ms pauses after reads and writes needed, or margin?
10. What state does a probe without the closing `06` leave the radio in? Does it also drop after 2.5 s? What does the radio do with a new magic mid-session or mid-handshake?
11. Does any radio send an 8-byte ident without `DD`? The 4 s wait it costs exceeds the 2.5 s idle drop.
12. What do radio `0x0CF0`-`0x0CFF` and `0x0DF0`-`0x0DFF` hold, and why does the default upload skip them?
13. What does radio `0x1800`-`0x1EBF` hold? Is it readable?
14. Does any firmware without `BFB` in its version string use the old band-limit and squelch layout?
15. On a dropped-byte radio, does a full-aux upload restore bytes that the next `0x40` read would corrupt?
16. Do real tri-power radios report `N5RV` or `N5R2`? A metadata-less image of one would open in Chirp as a two-power UV-5R.
17. Does `HN5RV01` mark a firmware family spanning UV-82X3, UV-5G, UV-5G Pro and the UV-5R? The bench UV-5R reports `HN5RV011`.
18. A radio that ACKs `A58` may be a BF-F8HP or a WP970I-family radio. Is the version string enough to separate them?
19. Does a UV17Pro-family radio emit anything at 9600 when sent a classic magic?
20. Does a UV17Pro magic at 115200 have any side effect on a classic UV-5R?
21. After a UV17Pro or UV17 probe, does the radio need a power cycle before the next probe?
22. The UV17Pro `46` and `4D` replies likely hold model and firmware text. Can they name the exact model?
23. What protocol do the "UV-5R Pro 2nd gen" and "UV-5R EX Gen3" speak?
24. Which hardware batches show the `0x1E80` symptom and the dropped byte? Chirp issue #10505 may list them.
25. The README says writes at `0x0E4C` and `0x0E76`-`0x0E77` are ignored. The bench repair log shows a write of the `0x0E40` block committing the staging buffer. Does the radio apply any byte of the `0x0E40` block, or only treat the write as the commit trigger?
26. BJ-UV55 in Chirp reads `0x40` bytes at `0x1FF0`, past `0x2000`, and reaches the aux branch with the dropped-byte flag unset. Treat BJ-UV55 as unsupported until a bench capture exists.
27. Chirp image detection: a `0x1950` image compares a byte slice to a text model name, which appears never to match under Python 3, and a `0x1808` image never auto-detects. Confirm before relying on Chirp-written files of these sizes.
28. Chirp gates some settings on the model name, so the Tenway UV-82 Pro alias appears to lose the UV-82HP-only settings. Confirm if the CLI ever mirrors Chirp's settings set.
