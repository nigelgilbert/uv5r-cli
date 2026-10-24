# UV-5R clone protocol: block transfer, download, upload, memory map

Functional specification of the clone-mode traffic that follows the ident handshake.
Source citations use `uv5r.py:LINE` for `chirp/drivers/uv5r.py` and `bjuv55.py:LINE` for `chirp/drivers/bjuv55.py`.
The UV-5R driver uses `baofeng_common.py` only for a BCD frequency decoder used in the settings UI (`uv5r.py:1643`, `uv5r.py:1658`).
The clone functions in `baofeng_common.py` belong to other drivers and are excluded here.

Conventions:

- "Radio address" means the address carried on the wire.
- "Image offset" means a byte offset into the saved image file.
- All multi-byte header fields are big-endian.
- Line rate is 9600 baud (`uv5r.py:796`).

## 0. State carried in from the handshake

- The ident handshake sets the serial read timeout to 1 s. Nothing resets it afterwards, so every read in this document uses a 1 s timeout (`uv5r.py:384`).
- A successful ident ends with host `0x06`, radio `0x06` (`uv5r.py:437-440`). The radio's `0x06` is consumed by the handshake.
- The ident returned is 8 bytes. A 12-byte ident is reduced to 8 bytes by keeping bytes 0, 3, 5 and 7-11 (`uv5r.py:420-424`). These 8 bytes become image offsets `0x0000-0x0007`.
- Ident byte 3 is the "upper band" byte. Value `0x02` marks a VHF/220 MHz radio (`uv5r.py:276`, `uv5r.py:351-352`, `uv5r.py:617`).

## 1. Read command

### 1.1 Request (host to radio), 4 bytes

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `0x53` (ASCII `S`) |
| 1 | 2 | Radio address, big-endian |
| 3 | 1 | Length in bytes |

Source: `uv5r.py:446-447`. The request is written in one call. No delay precedes it.

### 1.2 Leading ACK byte (conditional)

- On every read except the first one after ident, the host reads 1 byte right after sending the request and requires `0x06` (`uv5r.py:449-453`).
- On the first read after ident, the host skips this step and reads the reply header directly (`uv5r.py:449`, called with `first_command=True` at `uv5r.py:479`, `uv5r.py:496`, `uv5r.py:507`, `uv5r.py:565`).
- Wire interpretation: after the host ACKs a data block (section 1.4), the radio emits one `0x06`. Chirp consumes that byte at the start of the next read, after it has already sent the next request. The handshake's final ACK exchange plays the same role before the first read. See Open questions 1 and 2.
- Failure: byte missing or not `0x06` raises "Radio refused to send second block 0x%04x" with the requested address (`uv5r.py:452-453`).

### 1.3 Reply header (radio to host), 4 bytes

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `0x58` (ASCII `X`) |
| 1 | 2 | Radio address, big-endian; equals the requested address |
| 3 | 1 | Length; equals the requested length |

Source: `uv5r.py:455-463`.

- Fewer than 4 bytes within the timeout raises "Radio refused to send block 0x%04x" (`uv5r.py:456-457`).
- Wrong command byte, address or length raises "Unknown response from radio" (`uv5r.py:460-463`).

### 1.4 Data and host ACK

- The host reads exactly `length` bytes (`uv5r.py:465`).
- Zero bytes raises "Radio did not send block 0x%04x" (`uv5r.py:466-467`).
- A short read raises "Radio sent incomplete block 0x%04x" (`uv5r.py:468-470`).
- No checksum is carried or checked.
- The host then sends one byte `0x06` and sleeps 50 ms (`uv5r.py:472-473`).

### 1.5 Block sizes used for reads

- `0x40` for all main-area reads and most aux reads (`uv5r.py:576-577`, `uv5r.py:598-599`).
- `0x10` for the last aux span `0x1FC0-0x1FFF` on radios with the dropped-byte defect (`uv5r.py:590-591`).
- Every read address in the driver is a multiple of `0x10`. Main and aux `0x40` reads are `0x40`-aligned.

## 2. Write command

### 2.1 Frame (host to radio)

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `0x58` (ASCII `X`) |
| 1 | 2 | Radio address, big-endian |
| 3 | 1 | Payload length (always `0x10` in practice) |
| 4 | N | Payload |

Source: `uv5r.py:606-607`. Header and payload go out in one write call.

### 2.2 ACK

