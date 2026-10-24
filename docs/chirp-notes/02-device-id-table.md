# 02 — UV-5R family device ID table

Source: Chirp checkout at commit `c604141ba51c41ef3d768b1d58beba4239a82e0a`.
Paths are relative to the repo root. `uv5r.py` means `chirp/drivers/uv5r.py`.
Every fact carries a `file:LINE` citation. Hex values are listed byte by byte.

Terms used below:

- **Magic**: the 7-byte string the PC sends to open a clone session.
- **Ident**: the 8-byte reply the radio sends after the magic is acknowledged. It becomes bytes 0x0000–0x0007 of the saved image.
- **Version string**: 14 bytes that the radio stores at radio address 0x1EF0. Chirp calls this the firmware version.
- **Basetype**: a short byte string that Chirp searches for inside the version string of a saved image.
- **Orig**: Chirp's term for a radio whose version string contains `BFB` followed by a 3-digit number below 291.

---

## 1. Magic constants

### 1.1 Magics defined in uv5r.py

All eight share the prefix `50 BB FF`.

| Constant | Bytes | Defined at |
|---|---|---|
| `UV5R_MODEL_ORIG` | `50 BB FF 01 25 98 4D` | uv5r.py:341 |
| `UV5R_MODEL_291` | `50 BB FF 20 12 07 25` | uv5r.py:342 |
| `UV5R_MODEL_F11` | `50 BB FF 13 A1 11 DD` | uv5r.py:343 |
| `UV5R_MODEL_UV82` | `50 BB FF 20 13 01 05` | uv5r.py:344 |
| `UV5R_MODEL_UV6` | `50 BB FF 20 12 08 23` | uv5r.py:345 |
| `UV5R_MODEL_UV6_ORIG` | `50 BB FF 12 03 98 4D` | uv5r.py:346 |
| `UV5R_MODEL_A58` | `50 BB FF 20 14 04 13` | uv5r.py:347 |
| `UV5R_MODEL_UV5G` | `50 BB FF 20 12 06 25` | uv5r.py:348 |

Bytes 3–6 of most of these read as BCD dates: `20 12 07 25`, `20 13 01 05`, `20 12 08 23`, `20 14 04 13`, `20 12 06 25`. This is an observation about the values only. Chirp attaches no meaning to them.

### 1.2 Magic defined in a subclass file

| Constant | Bytes | Defined at |
|---|---|---|
| `BJUV55_MODEL` | `50 BB DD 55 63 98 4D` | chirp/drivers/bjuv55.py:32 |

### 1.3 Blacklist magics

`IDENT_BLACKLIST` maps a magic to a reason string (uv5r.py:524-527). Chirp sends these only after every magic in the class's `_idents` has failed.

| Bytes | Reason string | Line |
|---|---|---|
| `50 0D 0C 20 16 03 28` | `Radio identifies as BTECH UV-5X3` | uv5r.py:525 |
| `50 BB FF 20 12 06 25` | `Radio identifies as Radioddity UV-5G` | uv5r.py:526 |

The second entry has the same bytes as `UV5R_MODEL_UV5G`.

### 1.4 Magic use per class, in try order

Each class tries its `_idents` list from left to right (uv5r.py:531). After a failed attempt Chirp waits 2 s before trying the next magic (uv5r.py:539).

| Class (MODEL) | `_idents`, first to last | Citation |
|---|---|---|
| BaofengUV5R (base, not registered) | 291, ORIG | uv5r.py:800-802 |
| BaofengUV5RGeneric (UV-5R) | 291, ORIG (inherited) | uv5r.py:2208 |
| BaofengUV5GPro (UV-5G Pro) | 291, ORIG (inherited) | uv5r.py:2214 |
| BaofengF11Radio (F-11) | F11 | uv5r.py:2258 |
| BaofengUV82Radio (UV-82) | UV82 | uv5r.py:2269 |
| Radioddity82X3Radio (UV-82X3) | UV82 (inherited from UV-82) | uv5r.py:2280 |
| BaofengUV6Radio (UV-6) | UV6, UV6_ORIG | uv5r.py:2300-2302 |
| IntekKT980Radio (KT-980HP) | 291 | uv5r.py:2332 |
| BaofengBFF8HPRadio (BF-F8HP) | 291, A58 | uv5r.py:2384-2386 |
| BaofengUV82HPRadio (UV-82HP) | UV82 | uv5r.py:2412 |
| RadioddityUV5RX3Radio (UV-5RX3) | 291, ORIG (inherited) | uv5r.py:2430 |
| RadioddityGT5RRadio (GT-5R) | 291, ORIG (inherited) | uv5r.py:2447 |
| RadioddityUV5GRadio (UV-5G) | UV5G | uv5r.py:2482 |
| BaojieBJUV55Radio (BJ-UV55) | BJUV55_MODEL | bjuv55.py:238 |

Reverse view, magic to the classes that send it:

| Magic | Classes |
|---|---|
| 291 | UV-5R, UV-5G Pro, UV-5RX3, GT-5R (first choice), KT-980HP (only choice), BF-F8HP (first choice) |
| ORIG | UV-5R, UV-5G Pro, UV-5RX3, GT-5R (second choice) |
| A58 | BF-F8HP (second choice) |
| UV82 | UV-82, UV-82X3, UV-82HP |
| F11 | F-11 |
| UV6 | UV-6 (first choice) |
| UV6_ORIG | UV-6 (second choice) |
| UV5G | UV-5G; also the blacklist probe for every other class |
| BJUV55_MODEL | BJ-UV55 |

### 1.5 The same bytes in drivers outside the uv5r class tree

These drivers do not import uv5r. They define their own constants with matching or neighbouring bytes. They matter to a new implementation because a radio that answers one of these magics may belong to a different driver.

| Driver constant | Bytes | Same bytes as | Citation |
|---|---|---|---|
| `MSTRING_WP970I` | `50 BB FF 20 14 04 13` | `UV5R_MODEL_A58` | chirp/drivers/baofeng_wp970i.py:33 |
| `MSTRING_UV9G` | `50 BB FF 20 12 05 25` | none | baofeng_wp970i.py:36 |
| `MSTRING_UVS9X3` | `50 BB FF 20 12 07 25` | `UV5R_MODEL_291` | baofeng_wp970i.py:39 |
| `MSTRING_UV6R` | `50 BB FF 20 14 11 22` | none | chirp/drivers/uv6r.py:33 |
| `MSTRING_UV5X3` | `50 0D 0C 20 16 03 28` | blacklist entry 1 | chirp/drivers/uv5x3.py:33 |
| `MSTRING_UV5R3` | `50 0D 0C 20 17 09 19` | none | uv5x3.py:36 |
| tdh8 `IDENT_BLACKLIST` entry | `50 56 4F 4A 48 1C 14` ("TIDRADIO TD-H8") | none | chirp/drivers/tdh8.py:911-913 |

Those drivers identify file images by their own fingerprint lists: UV-6R `" BF230#1"`, `" BF230#2"` (uv6r.py:38-39); UV-5X3 `UVVG302`, `UVVG301`, `UVVG306` (uv5x3.py:41-43); UV-5R-3 `5R31709` (uv5x3.py:46); BF-A58 `"BFT515 "`, `"BFT517 "` (baofeng_wp970i.py:931). The UV-5X3 driver expects a 14-byte magic response (uv5x3.py:107). The WP970I and UV-6R drivers expect 8 bytes (baofeng_wp970i.py:94, uv6r.py:100).

---

## 2. Radio classes

### 2.1 Defaults on the base class `BaofengUV5R` (uv5r.py:791-821)

| Attribute | Value | Line |
|---|---|---|
| VENDOR / MODEL | `Baofeng` / `UV-5R` | 794-795 |
| BAUD_RATE | 9600 | 796 |
| `_memsize` | 0x1808 | 798 |
| `_basetype` | `BASETYPE_UV5R` | 799 |
| `_idents` | [291, ORIG] | 800-802 |
| `_vhf_range` | 130.000–176.000 MHz | 803 |
| `_220_range` | 220.000–260.000 MHz | 804 |
| `_uhf_range` | 400.000–520.000 MHz | 805 |
| `_aux_block` | True | 806 |
| `_tri_power` | False | 807 |
| `_bw_shift` | False (no reader in the file) | 808 |
| `_mem_params` | 0x1828, the image offset of `poweron_msg` | 809-810, 210-214 |
| `_fw_ver_file_start` / `_stop` | 0x1838 / 0x1846 (14 bytes) | 812-813 |
| `_ranges_main` | image 0x0008–0x1808 | 815-817 |
| `_ranges_aux` | radio 0x1EC0–0x2000 | 818-820 |
| `_valid_chars` | `UV5R_CHARSET`: A–Z, space, 0–9, and `!@#$%^&*()+-=[]:";'<>?,./` | 821, 773-774, chirp/chirp_common.py:112 |
| memory bounds | 0–127 | 880 |
| power levels | High 4.0 W, Low 1.0 W | 865, 764-765 |
| tri-power levels | High 8.0 W, Med 4.0 W, Low 1.0 W | 767-769 |
| name length | 7 | 859 |

The base class has no `@directory.register` (uv5r.py:791). `BaofengUV5RGeneric` is the registered UV-5R (uv5r.py:2207-2210).

`_ranges_main` and `_ranges_aux` are upload ranges. Chirp uses them only when the user enables the range override (section 4.5).

### 2.2 Registered classes

Values marked "inh." come from the base class.

