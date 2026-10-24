# 04 — UV-5R ident history and neighbor protocols

Source: Chirp checkout at `c604141b` (2026-10-17). All findings are functional descriptions. Line references are to that checkout. Issue numbers refer to the Chirp tracker (chirp.danplanet.com/issues/N, later chirpmyradio.com).

Paths are abbreviated:

- `uv5r` = `chirp/drivers/uv5r.py` (before 2015-03-03 it lived at `chirp/uv5r.py`; moved in `1be25748`)
- `bfc` = `chirp/drivers/baofeng_common.py`
- `uv17pro` = `chirp/drivers/baofeng_uv17Pro.py`
- `uv17` = `chirp/drivers/baofeng_uv17.py`

---

## Part A — Ident and firmware handling in uv5r.py

### A.1 Where things stand today

| Item | Current behavior | Where |
|---|---|---|
| Magic list | 8 seven-byte magics, all prefixed `50 BB FF` | `uv5r:341-348` |
| Magic send | One byte at a time, 10 ms gap, 1 s read timeout | `uv5r:382-391` |
| No ACK to magic | Raise the "K1 connector fitment" error | `uv5r:393-395` |
| Ident read | Byte by byte, up to 12 bytes, stop at `DD`. Accept length 8 or 12. Collapse 12 to 8 by keeping offsets 0, 3, 5, 7..11 | `uv5r:397-433` |
| Magic order | Per model `_idents` list, tried in order, 2 s pause after each failure | `uv5r:530-539`, class attrs `uv5r:800-802` |
| Blacklist | After all model magics fail, probe the UV-5X3 and UV-5G magics without the final ACK. If one answers, fail with "Radio identifies as ..." | `uv5r:524-555` |
| First reads | Read `0x1E80` (discarded), `0x1EC0` (firmware string at +0x30, 14 bytes), `0x1FC0` (dropped-byte test). Radios without an aux block read `0x0000` instead | `uv5r:494-521`, `uv5r:561-570` |
| Block read ACK | Radio's ACK for the previous block arrives after the next `S` command. The first read after ident has no leading ACK | `uv5r:445-475` |
| BASETYPE | Used only to match a saved image file to a model class. Never consulted against a live radio | `uv5r:777-788`, `uv5r:884-895` |
| Firmware check on upload | Only the "pre-BFB291 vs later" split is enforced. Aux-area equality decides which aux ranges get written | `uv5r:640-722` |

### A.2 Dated timeline

Each row: commit, date, what changed, why.

#### 2012 — original driver and the BFB291 break

| Commit | Date | Change | Why |
|---|---|---|---|
| `ff77ac40` | 2012-04-04 | Initial driver. One magic (`50 BB FF 01 25 98 4D`, later named `UV5R_MODEL_ORIG`). Read exactly 8 ident bytes. Host ACK, radio ACK. Per-block ACK read right after the host ACK. | Fixes #84 (initial UV-5R support). |
| `41740661` | 2012-10-01 | Parse the 8-byte ident: bytes 1..3 must be ASCII `BFB`, bytes 4..6 an ASCII version. Refuse versions >= 291. | Related to #314. BFB291 firmware had appeared and behaved differently. |
| `0d79ac42` | 2012-10-04 | Add the second magic `50 BB FF 20 12 07 25` (`UV5R_MODEL_291`). Try ORIG then 291, 2 s apart. For 291 radios, accept ident bytes 1..3 of `44 48 04` or `00 04 79` and bytes 4..6 of `30 04 50`. | #314, first BFB291 support. |
| `e322aaf0`, `88ecbc5d`, `3347e625` | 2012-10-06 .. 10-12 | Relax vendor and version checks on the 291 ident step by step. | #314. Rebranded BFB291 radios returned other ident bytes. |
| `d933ac22` | 2012-12-19 | Band-limit layout differs on newer firmware. | Related to #314. |
| `f5820419` | 2012-12-20 | Before upload, read blocks `0x1EC0` and `0x1F00` and take the firmware string from offset 48. Refuse upload unless it equals the image's copy (image offset `0x1838`). | Addresses #344. Jim Unroe found the aux-block version string is non-volatile and reliable. |
| `7a2b5c77` | 2012-12-21 | Upload refused unless the radio string contains `Ver  BFB`. On version mismatch, write the main block, skip the aux block, then report. | Improves #344. Lets users share images across radios. |
| `7911cae7` | 2012-12-23 | Delete all ident-byte parsing. The ident routine now sends known magics until one gets an ACK. | "It was never reliable, and apparently not very identifying anyway." Version now comes from the aux block. Should fix #373. |
| `b374ca27` | 2012-12-24 | Add `_my_version()` which parses the 3 digits after `BFB` in the aux string. | Fixes #370 (tuning steps for firmware >= 291). |