- After writing the frame the host sleeps 50 ms, then reads 1 byte and requires `0x06` (`uv5r.py:608-612`).
- Failure raises "Radio refused to accept block 0x%04x" (`uv5r.py:612`).
- The host sends nothing after the radio's ACK. The next frame follows immediately.

### 2.3 Block size and alignment

- Every write carries 16 bytes. Ranges advance in steps of `0x10` (`uv5r.py:739`, `uv5r.py:751`).
- Every range start in the driver is `0x10`-aligned on the radio side, so every write address is a multiple of `0x10`.

## 3. Download procedure

### 3.1 Sequence

1. Ident handshake. Its 8-byte ident starts the image buffer (`uv5r.py:562`).
2. Probe read, model-dependent:
   - Models without an aux block (UV-6): read `0x0000` length `0x40` as the first read. The data is discarded (`uv5r.py:564-565`).
   - Aux-block models other than BJ-UV55: three `0x40` reads, data used only for the probe (`uv5r.py:568-570`, `uv5r.py:505-519`):
     1. `0x1E80` as the first read. Discarded. Per the comment, newer radios return wrong aux data unless a block outside the aux area is read first (`uv5r.py:500-504`).
     2. `0x1EC0`. Bytes 48-61 (radio `0x1EF0-0x1EFD`) are the firmware version string (`uv5r.py:511`).
     3. `0x1FC0`. Byte 15 (radio `0x1FCF`) equal to `0xFF` flags the dropped-byte defect (`uv5r.py:519`).
   - BJ-UV55: one read at `0x1FF0` length `0x40` as the first read; bytes 0-5 are its version (`uv5r.py:495-498`). See Open question 6.
3. Main area: radio `0x0000` to `0x17FF` in 96 reads of `0x40`, ascending. Data is appended (`uv5r.py:576-577`).
4. Aux area, aux-block models only (`uv5r.py:581-599`):
   - Dropped-byte radios: `0x1EC0-0x1FBF` in four `0x40` reads, then `0x1FC0-0x1FFF` in four `0x10` reads (`uv5r.py:585-591`).
   - Other radios: `0x1EC0-0x1FFF` in five `0x40` reads (`uv5r.py:598-599`). The comment says firmware before BFB291 does not support `0x10` reads in the aux area (`uv5r.py:593-596`).
5. Chirp ends the session without sending any further bytes (`uv5r.py:601-602`).

### 3.2 Dropped-byte defect

Per the comment at `uv5r.py:513-516`: on affected radios a `0x40` read at `0x1FC0` loses the byte at `0x1FCF`. The following bytes shift down one place, `0xFF` appears at `0x1FCF`, and `0x80` pads the end at `0x1FFF`. Reading that span in `0x10` blocks returns correct data.

### 3.3 Image assembly

Chirp concatenates the pieces with no padding. Radio `0x1800-0x1EBF` is never read and has no place in the image.

| Image offset | Size | Content | Radio address |
|---|---|---|---|
| `0x0000-0x0007` | 8 | Ident from handshake | none |
| `0x0008-0x1807` | `0x1800` | Main area | `0x0000-0x17FF` |
| `0x1808-0x1947` | `0x140` | Aux area | `0x1EC0-0x1FFF` |

Conversions:

- Main: image offset = radio address + 8 (`uv5r.py:740`).
- Aux: image offset = `0x1808` + (radio address - `0x1EC0`) (`uv5r.py:749-752`).

Accepted image sizes (`uv5r.py:887`, `uv5r.py:777-789`):

| Size | Meaning |
|---|---|
| `0x1808` | Legacy image, no aux block. UV-6 images have this size. |
| `0x1948` | Current image. Model match looks for a base-type tag inside image `0x1838-0x1845`. |
| `0x1950` | Current image plus an 8-byte trailer at `0x1948-0x194F`. Model match tests whether the trailer starts with the model name. |

`_memsize` is `0x1808` and only feeds the progress bar (`uv5r.py:798`, `uv5r.py:337`).

## 4. Upload procedure

### 4.1 Sequence

1. Ident handshake (`uv5r.py:616`).
2. Band check. If the radio's ident byte 3 or image offset `0x0003` equals `0x02`, both must be equal. Otherwise raise "Image not supported by radio" (`uv5r.py:617-622`).
3. Aux-block models: take the image firmware version from image `0x1838-0x1845` (`uv5r.py:624-625`, `uv5r.py:812-813`).
4. Range selection, model-dependent (sections 4.2-4.4).
5. Main writes, ascending by range then address (`uv5r.py:737-742`).
6. If the image is `0x1808` bytes, stop (`uv5r.py:744-746`).
7. Aux writes, aux-block models only, ascending (`uv5r.py:748-752`).
8. If the override flag was set, clear it and raise the "This is NOT an error" message (`uv5r.py:755-761`).