| Class @ line | VENDOR / MODEL | `_basetype` | `_idents` | VHF / UHF (MHz) | `_tri_power` | `_aux_block` | `_is_orig` | `match_model` |
|---|---|---|---|---|---|---|---|---|
| BaofengUV5RGeneric @2208 | Baofeng / UV-5R | UV5R inh. | 291, ORIG | 130–176 / 400–520 | False | True | parses BFB | inh. |
| BaofengUV5GPro @2214 | Baofeng / UV-5G Pro | UV5R inh. | 291, ORIG | see 2.3 | False | True | parses BFB | always False (2227-2229) |
| BaofengF11Radio @2254 | Baofeng / F-11 | F11 (2257) | F11 | 130–176 / 400–520 | False | True | always False (2260-2262) | inh. |
| BaofengUV82Radio @2266 | Baofeng / UV-82 | UV82 (2268) | UV82 | 130–176 / 400–521 (2270-2271) | False | True | always False (2274-2276) | inh. |
| Radioddity82X3Radio @2280 | Radioddity / UV-82X3 | UV82X3 (2283) | UV82 | 130–176, 200–260, 400–521 (2287-2289) | False | True | always False (from UV-82) | inh. |
| BaofengUV6Radio @2294 | Baofeng / UV-6 | UV6 (2299) | UV6, UV6_ORIG | 130–176 / 400–520 | False | **False** (2303) | always False (2322-2324) | inh. |
| IntekKT980Radio @2328 | Intek / KT-980HP | KT980HP (2331) | 291 | 130–180 / 400–521 (2333-2334) | **True** (2335) | True | always False (2342-2344) | inh. |
| BaofengBFF8HPRadio @2378 | Baofeng / BF-F8HP | F8HP (2383) | 291, A58 | 130–180 / 400–521 (2387-2388) | **True** (2389) | True | always False (2396-2398) | inh. |
| BaofengUV82HPRadio @2407 | Baofeng / UV-82HP | UV82HP (2411) | UV82 | 136–175 / 400–521 (2413-2414) | **True** (2417) | True | always False (2424-2426) | inh. |
| RadioddityUV5RX3Radio @2430 | Radioddity / UV-5RX3 | UV5R inh. | 291, ORIG | 130–176, 200–260, 400–520 (2436-2438) | False | True | parses BFB | always False (2441-2443) |
| RadioddityGT5RRadio @2447 | Baofeng / GT-5R | UV5R inh. | 291, ORIG | 130–176 / 400–520 | False | True | parses BFB | always False (2471-2473) |
| RadioddityUV5GRadio @2477 | Radioddity / UV-5G | UV5R (2481) | UV5G | 130–176 / 400–520 | False | True | parses BFB | always False (2484-2486) |
| BaojieBJUV55Radio, bjuv55.py:234 | Baojie / BJ-UV55 | `[b"BJ55"]` (bjuv55.py:237) | BJUV55_MODEL | 130–176 / 400–520 | False | True | parses BFB from 0x1938 | inh. |

`BASETYPE_BJ55` exists in uv5r.py:282. bjuv55.py repeats the literal list and does not reference the constant (bjuv55.py:237).

### 2.3 Other per-class attributes and overrides

| Class | Attribute or override | Effect | Citation |
|---|---|---|---|
| All non-orig with band byte 0x02 | `get_features` | bands become VHF + 220 only, with no UHF | uv5r.py:871-879 |
| All, before an image is loaded | `get_features` | bands VHF + 220 + UHF | uv5r.py:874-875 |
| UV-82 | `_valid_chars` | printable ASCII (0x20–0x7E) | uv5r.py:2272, chirp_common.py:115 |
| UV-82HP | `_valid_chars` | upper and lower letters, digits, space, plus the UV5R symbol set | uv5r.py:2415-2416, chirp_common.py:113 |
| UV-6 | memory bounds | 1–128; channel N uses slot N-1 | uv5r.py:2305-2320 |
| UV-5G Pro | `_airband` | 108–136 MHz forces AM mode | uv5r.py:2216, 2231-2238 |
| UV-5G Pro | bands | 108–174, 220–260, 350–390, 400–520; adds AM mode | uv5r.py:2218-2225 |
| GT-5R | `vhftx` / `uhftx` | TX windows 144–148 and 420–450 MHz; outside them duplex is set to off | uv5r.py:2451-2452, 1055-1060 |
| KT-980HP, BF-F8HP, UV-82HP | power levels | three levels (High 8 W, Med 4 W, Low 1 W) | uv5r.py:2339, 2393, 2421 |
| BJ-UV55 | `_mem_params` | power-on message at image 0x1928 | bjuv55.py:239-240 |
| BJ-UV55 | `_fw_ver_file_start` / `_stop` | 0x1938 / 0x193E (6 bytes) | bjuv55.py:241-242 |
| BJ-UV55 | name length | 6 | bjuv55.py:244-247 |
| BJ-UV55 | memory format | own MEM_FORMAT; `lowpower` is 1 bit | bjuv55.py:40, 54 |
| BJ-UV55 | tuning steps | base steps without 2.5 kHz | bjuv55.py:36-38 |

### 2.4 Settings gated on MODEL

Chirp compares the MODEL string in several places. A user who picks an alias gets a dynamic subclass whose MODEL is the alias name (chirp/wxui/clone.py:532-540, chirp/directory.py:206-213). The alias name then decides these gates.