Inference from `0d79ac42` and `517cdf40`: after BFB291 the 8-byte ident carries the band limits in BCD. `44 48 04 30 04 50` reads as 144/148 MHz and 430/450 MHz. The UV-6 sample `AA 36 74 04 00 05 20 DD` reads as 136/174 and 400/520. Byte 3 is the leading digit of the second band. `fedc95d9` (2013-07-03, #767, UV-5RAX) uses byte 3 = `02` to detect a 220 MHz radio and blocks cross-uploads between 220 and UHF radios. That check is still live at `uv5r:616-622`.

#### 2013 — more magics, firmware string in the image

| Commit | Date | Change | Why |
|---|---|---|---|
| `bd1414ee` | 2013-01-28 | Upload guard relaxed from `Ver  BFB` to `BFB`. | #463. BFB297 firmware failed to upload because its string format differs. |
| `359a713c` | 2013-02-15 | Magic list moves onto each class (`_idents`). Add F-11 magic `50 BB FF 13 A1 11 DD`. Add per-class `_basetype` string for image matching. | Fixes #571 (Baofeng F-11, donated radio). |
| `5f8f86d9`, `f02ea952` | 2013-05-04 / 05-05 | Show the two 7-char firmware lines in settings. Show both versions in the mismatch message. | #845. |
| `8d7f824d` | 2013-07-09 | Add UV-82 magic `50 BB FF 20 13 01 05`. | #961. |
| `c84dd6e9` | 2013-08-17 | UV-82 basetype loosened to match `BF8210` and `B82S21`. | #1073. New UV-82 firmware. |
| `025fc812` | 2013-11-10 | Send the magic one byte at a time with 10 ms gaps. Firmware string location made per-class (image `0x1838..0x1848` for UV-5R). Add BJ-UV55 magic `50 BB DD 55 63 98 4D`. | #1201 (Baojie BJ-UV55). BJ-UV55 later moved to its own file in `661341e0`/`7fc56c86`/`3313e5ca` (#1335). |

#### 2014 — BASETYPE lists, more firmware families

| Commit | Date | Change | Why |
|---|---|---|---|
| `8ad482b1` | 2014-03-02 | Rename magics to `UV5R_MODEL_*`. Reorder UV-5R list to try 291 first, ORIG second. | #1471. "so the newer radios will be detected sooner". |
| `7d5b467f` | 2014-03-02 | `_basetype` becomes a list per model. Add `BASETYPE_LIST` (union). Upload refused if the radio string matches none of `BASETYPE_LIST`. | #1471. Starting lists: UV5R `BFS`,`BFB`; F11 `USA`; UV82 `B82S`,`BF82`; BJ55; UV6 `BF1`. |
| `93b062c3` | 2014-03-08 | Add UV-6 magic `50 BB FF 20 12 08 23`. | #923. |
| `d7aa725e` | 2014-03-25 | Add Intek KT-980HP. Reuses the 291 magic. Basetype `BFP3`. | #1517. |
| `27eeda64` | 2014-05-22 | UV-82 basetype adds `US2S`. | #1651. New UV-82C firmware. |
| `5811c62a` | 2014-07-14 | Add BF-F8HP. Reuses 291 magic. Split basetypes: KT-980HP `BFP3V3 B`, F8HP `BFP3V3 F`. | #1765. Nearly identical radios told apart by firmware string only. |
| `632f6121` | 2014-07-16 | Read a "special block" at `0x0CF0` and refuse upload on mismatch. | #1773. Removed in `7c41964c` (2016-02-21, #3371) once exact firmware match was enforced. |
| `c9a96e16` | 2014-07-22 | Firmware string in the image shortened from 16 to 14 bytes (`0x1838..0x1846`). | #1751. Bytes past the string caused false mismatches. |
| `562f1e7a` | 2014-08-16 | Add basetypes `N5R-2` (2 power levels) and `N5R-3` (3 power levels, F8HP and KT-980HP). | #1849. New Baofeng firmware. |
| `4ebc39f4` | 2014-08-17 | **BASETYPE becomes fatal on download.** Read the aux firmware string before the main block. If none of the selected model's basetypes appear, fail with "Incorrect 'Model' selected." | Bug #1851. Users picked the wrong model and got a mis-parsed image. |
| `6e3631e6` | 2014-09-04 | Add second UV-6 magic `50 BB FF 12 03 98 4D`. | #1707. A UV-6 batch with a different ident. |
| `908b6169` | 2014-11-17 | Basetype `BTS`. | #2057. Etekcity-branded UV-5R with `BTS311`/`BFB297`. |
| `c4b8e652` | 2014-11-24 | Basetype `N5R3`. | #2071. BF-F8HP with `N5R3401`. |

#### 2015 — exact-match uploads, ACK timing fix

| Commit | Date | Change | Why |
|---|---|---|---|
| `95c7f10e` | 2015-03-14 | Block-read ACK moved. The radio's ACK for block N is read after the host sends the `S` request for block N+1. A flag marks the first read after ident, which has no leading ACK. Add 5 ms after the host ACK and 50 ms after each upload block. | Fixes #2317, "radio refused to send block code 0x1ec0". Patch by Mathieu Rozon, revised by Jim Unroe. |
| `5439d095` | 2015-04-09 | Post-ACK delay raised from 5 ms to 50 ms. | #2317. |
| `6537ba8c` | 2015-04-10 | Drop the remaining ident validators. Drop the "unsupported firmware" upload guard. Upload now requires the image firmware string to equal the radio's. `_my_version()` only distinguishes BFB < 291. | #2517. |
| `ef6d8829` | 2015-04-10 | Basetypes `N5R2`, `N5RV`. | #2475. Strings `N5R2401BFB297` and `HN5RV011FB297`. |
| `b490a9d3` | 2015-04-30 | Basetype `F5R3`. | #2551. BF-F8HP `F5R3407`. |
| `71879a4f` | 2015-06-06 | Add BF-A58 magic `50 BB FF 20 14 04 13`. Basetype `BFT`. | #2261. |
| `1e8ff086` | 2015-06-08 | Basetypes `D5R2` (UV-5R), `N82-2`, `N822` (UV-82). | #2629. |
| `545187e3` | 2015-06-15 | Add UV-82HP. Reuses UV-82 magic. Basetypes `N82-3`, `N823`. Moves `BFT` to F8HP. | #2643. |
| `0d9aa1a9`, `1893d46c` | 2015-06-16 / 08-08 | A58 magic moved to the BF-F8HP class (A58 has 3 power levels). | #2261. |

#### 2016 — 12-byte ident

| Commit | Date | Change | Why |
|---|---|---|---|
| `517cdf40` | 2016-08-12 | **12-byte ident added.** Read the ident one byte at a time until `DD`. Drop every `01` byte to get back to 8. Basetype `UV6`. | Related to bug #3063. Current UV-6 sends `AA 01 01 36 01 74 01 04 00 05 20 DD`; old UV-6 sends `AA 36 74 04 00 05 20 DD`. The image format prepends exactly 8 ident bytes, so all settings offsets assume 8. |
| `05cdeace` | 2016-09-20 | Replace "drop all `01`" with "keep offsets 0, 3, 5, 7..11". Accept 8 or 12 bytes. Drop the "must start with `AA`" check. | Bug #3987. UV-82HP's ident changes with the user's band-limit setting. A limit of 1 or x01 put a real `01` in the ident, which got stripped. |
| `dc8ff4e4` | 2016-09-23 | Fix-up of the above. | #3987. |

#### 2017–2021 — wrong-model handling

| Commit | Date | Change | Why |
|---|---|---|---|
| `0749317a` | 2017-02-16 | **IDENT_BLACKLIST.** After all model magics fail, send the BTECH UV-5X3 magic `50 0D 0C 20 16 03 28` without the final ACK. If the radio answers, fail with "Radio identifies as BTECH UV-5X3. Please choose the proper vendor/model". | #4539. UV-5X3 buyers picked "UV-5X", got a timeout, and returned working radios as broken. |
| `10e9025c` | 2017-04-02 | **BASETYPE stops being fatal for some radios.** Download: if the firmware string contains `HN5RV`, or is 14 x `FF`, trust the user's model and append the 8-char model name to the image (image length `0x1950`). Other strings still fail on basetype mismatch. Upload: exact match writes everything; basetype match writes main block plus a short aux range and then reports; otherwise refuse. | #4445 "and many others". `HN5RV001` ships in both 2-power and 3-power radios, so the string no longer tells the model. Some radios report no version at all. |
| `dfb572b6` | 2019-01-19 | Basetype `B5R2`. | #6379. |
| `43afc670` | 2019-01-26 | `N5R2` added to UV-82HP basetypes. | #6403. GT-5TP reports a UV-5R style string. |
| `b54c29cd`, `ef7440cb` | 2019-07-17 / 11-08 | Add Radioddity UV-82X3. Basetype `HN5RV01`. | #6921, #7217. |
| `554fe498`, `42cf4117` | 2019-11-17 / 12-03 | "No version" test relaxed from 14 x `FF` to 7 x `FF`. | #7295. New UV-82HP firmware variation. |
| `a1c946ac` | 2020-07-09 | `N5RV` added to F8HP basetypes. | #6725 (UV-5XP). |
| `f33581fe` | 2020-08-31 | `_aux_block = False` for UV-6. No aux reads. | Fixes #6567. |
| `d2fcafea` | 2020-11-26 | Firmware string of 14 spaces also trusted. | Fixes #8473. |
| `21274de9` | 2020-10-21 | DTMF character table differs on `HN5RV01`. | Fixes #8321. |
| `becd1f5f`, `2b0daa1f` | 2021-05-19 | Add GT-5R. It never auto-matches image files. | #9077. |
| `a7fcb5b3` | 2021-07-23 | Add Radioddity UV-5G magic `50 BB FF 20 12 06 25`, both as a model and in the blacklist. | #9187, #9093. |

#### 2023 — new radios return different aux data

| Commit | Date | Change | Why |
|---|---|---|---|
| `aad8664c` | 2023-03-26 | Block read honors the requested size. | Prerequisite for 0x10-byte reads. |
| `e8b3f0b0` (`bfc`) | 2023-06-13 | In the shared Baofeng code, read `0x1E80` then `0x1EC0` and take the version from the second block. | Related to #10505. "New radios" return a different firmware string when the version block is read alone. Reading one or more consecutive blocks first returns the same string as a full download. |
| `885590d6` | 2023-06-18 | **0x1E80-first ordering added to uv5r.py.** Version read becomes `0x1E80` (discarded) then `0x1EC0`. Skip aux upload when the string contains `HN5RV`. Hide most "Other Settings" for `HN5RV`. | Related to #10505. Same root cause as `e8b3f0b0`. |
| `249a7a3d` | 2023-07-12 | Show the hidden HN5RV settings again with a warning that they will not upload. | #10721, #10505. Hidden settings generated bug reports. |
| `7aeeffc8` | 2023-07-13 | **BASETYPE stops being fatal on upload.** Remove the "firmware does not match, upload stopped" path. Read `0x0F40` and skip the aux block if the broadcast-FM area holds `FF`. | #10505. |
| `6605759e` (`bfc`) | 2023-10-04 | Shared code: full aux read and dropped-byte detection. | Fixes #10505. |
| `2e76c84c` | 2023-10-25 | **BASETYPE removed from live-radio logic.** Download no longer checks basetype and no longer appends the model name. Add the explanatory comment for the `0x1E80` read. Add dropped-byte detection: if byte `0x1FCF` reads as `FF`, download `0x1FC0..0x2000` in 0x10-byte blocks. Upload compares three aux areas between image and radio to choose aux ranges. Upload still refuses a pre-BFB291 image on a later radio and vice versa. | #10505. Some new radios drop the byte at `0x1FCF` in 0x40-byte reads, shift the next 0x30 bytes, and pad `0x1FFF` with `80`. |
| `e33a3e1f` | 2024-02-04 | Settings parse split so a bad aux block does not block other settings. | #10505. "common problem with radios with damaged aux blocks". |

#### 2024–2026

| Commit | Date | Change | Why |
|---|---|---|---|
| `b231fa0b` | 2024-06-22 | Radios without an aux block read `0x0000` as the first block. | Fixes #11199 (UV-6 broken by the 2023 changes). |
| `d8bb14bb` | 2024-12-15 | No ACK to any magic raises the rich "K1 connection" error. | #11738. K1 plug fitment is the usual cause. |
| `228dbc5b` | 2025-07-26 | Add UV-5G Pro. Classic protocol, default UV-5R magics. Never auto-matches image files. | Fixes #12075. |

### A.3 Firmware-string mentions requested

| String | Commit(s) | Role |
|---|---|---|
| BFB291 | `41740661`, `0d79ac42`, `88ecbc5d`, `b374ca27`, `2e76c84c` | First "new firmware". Ident format changed. Still the split for "original" radios (`uv5r:1173-1184`, `uv5r:645-651`). |
| BFB297 | `bd1414ee` (#463), `908b6169`, `ef6d8829` | String format broke the `Ver  BFB` guard. Appears inside `N5R2401BFB297` and `HN5RV011FB297`. |
| N5R-3 | `562f1e7a` (#1849) | 3-power-level family (F8HP, KT-980HP). |
| BFP3 / BFP3V3 | `d7aa725e` (#1517), `5811c62a` (#1765) | KT-980HP (`BFP3V3 B`) vs BF-F8HP (`BFP3V3 F`). The string `BFP3-25` does not appear anywhere in the history. |
| HN5RV / HN5RV01 / HN5RV001 | `ef6d8829`, `10e9025c`, `ef7440cb`, `21274de9`, `885590d6`, `249a7a3d` | Shared by 2- and 3-power radios. Ends model detection by string. Later linked to the aux-block problems. |
| "new firmware" | `562f1e7a`, `1e8ff086`, `554fe498`, `42cf4117`, `c84dd6e9`, `27eeda64` | Each adds a basetype for a new string. |

### A.4 Takeaways for the implementer

- The 8-byte ident reflects user band limits on post-291 radios. Use it for framing (`AA` .. `DD`) and the 220 MHz flag. Do not use it for model identity.
- The magic does not identify a model either. The 291 magic is shared by UV-5R, BF-F8HP, KT-980HP and the `bfc` UV-S9X3 / 5RX. The A58 magic is shared with the WP970I.
- Read one block outside `0x1EC0..0x1FFF` before reading the firmware string. Chirp uses `0x1E80`.
- Read the firmware string at radio `0x1EF0` (14 bytes). Expect `HN5RV...`, all `FF`, or all spaces on many current radios.
- Test byte `0x1FCF` for the dropped-byte condition before reading `0x1FC0..0x1FFF` in 0x40 blocks.

---

## Part B — Neighbor protocols

### B.1 Which driver a "UV-5R" label maps to

From the registered classes and `chirp/share/model_alias_map.yaml`.

| Protocol family | Driver | Names a buyer may see |
|---|---|---|
| Classic UV-5R, 9600 | `uv5r` | UV-5R, UV-5X (2014), UV-5R EX (Radioddity), UV-5RX3, UV-5G (Radioddity, GMRS), UV-5G Pro, GT-5R, BF-F8HP and its aliases (Tenway UV-5R Pro, UV-5XP, TD-UV5R TriPower, RT5 tri-power, GA-5S, TI-F8+, TS-T9+), RT5R, RT5RV, RH5R, A-5R. Alias map adds UV-5R+, UV-5R MK4/MK5, UV-5R HTQ, UV-5R7W/8W, UV-5RTP, UV-5RHP, UV-5RM HP (all to BF-F8HP); UV-5RA/AX, UV-5RB..RU, UV-5R V2+, UV-5R2, UV-5R++, UV-5S (to UV-5R); UV-5RA3, UV-5RIII (to UV-5RX3). |
| Baofeng-common, 9600 | `bfc` + `uv5x3.py`, `uv6r.py`, `baofeng_wp970i.py` | BTECH UV-5X3, MTC UV-5R-3, UV-6R, WP970I, BF-A58, UV-82WP (alias UV-5RWP), BF-A58S, UV-S9X3, 5RX |
| UV17Pro, 115200, XOR-obfuscated | `uv17pro` | UV-17Pro (UV-17R), UV-17ProGPS, UV-21ProV2, UV-21ProGPS, UV-25 (BF-18H/18L), UV-28Plus, UV-32, GM-21, Radioddity GM-30 Plus / Pro, **5RM** (AR-5RM, UV-5RH Pro Max), MaxTalker P15 / MT-5RM, **K5-Plus**, **UV-5RM Plus**, GM-5RH, **Radioddity UV-5G Plus**, UV-17R-Plus (UV-17M), BF-F8HP-PRO, **UV-5RH** (BF-5RH), K6, **UV-5R Mini**, **UV-5G Mini** |
| UV17 "blue screen", 57600 | `uv17` | UV-17, UV-13Pro (P15UV), Radioddity GA-510 V2 (`ga510.py:1155`) |
| Quansheng UV-K5, 38400 | `chirp/drivers/uvk5.py` | Quansheng-branded **UV-5R Plus** maps to UV-K5 in the alias map. |

The names "UV-5R Pro 2nd gen" and "UV-5R EX Gen3" do not appear in the Chirp tree. "UV-5R Plus" is ambiguous: Baofeng UV-5R+ is classic; Quansheng UV-5R Plus is a UV-K5.

### B.2 UV17Pro family (`baofeng_uv17Pro.py`)

Magics (`uv17pro:33-40`), all 16-byte ASCII:

| Constant | Bytes | Used by |
|---|---|---|
| `MSTRING_UV17L` | `PROGRAMBFNORMALU` | UV-17Pro base and every subclass without an override: UV-21ProV2, UV-25, 5RM, P15, MT-5RM, K5-Plus, UV-5RM Plus, UV-17R-Plus, UV-5RH |
| `MSTRING_UV17PROGPS` | `PROGRAMCOLORPROU` | UV-17ProGPS and its subclasses (GM-21, GM-30 Plus/Pro, UV-32, UV-21ProGPS, UV-28Plus), UV-5R Mini, UV-5G Mini fw 0.01 |
| `MSTRING_GM5RH` | `PROGRAMBFGMRS05U` | GM-5RH, Radioddity UV-5G Plus |
| `MSTRING_BFF8HPPRO` | `PROGRAMBF5RTECHU` | BF-F8HP-PRO |
| `MSTRING_BFK6` | `PROGRAMBF-K6PROU` | K6 |
| (inline) | `PROGRAMGMRS5RMIU` | UV-5G Mini fw 0.05 (`uv17pro:2729-2732`) |

Handshake summary (`uv17pro:106-138`, `uv17pro:141-218`, `uv17pro:489-502`):

1. 115200 baud (`uv17pro:232`). The classic family uses 9600.
2. Drain the input buffer. Send the 16-byte magic in one write.
3. Expect one byte `06`. No `02` request, no `AA..DD` ident, no second ACK exchange.
4. Send `46` ("F"), read 16 bytes. Send `4D` ("M"), read 15 bytes (UV-17ProGPS 7, BF-F8HP-PRO 6). Send `SEND!` (`53 45 4E 44 21`) followed by a 20-byte model-specific tail, read 1 byte. K6 sends only `46`. Chirp discards these replies.
5. Multiple magics per model are tried in order since `cc90db32` (2025-12-29, #12277). Any reply that is not `06` counts as "unexpected response". No reply at all raises "no response".
6. Read request: `52` ("R"), 2-byte big-endian address, 1-byte length (0x40). Reply: 4-byte header plus 0x40 data. The host sends no per-block ACK.
7. Memory is segmented: `0x0000` (0x8040), `0x9000` (0x40), `0xA000` (0x2C0), `0xD000` (0x40) for the base model. BF-F8HP-PRO, K6 and UV-5R Mini use different segment lists.
8. Write: `57` ("W"), address, length, 0x40 data. Expect `06`.
9. Payload is XOR-obfuscated with a 4-byte key from a 20-entry table (`uv17pro:81-103`). Bytes equal to `00`, `FF`, the key byte, or its complement pass through unchanged. Positions where the key byte is a space also pass through. Key index 1 (`CO 7`) is the default, 3 for BF-F8HP-PRO, 13 for UV-5RM Plus. K6 has no obfuscation.
10. UV-5R Mini over BLE writes in 0x80 blocks (`uv17pro:2589-2650`).

Image files carry the model name appended after `MEM_TOTAL` (`uv17pro:76-78`).

### B.3 UV17 "blue screen" family (`baofeng_uv17.py`)

Models: UV-17, UV-13Pro, Radioddity GA-510 V2.

1. 57600 baud (`uv17:165`).
2. Send `PSEARCH`. Expect 8 bytes `06 55 56 31 35 39 39 39` (`06` + `UV15999`). GA-510 V2 expects `06` + `DMR1702` (`ga510.py:1181`).
3. Then `PASSSTA` (3 bytes back), `SYSINFO` (1), three `56` ("V") queries of form `56 00 xx 0A 0D` (13 bytes each), each followed by `06` (1).
4. Memory size query `56 00 00 00 0A` returns 11 bytes. Bytes 7..10 are a little-endian size. UV-17 expects `0xFFFF`, UV-13Pro `0x31FFF`. A mismatch fails with "Incorrect radio model" (`uv17:34-52`, added `9e4a9324`, #11167).
5. Then `FF FF FF FF 0C` + `UV15999` (1 byte back), `02` (8 bytes back), `06` (1).
6. Frame: command byte, 3-byte little-endian address, 1-byte length (`uv17:329-336`).
7. Block map: read 1 byte at each `0x1FFF + n*0x1000`. The reply's byte 5 is a BCD logical block number. Logical blocks live at shuffled 4 KiB pages.
8. Data read: 0x40 bytes, reply header 5 bytes, host sends `06` after each block.
9. No payload obfuscation.
10. Upload writes blocks in a fixed logical order and repairs a missing map entry by reusing block 165.

### B.4 Baofeng-common family and UV-5X3 (`baofeng_common.py`, `uv5x3.py`)

UV-5X3 is the classic protocol with these differences:

- Magic `50 0D 0C 20 16 03 28` (UV-5X3), `50 0D 0C 20 17 09 19` (MTC UV-5R-3) (`uv5x3.py:33-36`). The `50` lead byte matches; bytes 2..3 differ from `BB FF`.
- Ident reply is 14 bytes, framed `AA` .. `DD` (`uv5x3.py:107`, `bfc:201-246`). The classic driver accepts only 8 or 12.
- Image identity is a 7-byte string at radio `0x1EF0`: `UVVG302`, `UVVG301`, `UVVG306` (UV-5X3) or `5R31709` (UV-5R-3) (`uv5x3.py:40-47`, `uv5x3.py:80-91`).
- Memory is read as one contiguous `0x0000..0x2000` range. The ident is appended to the image end. Image file length is `0x200E` (`uv5x3.py:124-125`).
- Upload writes 0x10-byte blocks over an explicit range list (`uv5x3.py:113-121`).
- Same ACK pattern, same `0x1E80`-first version read, same dropped-byte handling as current uv5r.py (`bfc:117-189`, `bfc:264-337`).
- Baud fixed at 9600 (`bfc:204`).

UV-6R (`uv6r.py`) uses the same code with magic `50 BB FF 20 14 11 22`, an 8-byte ident, version at `0x1FF0`, and no per-block ACK (`uv6r.py:33`, `uv6r.py:97-104`).

WP970I family (`baofeng_wp970i.py:33-39`): WP970I magic equals the uv5r A58 magic. UV-S9X3 and 5RX use the uv5r 291 magic. UV-9G uses `50 BB FF 20 12 05 25`.

### B.5 Quansheng UV-K5 (`uvk5.py`)

Relevant because Quansheng sells a "UV-5R Plus".

- 38400 baud (`uvk5.py:596`).
- Every frame: `AB CD`, payload length, `00`, payload plus CRC16 XOR-ed with a 16-byte table, then `DC BA` (`uvk5.py:358-427`).
- Hello payload `14 05 04 00 6A 39 57 64`. Reply carries a firmware string from offset 4 (`uvk5.py:435-458`).

### B.6 Recognizing a non-classic radio on the wire

Chirp has two precedents.

- `uv5r` IDENT_BLACKLIST (`uv5r:524-555`): probe neighbor magics on the same 9600 link and name the radio. It covers neighbors that speak the 9600 magic/ACK protocol.
- `ga510.py:373-399` `detect_from_serial`: loop over candidate classes, set each class's baud, run its ident, and separate "no response" from "unexpected response". It already mixes a 9600 classic-style radio with a 57600 UV17 radio.

Signals available to a CLI, in probe order:

| Step | Baud | Send | Classic UV-5R | Other family |
|---|---|---|---|---|
| 1 | 9600 | 7-byte classic magic, byte-paced | `06` within 1 s | UV17 and UV17Pro radios: no evidence in Chirp of any reply at 9600 |
| 2 | 9600 | `02` after `06` | 8 or 12 bytes, `AA` .. `DD` | UV-5X3 / UV-5R-3: 14 bytes `AA` .. `DD` |
| 3 | 9600 | UV-5X3 / UV-5G magics (blacklist) | no `06` | `06` names a UV-5X3 or UV-5G |
| 4 | 115200 | each 16-byte `PROGRAM...U` magic | — | `06` means a UV17Pro-family radio. The magic that answered narrows the model group (table B.2) |
| 5 | 57600 | `PSEARCH` | — | `06 UV15999` means UV-17 / UV-13Pro. `06 DMR1702` means GA-510 V2 |
| 6 | 38400 | UV-K5 hello frame | — | Reply starting `AB CD` means a Quansheng UV-K5 family radio |

Suggested message mapping:

- No byte at step 1 and no reply at steps 4 to 6: report a cable or K1 fitment problem. This matches Chirp's `RadioNoContactLikelyK1`.
- Any reply at step 4, 5 or 6: report the detected family and that this CLI speaks only the classic UV-5R protocol.
- `06` at step 1 but a 14-byte ident: report a UV-5X3-type radio.
- `06` at step 1 but an ident of any other length: report an unknown UV-5R variant with the hex bytes.

---

## Open questions

1. Does a UV17Pro-family radio emit anything at 9600 when sent the classic magic? Chirp has no capture of that case. A bench test would decide whether step 1 alone can name the family or only time out.
2. After a successful step 4 or 5 probe the radio sits in program mode. Chirp shows no exit command. Find out whether the CLI should tell the user to power-cycle before the next probe.
3. Does sending a UV17Pro magic at 115200 to a classic UV-5R cause any side effect? Chirp only ever sends it to UV17Pro radios.
4. The 16-byte `46` reply and the `4D` reply likely hold model and firmware text. Chirp discards them. A capture would show whether they can name the exact model.
5. "UV-5R Pro 2nd gen" and "UV-5R EX Gen3" have no Chirp entry. Their protocol is unknown from this source.
6. Issue #10505 is the root report for the `0x1E80` read and the dropped byte. Its thread may list which hardware batches show each symptom. The commit messages do not.
7. The BCD band-limit reading of the post-291 ident is inferred from two samples (`0d79ac42`, `517cdf40`). Confirm on the bench by changing band limits and reading the ident again.
8. `IDENT_BLACKLIST` probes run without the final ACK. Chirp does not say what state the radio is left in after such a probe.