No delay separates the reads in step 4 from the writes in step 5.

### 4.2 Models without an aux block (UV-6)

- No reads take place.
- Main ranges are the default set in section 4.5. Aux ranges are empty (`uv5r.py:626-631`).

### 4.3 Aux-block models other than BJ-UV55

Probe reads (`uv5r.py:640-641`, `uv5r.py:478-491`), all length `0x40`:

| Order | Address | Use |
|---|---|---|
| 1 (first read) | `0x1E80` | Discarded |
| 2 | `0x1EC0` | Bytes 48-61: radio firmware version |
| 3 | `0x1F00` | All 64 bytes: aux area 1, part 1 |
| 4 | `0x1F40` | Bytes 0-31: aux area 1, part 2. Bytes 48-63: aux area 2 |
| 5 | `0x1F80` | Bytes 16-63: aux area 3 |
| 6 | `0x1FC0` | Byte 15 = `0xFF` flags dropped-byte defect |

These reads use `0x40` blocks even on dropped-byte radios.

Firmware family check (`uv5r.py:643-656`):

- Radio is "original" when its version string contains `BFB` and the three ASCII digits after it parse to an integer below 291 (`uv5r.py:644-648`). A version string without `BFB` counts as not original (`uv5r.py:649-650`).
- Image "original" status uses the same rule on image `0x1838-0x1845` (`uv5r.py:1173-1184`). F-11, UV-82, UV-6, KT-980HP, BF-F8HP and UV-82HP always report not original (`uv5r.py:2260-2262`, `uv5r.py:2274-2276`, `uv5r.py:2322-2324`, `uv5r.py:2342-2344`, `uv5r.py:2396-2398`, `uv5r.py:2424-2426`).
- A mismatch raises "Image not supported by radio" (`uv5r.py:655-656`).

Aux comparison (`uv5r.py:658-685`). The three areas are the aux bytes that the default ranges never write:

| Area | Radio address | Image offset |
|---|---|---|
| 1 | `0x1F00-0x1F5F` | `0x1848-0x18A7` |
| 2 | `0x1F70-0x1F7F` | `0x18B8-0x18C7` |
| 3 | `0x1F90-0x1FBF` | `0x18D8-0x1907` |

- All three equal sets `aux_matched`. Any difference is logged and left as a mismatch. The comment calls skipping the aux area "the safest thing to do" (`uv5r.py:663-680`).
- The BJ-UV55 map places TX power tuning tables in area 1 at image `0x1849` and `0x1889` (`bjuv55.py:210-214`). This suggests the areas hold per-unit calibration.
- Dropped-byte radio, no override, and `aux_matched` false raises the three-step "Image not supported by radio. You must..." error (`uv5r.py:687-693`).

Default aux ranges, radio addresses (`uv5r.py:702-721`):

| Condition | Ranges written | Comments in source |
|---|---|---|
| Image is original (pre-BFB291) | `0x1EE0-0x1EEF`, `0x1FC0-0x1FDF` | welcome message; old band limits |
| Dropped-byte radio, or `aux_matched` | `0x1EC0-0x1FFF` | full aux range |
| Otherwise (BFB291 and later) | `0x1EE0-0x1EEF`, `0x1F60-0x1F6F`, `0x1F80-0x1F8F`, `0x1FC0-0x1FCF` | welcome message; VHF squelch; UHF squelch; new band limits |

### 4.4 BJ-UV55

- Probe is the single `0x1FF0` read from section 3.1 (`uv5r.py:633-634`).
- No family check and no aux comparison.
- Ranges are the class-level full lists: main image `0x0008-0x1807`, aux radio `0x1EC0-0x1FFF` (`uv5r.py:636-638`, `uv5r.py:815-820`). BJ-UV55 does not override them.

### 4.5 Main ranges

Default set, image offsets (`uv5r.py:627-631`, `uv5r.py:696-700`):

| Image offsets | Radio addresses | Blocks |
|---|---|---|
| `0x0008-0x0CF7` | `0x0000-0x0CEF` | 207 |
| skipped `0x0CF8-0x0D07` | `0x0CF0-0x0CFF` | 1 |
| `0x0D08-0x0DF7` | `0x0D00-0x0DEF` | 15 |
| skipped `0x0DF8-0x0E07` | `0x0DF0-0x0DFF` | 1 |
| `0x0E08-0x1807` | `0x0E00-0x17FF` | 160 |