| Gate | Effect | Citation |
|---|---|---|
| MODEL == "UV-6" | UV-6 settings set (Vox as `autolk`, TDR channel, alarm). No backlight timeout, Other tab, Work Mode tab, or RESET menu. | uv5r.py:1242, 1254, 1271, 1295, 1358, 1385, 1400, 1474, 1565, 1583 |
| MODEL == "F-11" | adds the `vfomrlock` setting | uv5r.py:1490 |
| isinstance UV-82 (includes UV-82X3) | Roger Beep TX boolean and Roger Beep RX list (A/B/Off) in place of the base roger setting; adds `vfomrlock` and `singleptt` | uv5r.py:1425, 1499, 1518 |
| MODEL == "UV-82HP" | adds `vfomrlock`, `singleptt`, and a tone-burst list on `tdrch` | uv5r.py:1508, 1526, 1534 |
| MODEL in ["TI-F8+", "TS-T9+"] | voice is a boolean | uv5r.py:1331-1332 |
| MODEL == "GT-5R" | forces duplex off outside the TX windows | uv5r.py:1055 |
| MODEL == "BJ-UV55" | firmware read at 0x1FF0 | uv5r.py:495, 566, 633 |

### 2.5 Aliases

An Alias carries VENDOR and MODEL only (chirp/chirp_common.py:1254-1257). It inherits all behaviour from its parent class.

| Alias VENDOR / MODEL | Parent class | Citation |
|---|---|---|
| Baofeng / UV-5X | UV-5R (Generic) | uv5r.py:2167-2169, 2209 |
| Retevis / RT5R | UV-5R | 2172-2174 |
| Retevis / RT5RV | UV-5R | 2177-2179 |
| Retevis / RT5 | UV-5R | 2182-2184 |
| Rugged / RH5R | UV-5R | 2192-2194 |
| Radioddity / UV-5R EX | UV-5R | 2197-2199 |
| Ansoko / A-5R | UV-5R | 2202-2204, 2210 |
| Retevis / RT5(tri-power) | BF-F8HP | 2187-2189, 2381 |
| Radioddity / GA-5S | BF-F8HP | 2347-2349 |
| Baofeng / UV-5XP | BF-F8HP | 2352-2354 |
| TechSide / TI-F8+ | BF-F8HP | 2357-2359 |
| Tenway / UV-5R Pro | BF-F8HP | 2362-2364 |
| TechSide / TS-T9+ | BF-F8HP | 2367-2369 |
| TIDRADIO / TD-UV5R TriPower | BF-F8HP | 2372-2374, 2382 |
| Tenway / UV-82 Pro | UV-82HP | 2401-2403, 2410 |

Image metadata also maps Retevis `RT-5R` to `RT5R` and `RT-5RV` to `RT5RV` (chirp/directory.py:163-167).

---

## 3. Basetype lists and matching

### 3.1 Lists

| Constant | Strings | Line |
|---|---|---|
| `BASETYPE_UV5R` | `BFS`, `BFB`, `N5R-2`, `N5R2`, `N5RV`, `BTS`, `D5R2`, `B5R2` | uv5r.py:278-279 |
| `BASETYPE_F11` | `USA` | 280 |
| `BASETYPE_UV82` | `US2S2`, `B82S`, `BF82`, `N82-2`, `N822` | 281 |
| `BASETYPE_BJ55` | `BJ55` | 282 |
| `BASETYPE_UV6` | `BF1`, `UV6` | 283 |
| `BASETYPE_KT980HP` | `BFP3V3 B` | 284 |
| `BASETYPE_F8HP` | `BFP3V3 F`, `N5R-3`, `N5R3`, `F5R3`, `BFT`, `N5RV` | 285 |
| `BASETYPE_UV82HP` | `N82-3`, `N823`, `N5R2` | 286 |
| `BASETYPE_UV82X3` | `HN5RV01` | 287 |
| `BASETYPE_LIST` | concatenation of all nine lists | 288-290 |

Nothing in the checkout reads `BASETYPE_LIST`.

Strings that more than one list claims:

- `N5RV` appears in UV5R and F8HP.
- `N5R2` appears in UV5R and UV82HP.
- `HN5RV01` (UV82X3) contains `N5RV`, so a version string with `HN5RV01` also matches UV5R and F8HP.

### 3.2 Matching rule (file images only)

`model_match(cls, data)` at uv5r.py:777-788 decides by total file length:

| File length | Rule | Lines |
|---|---|---|
| 0x1950 | Take image bytes 0x1948–0x194F and test whether they start with `cls.MODEL`. | 780-782 |
| 0x1948 | Take image bytes `[_fw_ver_file_start, _fw_ver_file_stop)`, which is 0x1838–0x1845 for most classes and 0x1938–0x193D for BJ-UV55. Return True when any basetype string of the class appears as a substring anywhere in that slice. | 783-786 |
| anything else | False | 787-788 |

`match_model` (uv5r.py:883-895) returns True only when the length is 0x1808, 0x1948 or 0x1950 and `model_match` is truthy.

Properties of the 0x1948 rule:

- It is a substring test. Position inside the 14 bytes does not matter, and case matters.
- It reads only the version slice. The ident bytes at 0x0000–0x0007 play no part.
- A 0x1808 file passes the size check and then fails `model_match`. Files that size never auto-detect.
- When no basetype matches, the function falls off the end and returns None, which counts as no match.