The source gives no reason for the two skips. See Open question 4.

### 4.6 Range override

- The advanced setting "Range Override Parameter" holds a string. When it equals `UseAtOwnRisk` after trimming, the override flag is set (`uv5r.py:1544-1557`).
- With the flag set, upload uses main image `0x0008-0x1807` and aux radio `0x1EC0-0x1FFF` (`uv5r.py:726-730`, `uv5r.py:815-820`).
- The flag also suppresses the dropped-byte refusal (`uv5r.py:687`).
- The family check and the band check still apply.
- After the writes, Chirp clears the flag and raises an error whose text says the upload succeeded and asks for a restart (`uv5r.py:755-761`).

## 5. Memory map

### 5.1 Image regions

Radio address = image offset - 8 for the main area. Aux conversion is in section 3.3.

| Image offset | Radio address | Size | Content |
|---|---|---|---|
| `0x0000` | none | 8 | Ident; byte 3 is the upper-band byte |
| `0x0008` | `0x0000` | 128 x 16 | Channel records 0-127 |
| `0x0808` | `0x0800` | `0x300` | Undefined in the driver |
| `0x0B08` | `0x0B00` | 15 x 16 | PTT-ID DTMF codes, 5 code bytes per entry |
| `0x0C88` | `0x0C80` | `0x34` | ANI and DTMF special codes |
| `0x0CF8` | `0x0CF0` | 16 | Undefined; never uploaded by default |
| `0x0DF8` | `0x0DF0` | 16 | Undefined; never uploaded by default |
| `0x0E28` | `0x0E20` | `0x2E` | Settings block |
| `0x0E7E` | `0x0E76` | 2 | MR channel for A and B (7 bits each) |
| `0x0F10` | `0x0F08` | 24 | VFO A |
| `0x0F30` | `0x0F28` | 24 | VFO B |
| `0x0F56` | `0x0F4E` | 2 | Broadcast FM preset; unused by the UI (`uv5r.py:1842-1851`) |
| `0x1008` | `0x1000` | 128 x 16 | Channel names: 7 chars plus 9 unknown bytes |
| `0x1808` | `0x1EC0` | 16 | Aux, undefined |
| `0x1818` | `0x1ED0` | 14 | Second power-on message, read-only in UI |
| `0x1828` | `0x1EE0` | 14 | Power-on message (welcome), writable |
| `0x1838` | `0x1EF0` | 14 | Firmware message; first 7 bytes hold the version tag |
| `0x1848` | `0x1F00` | `0x60` | Aux area 1 (protected) |
| `0x18A8` | `0x1F60` | 10 + 6 | New-firmware VHF squelch thresholds sql0-9, then 6 unknown |
| `0x18B8` | `0x1F70` | 16 | Aux area 2 (protected) |
| `0x18C8` | `0x1F80` | 10 | New-firmware UHF squelch thresholds |
| `0x18D8` | `0x1F90` | `0x30` | Aux area 3 (protected); old-firmware squelch tables at `0x1FA0`/`0x1FB0` |
| `0x1908` | `0x1FC0` | 10 | New-firmware band limits, VHF then UHF |
| `0x1910` | `0x1FC8` | 24 | Old-firmware band limits (overlaps the new ones) |
| `0x1948` | none | 8 | Optional model-name trailer |

Sources: `uv5r.py:30-271`, `uv5r.py:809`, `uv5r.py:2009-2023`.

Record layouts in brief:

- Channel record, 16 bytes: RX freq 4 bytes little-endian BCD, TX freq 4 bytes little-endian BCD, RX tone u16 LE, TX tone u16 LE, 4 flag bytes (`uv5r.py:31-51`).
- First byte `0xFF` marks an empty channel. Erasing writes 16 bytes of `0xFF` to both the channel and the name record (`uv5r.py:939-941`, `uv5r.py:1075-1078`).
- TX freq all `0xFF` or all `0x00` means TX inhibited (`uv5r.py:920-924`).
- Band limit entry, 5 bytes: enable byte, lower limit 2 bytes big-endian BCD, upper limit 2 bytes big-endian BCD (`uv5r.py:250-254`).
- Settings offsets: squelch at image `0x0E28`, step `0x0E29`, save `0x0E2B`, vox `0x0E2C`, abr `0x0E2E`, tdr `0x0E2F`, beep `0x0E30`, timeout `0x0E31`, voice `0x0E36`, dtmfst `0x0E38` (`uv5r.py:85-141`).