### 3.3 Where matching runs and what a mismatch does

`directory.get_radio_by_image` (chirp/directory.py:170-229) loads the file and strips any metadata blob that starts with the marker `00 FF 'chirp' EE 'img' 00 01` (chirp/chirp_common.py:1531, 1588-1608).

- **Metadata present:** the class comes from metadata `vendor` and `model`, matched against each class and its aliases (directory.py:194-215). `match_model` does not run.
- **No metadata:** each registered class's `match_model` runs in registration order. The first True wins (directory.py:180-192). An exception inside `match_model` is logged as `Radio class %s failed during detection: %s` and the scan continues (directory.py:189-192).
- **No class matches:** the error is `ImageDetectFailed("Unknown file format")`, and the file does not open (directory.py:229). The basetype check never produces a warning.
- **Overlaps:** registration order inside uv5r.py is UV-5R Generic, UV-5G Pro, F-11, UV-82, UV-82X3, UV-6, KT-980HP, BF-F8HP, UV-82HP, UV-5RX3, GT-5R, UV-5G (uv5r.py:2207-2486). A version string that holds `N5RV`, `N5R2` or `HN5RV01` therefore opens as UV-5R Generic, provided no module imported earlier claims it. Modules are imported in `glob` order (directory.py:249-258).

The radio protocol path performs no basetype check. `_basetype` is read only at uv5r.py:785.

---

## 4. Version string

### 4.1 Location

| Item | Radio address | Image offset | Length | Citation |
|---|---|---|---|---|
| Version string, all classes except BJ-UV55 | 0x1EF0–0x1EFD (bytes 48–61 of the 0x40 block at 0x1EC0) | 0x1838–0x1845 | 14 | uv5r.py:509-511, 812-813 |
| Version string, BJ-UV55 | 0x1FF0–0x1FF5 (bytes 0–5 of the block at 0x1FF0) | 0x1938–0x193D | 6 | uv5r.py:495-498, bjuv55.py:241-242 |
| `firmware_msg` struct | — | 0x1838: `line1` 7 chars, then `line2` 7 chars | 14 | uv5r.py:216-220 |
| `sixpoweron_msg` (read-only "6+Power-On Message") | 0x1ED0 | 0x1818, two 7-char lines | 14 | uv5r.py:204-208, 2009-2023 |
| `poweron_msg` (user-editable) | 0x1EE0 | 0x1828, two 7-char lines | 14 | uv5r.py:210-214, 809 |

Image to radio address mapping for the aux area: image offset = 0x1808 + (radio address − 0x1EC0) (uv5r.py:749-752). For the main area: image offset = radio address + 8 (uv5r.py:739-740).

Image layout produced by a download (uv5r.py:561-602):

| Image offset | Content |
|---|---|
| 0x0000–0x0007 | 8-byte ident |
| 0x0008–0x1807 | radio 0x0000–0x17FF |
| 0x1808–0x1947 | radio 0x1EC0–0x1FFF, only when `_aux_block` is True |

The sizes are 0x1948 with the aux block and 0x1808 without it (UV-6). The 0x1950 size adds an 8-byte model tag at 0x1948. The test image `tests/images/Radioddity_UV-5G.img` holds `55 56 2D 35 47 20 20 20` ("UV-5G" plus three spaces) there.

### 4.2 Extraction and cleaning

- Extraction is a raw slice of the image (uv5r.py:369-379). Chirp does not trim, decode or normalise it.
- The settings UI shows the two 7-byte halves as "Firmware Message 1" and "Firmware Message 2". Both fields are read-only. Each byte outside printable ASCII 0x20–0x7E is shown as a space (uv5r.py:1985-2007).
- The log prints the version with `repr` during download and upload (uv5r.py:571, 723-724).

### 4.3 Version number parse and the "orig" flag

`BaofengUV5R._is_orig` (uv5r.py:1173-1184) applies this rule to the image's version slice:

1. If `BFB` does not occur, return False. The radio counts as non-orig.
2. Otherwise take the 3 bytes after the first `BFB` and parse them as a decimal integer.
3. Return True when the integer is below 291.
4. If the parse fails, as with `BFB29x`, raise `RadioError("Unable to parse version string <bytes>")`.

`_my_version` (uv5r.py:1186-1192) returns the same integer. It raises `Exception("Unrecognized firmware version string")` when `BFB` is absent. Chirp calls it only after `_is_orig` has returned True (uv5r.py:1331).

During upload, Chirp applies the same parse to the version read live from the radio (uv5r.py:645-650). This path has no try block. A parse failure there surfaces as `Failed to communicate with radio: ...` (uv5r.py:909-915).

Classes that override `_is_orig` to always return False: F-11, UV-82 (and so UV-82X3), UV-6, KT-980HP, BF-F8HP, UV-82HP (section 2.2).

Example from `tests/images/Baofeng_UV-5R.img`: the version slice reads `"  Ver  BFB231 "`, which parses to 231 and marks the radio as orig. The same file's ident is `AA 42 46 42 32 33 31 DD`, which spells "BFB231" in ASCII between `AA` and `DD`.