### 5.2 Firmware- and model-dependent bytes

| Item | Rule | Image offset (radio) | Source |
|---|---|---|---|
| Band limits | Original (< BFB291): `limits_old`, VHF at `0x1912` (`0x1FCA`), UHF at `0x1922` (`0x1FDA`). Otherwise `limits_new`, VHF at `0x1908` (`0x1FC0`), UHF at `0x190D` (`0x1FC5`) | see rule | `uv5r.py:256-270`, `uv5r.py:2041-2044` |
| Squelch tables | Exposed only when the image is not original and the model has an aux block: `squelch_new` at `0x18A8`/`0x18C8`. `squelch_old` at `0x18E8`/`0x18F8` is defined and unused | see rule | `uv5r.py:235-248`, `uv5r.py:2100-2117` |
| VFO tuning step | Original: 6-entry list (2.5, 5, 6.25, 10, 12.5, 25 kHz). Others: 8-entry list adding 20 and 50 kHz. Bits 4-6 of the byte | VFO A `0x0F26` (`0x0F1E`), VFO B `0x0F46` (`0x0F3E`) | `uv5r.py:164-166`, `uv5r.py:186-188`, `uv5r.py:310-313`, `uv5r.py:1804-1833` |
| Voice prompt | Boolean when original and version < 251, or model TI-F8+/TS-T9+. Otherwise 3-way Off/English/Chinese | `0x0E36` (`0x0E2E`) | `uv5r.py:1331-1341` |
| Valid bands | Not original and image byte `0x0003` = `0x02`: VHF plus 220-260 MHz in place of UHF | `0x0003` | `uv5r.py:873-879` |
| DTMF character table | Firmware message line 1 = `HN5RV01`: `0123456789ABCD*#`. Otherwise `0123456789 *#ABCD` | `0x1838` | `uv5r.py:1853-1856` |
| TX power | KT-980HP, BF-F8HP, UV-82HP use 2-bit 3-level power; others use 1 bit | VFO byte 23 | `uv5r.py:1013`, `uv5r.py:1723-1763` |
| Aux settings UI | Absent for `0x1808` images and for the UV-6 | none | `uv5r.py:1561-1567` |
| Alarm mode | Values above 2 shown as 1 | settings `almod` | `uv5r.py:1302-1305` |
| UV-6 channels | Numbered 1-128, stored at index n-1 | channel table | `uv5r.py:2305-2320` |
| BJ-UV55 | Separate map: power-on message `0x1928`, version `0x1938-0x193D` | see rule | `bjuv55.py:239-242` |

## 6. Firmware- and ident-gated behaviour in transfer

- Probe and aux read size depend on the dropped-byte flag (`uv5r.py:582-599`).
- Upload refuses when image and radio differ in original/new status (`uv5r.py:655-656`).
- Upload refuses on a dropped-byte radio when the protected aux areas differ (`uv5r.py:687-693`).
- Aux write ranges depend on original status, dropped-byte flag and comparison result (`uv5r.py:702-721`).
- Upload refuses a 220 MHz band mismatch (`uv5r.py:620-622`).
- Ident list per model sets which magic opens the session (`uv5r.py:800-802`, `uv5r.py:2258`, `uv5r.py:2269`, `uv5r.py:2300-2302`, `uv5r.py:2332`, `uv5r.py:2384-2386`, `uv5r.py:2412`, `uv5r.py:2482`).

## 7. Session lifetime

- Chirp sends no end-of-session command after download or upload (`uv5r.py:601-602`, `uv5r.py:744-761`).
- Chirp inserts no delay after the last block and does not wait for a reboot.
- A failed ident attempt is followed by a 2 s sleep before the next magic (`uv5r.py:533-539`).
- The source contains no idle-timeout handling. Each block exchange follows the previous one within about 50 ms plus line time.
- The pre-upload and pre-download prompts tell the user to power-cycle the radio, set volume high and tune to a quiet channel (`uv5r.py:833-848`).
- The override path asks the user to restart Chirp (`uv5r.py:758-761`).

## 8. Timing constants

| Constant | Value | Where | Source |
|---|---|---|---|
| Baud rate | 9600 | whole session | `uv5r.py:796` |
| Serial read timeout | 1 s per read call | set during ident, kept for all reads | `uv5r.py:384` |
| Inter-byte gap, ident magic | 10 ms | handshake | `uv5r.py:389` |
| Sleep after host ACK on a read | 50 ms | each read | `uv5r.py:473` |
| Sleep after write frame, before reading ACK | 50 ms | each write | `uv5r.py:608` |
| Sleep between failed ident attempts | 2 s | handshake retry | `uv5r.py:539` |

Derived estimates at 9600 8N1 (about 1.04 ms per byte):

- Read of `0x40`: 4 + 4 + 64 + 1 + 1 bytes of line time (about 77 ms) plus 50 ms. Download totals about 104 reads, about 13 s.
- Write of `0x10`: 20 bytes out plus 1 back (about 22 ms) plus 50 ms. Default main upload is 382 writes, about 28 s. Full aux adds 20 writes.

## 9. Error messages

| Message | Condition | Source |
|---|---|---|
| "Radio refused to send second block 0x%04x" | Leading ACK missing or not `0x06` on a non-first read | `uv5r.py:450-453` |
| "Radio refused to send block 0x%04x" | Reply header shorter than 4 bytes | `uv5r.py:455-457` |
| "Unknown response from radio" | Header command, address or length mismatch | `uv5r.py:459-463` |
| "Radio did not send block 0x%04x" | Zero data bytes | `uv5r.py:465-467` |
| "Radio sent incomplete block 0x%04x" | Data shorter than requested | `uv5r.py:468-470` |
| "Radio refused to accept block 0x%04x" | Write ACK missing or not `0x06` | `uv5r.py:610-612` |
| "Image not supported by radio" | 220 MHz band byte mismatch | `uv5r.py:620-622` |
| "Image not supported by radio" | Original/new firmware family mismatch | `uv5r.py:655-656` |
| "Image not supported by radio. You must... 1. Download from radio. 2. Make changes. 3. Upload back to same radio." | Dropped-byte radio, protected aux areas differ, no override | `uv5r.py:687-693` |
| "This is NOT an error. The upload has finished successfully. Please restart CHIRP." | Override upload completed | `uv5r.py:755-761` |
| "Unable to parse version string %s" | Image version contains `BFB` and the following digits do not parse | `uv5r.py:1173-1184` |
| "Failed to communicate with radio: %s" | Any non-RadioError exception during sync, such as a radio version with `BFB` and unparseable digits | `uv5r.py:900-915` |
| "%s. Please choose the proper vendor/model and try again." | Ident matched a blacklisted model | `uv5r.py:541-554` |

## Open questions

1. Leading `0x06` on reads. Chirp reads it after sending the next request, so the wire trace cannot show whether the radio sends it in reply to the host's ACK or as a prefix to the next reply. An implementer can test this by waiting after the host ACK and checking for a byte before sending the next `S` request.
2. Possible ACK skew on upload. After the last probe read the radio's trailing `0x06` stays unread. If it is a reply to the host's ACK, the first write consumes it as its ACK and every later write ACK is read one frame late, with the last ACK left in the buffer. Chirp works either way. Draining input before the first write, or confirming the radio's behaviour, would settle it. The UV-6 path has no probe reads and no skew.
3. The source does not state whether the radio needs the 50 ms sleeps or whether they are margin. It also gives no idle timeout or reboot behaviour after upload.
4. The default upload skips radio `0x0CF0-0x0CFF` and `0x0DF0-0x0DFF` with no comment. The driver defines nothing there. Project history might explain it. These notes did not consult git history.
5. Radio `0x1800-0x1EBF` is never read or written. Its contents and readability are unknown.
6. BJ-UV55 download reads `0x1FF0` with length `0x40`, which runs past `0x2000`. It then reaches the aux branch with the dropped-byte flag never set (`uv5r.py:566-567`, `uv5r.py:581-582`). This looks like a defect in the reference. It does not affect the UV-5R path.
7. The radio-side version parse searches the 14-byte string at radio `0x1EF0`. The image-side parse uses the same span. Firmware strings without `BFB` (for example `HN5RV01`, `BFP3V3`, `N5R-2`) count as not original. Whether any such firmware actually uses the old layout is unknown.
8. On dropped-byte radios the upload probe reads `0x1FC0` with a `0x40` block. The source does not use that block's later bytes, so the defect does not affect the comparison. Whether the full-aux upload restores bytes the defect would otherwise corrupt on the next 0x40 read is untested.