Other sample version slices: F-11 `"USA307 USA349 "` (tests/images/Baofeng_F-11.img); UV-5G and UV-5G Pro `"HN5RV011"` followed by `FF` or `00` padding (tests/images/Radioddity_UV-5G.img, Baofeng_UV-5G_Pro.img).

### 4.4 Behaviour keyed on the version string

| Condition | Effect | Citation |
|---|---|---|
| orig (BFB < 291) | Band limits at image 0x1910 (`limits_old`). Non-orig uses 0x1908 (`limits_new`). | uv5r.py:2041-2044, 256-270 |
| orig | VFO A/B tuning step uses the 6-entry list 2.5, 5, 6.25, 10, 12.5, 25 kHz. Non-orig uses the 8-entry list that adds 20 and 50 kHz. Corrected by the overseer against uv5r.py:1804-1833. | uv5r.py:1804-1833, 310-313 |
| orig | No Service tab. Non-orig radios with an aux block get 10 VHF and 10 UHF squelch thresholds from `squelch_new` at 0x18A8. | uv5r.py:2101-2120, 235-241 |
| orig and version < 251 | Voice is a boolean. Otherwise it is a list: Off, English, Chinese. | uv5r.py:1331-1347 |
| non-orig and ident byte 3 == 0x02 | Bands are VHF + 220. | uv5r.py:876-877, 276 |
| `firmware_msg.line1` == `HN5RV01` | DTMF code table `0123456789ABCD*#`. Otherwise `0123456789 *#ABCD`. | uv5r.py:1853-1856 |
| image orig ≠ radio orig at upload | Fatal: `Image not supported by radio`. | uv5r.py:652-656 |
| image orig at upload | Aux upload limited to the welcome message 0x1EE0–0x1EF0 and the old band limits 0x1FC0–0x1FE0. | uv5r.py:702-707 |
| non-orig, no dropped byte, aux mismatch at upload | Aux upload covers 0x1EE0–0x1EF0, 0x1F60–0x1F70 (VHF squelch), 0x1F80–0x1F90 (UHF squelch) and 0x1FC0–0x1FD0 (new band limits). | uv5r.py:713-720 |
| dropped byte, or all three aux areas match | Aux upload covers 0x1EC0–0x2000. | uv5r.py:708-712 |
| dropped byte and aux mismatch, no override | Fatal: `Image not supported by radio. You must...` followed by the steps download, change, upload to the same radio. | uv5r.py:687-693 |
| comment at uv5r.py:592-595 | Radios with firmware before BFB291 do not accept 0x10-byte reads in the aux area. | uv5r.py:592-595 |

Dropped-byte detection: Chirp reads the 0x40 block at 0x1FC0. If byte 15 (radio 0x1FCF) is `FF`, the radio has the dropped-byte defect (uv5r.py:512-524, 484, 490). Such a radio is then read at 0x1FC0–0x1FFF in 0x10-byte blocks (uv5r.py:582-590).

The three aux comparison areas use image offsets 0x1848–0x18A8, 0x18B8–0x18C8 and 0x18D8–0x1908. They are compared against radio 0x1F00–0x1F5F, 0x1F70–0x1F7F and 0x1F90–0x1FBF (uv5r.py:658-660, 484-487).

### 4.5 Range override

Typing the 12 characters `UseAtOwnRisk` into the "Range Override Parameter" setting sets `_all_range_flag` (uv5r.py:1544-1552). The next upload sends `_ranges_main` and `_ranges_aux` in full and skips the dropped-byte refusal. It then raises a RadioError whose text reports success and asks for a CHIRP restart (uv5r.py:726-730, 755-761).

---

## 5. Identification on the wire, and detection of saved images

### 5.1 Ident exchange (`_do_ident`, uv5r.py:382-442)

1. Set the serial read timeout to 1 s (384).
2. Send the 7 magic bytes one at a time, 10 ms apart (387-389).
3. Read 1 byte. Anything other than `06` raises `RadioNoContactLikelyK1`, with the text "No response from radio. Check connector and cabling!" (391-395; chirp/errors.py:21, 75-77).
4. Send `02` (397).
5. Read up to 12 bytes one at a time. Stop right after a `DD` byte arrives (412-417). A read that times out adds nothing, so a silent radio costs up to 12 timeouts.
6. Accept a reply of 8 or 12 bytes (420). Other lengths raise `RadioError("Unexpected response from radio.")` (429-434).
7. Reduce a 12-byte reply to 8 bytes: keep reply bytes 0, 3, 5, 7, 8, 9, 10, 11 in that order (424-426). The comment says the dropped bytes hold `01` (399-408). The code drops by position and does not check their value.
8. Unless this is a blacklist probe, send `06` and expect `06`. A different reply raises `RadioError("Radio refused clone")` (436-440).
9. The 8 bytes become image 0x0000–0x0007 (562, 576-577).

Chirp reads one byte of meaning from the ident. Byte 3 equal to `02` marks a VHF/220 radio (uv5r.py:276, 351-352). At upload, if the radio's ident byte 3 or the image's byte 3 is `02` and the two differ, the upload fails with `Image not supported by radio` (617-622).

### 5.2 Try loop (`_ident_radio`, uv5r.py:530-558)

1. For each magic in `_idents`: run `_do_ident`. Return the ident on success. On `RadioError`, log it, keep it as the last error, and wait 2 s.
2. For each blacklist magic: run `_do_ident` without the final ack. If it succeeds, raise the fatal `RadioError("<reason>. Please choose the proper vendor/model and try again.")`.
3. Otherwise re-raise the last error from step 1. If no error was kept, raise `RadioNoContactLikelyK1`.

Consequence: picking any class other than UV-5G for a radio that answers the UV-5G magic produces "Radio identifies as Radioddity UV-5G. Please choose the proper vendor/model and try again."

### 5.3 After the ident (download, uv5r.py:561-602)

| Class kind | Next reads |
|---|---|
| `_aux_block` False (UV-6) | One 0x40 read at 0x0000 that is discarded (565). Then the main block. |
| BJ-UV55 | One 0x40 read at 0x1FF0, which gives the version (566-567, 495-498). Then the main block. |
| All others | 0x40 reads at 0x1E80 (discarded), 0x1EC0 and 0x1FC0. These give the version and the dropped-byte flag (568-572, 494-527). The main block follows. |

The comment at uv5r.py:500-505 explains the discarded read at 0x1E80. Newer radios return wrong data from the aux area unless a block outside it has been read first.

The class is fixed before the session starts, by the user's choice. Chirp's UV-5R driver does not re-classify from the ident or the version string after download. The `detect` and `detect_from_serial` hooks are absent from uv5r.py.

### 5.4 Detection of a saved image

See section 3.3. The ident at image 0x0000–0x0007 never takes part. No helper named `_ident_from_data` exists. The helpers that exist are `_firmware_version_from_data(data, start, stop)` (uv5r.py:369-371), which returns the raw slice, and `_upper_band_from_data(data)` (uv5r.py:351-352), which returns image byte 3.

---

## 6. Decision procedure for a new implementation

This procedure follows Chirp's behaviour. It adds ordering and tie-breaking that Chirp gets from the user's model choice.

**Step 1. Choose the magic order.**

- Known model: use that class's `_idents` order (section 1.4).
- Unknown UV-5R-family radio: try `291`, `ORIG`, `UV82`, `F11`, `UV6`, `UV6_ORIG`, `A58`, `UV5G`, then `BJUV55_MODEL`. The first two cover the plain UV-5R, the tri-power UV-5R variants and the KT-980HP. This ordering is a proposal. Chirp never scans across classes.
- Between attempts, wait about 2 s as Chirp does (uv5r.py:539).
- A radio that acks `50 0D 0C 20 16 03 28` belongs to the UV-5X3 driver.

**Step 2. Run the ident exchange** (section 5.1). Keep the 8-byte ident. Record which magic succeeded.

**Step 3. Narrow the family by magic.**

| Magic acked | Candidate classes |
|---|---|
| 291 | UV-5R, UV-5G Pro, UV-5RX3, GT-5R, KT-980HP, BF-F8HP; also UV-S9X3 in the WP970I driver |
| ORIG | UV-5R, UV-5G Pro, UV-5RX3, GT-5R |
| A58 | BF-F8HP; also WP970I and BF-A58 in the WP970I driver |
| UV82 | UV-82, UV-82X3, UV-82HP |
| F11 | F-11 |
| UV6 / UV6_ORIG | UV-6. Skip the version read; the radio has no aux block. |
| UV5G | UV-5G |
| BJUV55_MODEL | BJ-UV55. The version is 6 bytes at 0x1FF0. |

**Step 4. Read the version string** with the 0x1E80 → 0x1EC0 → 0x1FC0 sequence (section 5.3). Take bytes 0x1EF0–0x1EFD. Record whether byte 0x1FCF is `FF`.

**Step 5. Classify by version substring**, scoped to the step 3 candidates. Test the most specific strings first so the overlaps resolve:

1. `HN5RV01`: UV-82X3 when the magic was UV82. The UV-5G and UV-5G Pro sample images carry `HN5RV011` too, so with magic 291 or UV5G it does not by itself mean UV-82X3.
2. `BFP3V3 B`: KT-980HP.
3. `BFP3V3 F`, `N5R-3`, `N5R3`, `F5R3`, `BFT`: BF-F8HP.
4. `N82-3`, `N823`: UV-82HP.
5. `US2S2`, `B82S`, `BF82`, `N82-2`, `N822`: UV-82.
6. `USA`: F-11.
7. `BF1`, `UV6`: UV-6.
8. `BJ55`: BJ-UV55.
9. `N5R2`: UV-5R in Chirp's file detection; also listed for UV-82HP. With magic UV82, prefer UV-82HP.
10. `N5RV`: UV-5R in Chirp's file detection; also listed for BF-F8HP. Tri-power cannot be read from the string.
11. `BFS`, `BFB`, `N5R-2`, `BTS`, `D5R2`, `B5R2`: UV-5R.
12. No match: keep the magic-derived family and report the version string as unrecognised. Chirp's file path rejects such an image; its wire path accepts the radio.

**Step 6. Derive feature flags.**

| Flag | Rule |
|---|---|
| `orig` | Version contains `BFB` followed by 3 decimal digits below 291. Force False for F-11, UV-82 family, UV-6, KT-980HP, BF-F8HP and UV-82HP. Non-digit bytes after `BFB` are an error in Chirp. |
| `voice_bool` | `orig` and the BFB number is below 251. |
| `band_220` | Not `orig` and ident byte 3 == `02`. Bands become VHF + 220 MHz. |
| `tri_power` | KT-980HP, BF-F8HP, UV-82HP. Power field values: 0 = High 8 W, 1 = Med 4 W, 2 = Low 1 W. Two-level radios: 0 = High 4 W, 1 = Low 1 W. |
| `limits_addr` | Image 0x1910 when `orig`, else 0x1908. |
| `vfo_step_list` | 6 entries when `orig`, 8 otherwise. |
| `service_squelch` | Present when not `orig` and the radio has an aux block. |
| `dropped_byte` | Byte 0x1FCF == `FF`. Read 0x1FC0–0x1FFF in 0x10-byte blocks. |
| `aux_block` | False only for UV-6. |
| `dtmf_table` | `0123456789ABCD*#` when version line 1 is `HN5RV01`, else `0123456789 *#ABCD`. |

**Step 7. Keep the ident and version in the image** at 0x0000–0x0007 and 0x1838–0x1845. Re-run steps 5–6 on a file without re-reading the radio.

---

## Open questions

1. **0x1950 branch type mismatch.** uv5r.py:781-782 compares an 8-byte `bytes` slice against `cls.MODEL`, which is a `str`. Under Python 3, `bytes.startswith(str)` raises TypeError. directory.py:189-192 catches and logs it, so the branch appears never to match. Overseer: confirm this, and confirm which Chirp version wrote the 8-byte model tag seen in Radioddity_UV-5G.img.
2. **0x1808 images never auto-detect.** `match_model` accepts the size, but `model_match` returns False for it (uv5r.py:787-788). Metadata-less UV-6 images seem impossible to open by detection.
3. **BJ-UV55 download path.** For BJ-UV55, `_do_download` never assigns `has_dropped_byte`, yet it reads it at uv5r.py:581-582 because `_aux_block` is True by inheritance. bjuv55.py:249-250 overrides `process_mmap` without setting `_all_range_flag`, and uv5r.py:726 reads it on every upload. Both look like latent failures that surface as "Failed to communicate with radio". Verify before treating BJ-UV55 as supported.
4. **Multiple magics per radio.** Chirp does not say whether one radio acks more than one magic, for example whether a BFB297 UV-5R acks both 291 and ORIG. The proposed order in step 1 assumes the first ack is authoritative. Only hardware can confirm this.
5. **Ident byte layout.** Chirp reads only byte 3. Sample idents: orig UV-5R `AA 42 46 42 32 33 31 DD`, F-11 `AA 36 74 04 00 05 20 DD`, UV-5G `AA 44 46 04 00 04 70 DD`, UV-5G Pro `AA 30 76 04 00 05 20 DD`. In the orig sample byte 3 is `32`, an ASCII digit and not a band code. The `not orig` guard on the 220 band check may exist for this reason. The meaning of the other bytes is unknown.
6. **12-byte ident.** Chirp says only the UV-6 can send it (uv5r.py:399-408). It keeps bytes by position. Whether bytes 1, 2, 4 and 6 are always `01` is unverified.
7. **N5RV and N5R2 ambiguity.** File detection resolves these to UV-5R by registration order, even though F8HP and UV-82HP also list them. Whether a real tri-power radio reports `N5RV` is unknown. If one does, Chirp opens its metadata-less image with two power levels.
8. **HN5RV01 ownership.** The string is the UV-82X3 basetype, but the UV-5G and UV-5G Pro test images contain `HN5RV011`. The DTMF table switch at uv5r.py:1853 keys on it for every class. It is unclear whether `HN5RV01` marks a firmware family that spans UV-82X3, UV-5G and UV-5G Pro.
9. **Alias-gated voice.** uv5r.py:1331-1332 tests MODEL against the alias names `TI-F8+` and `TS-T9+`. The gate works only through the dynamic alias subclass (clone.py:532-540, directory.py:206-213). The same mechanism means the "Tenway UV-82 Pro" alias appears to lose the UV-82HP-only settings gated on `MODEL == "UV-82HP"` (uv5r.py:1508, 1526, 1534). Confirm this.
10. **Version string beyond BFB.** Chirp parses a number only for `BFB`. The meaning of version strings such as `BFS`, `N5R-2`, `BFP3V3 F` or `USA307 USA349` is not modelled, except as basetype membership.
11. **A58 overlap with WP970I.** The `A58` magic equals `MSTRING_WP970I`. Chirp offers it as the BF-F8HP fallback. A radio that acks it may belong to the WP970I driver, whose memory layout this note does not cover (see the WP970I driver).
