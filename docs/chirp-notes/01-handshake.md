# UV-5R clone protocol: handshake and ident exchange

Source revision: Chirp checkout `c604141b`. All citations are `path:LINE` in that tree. Paths without a directory prefix refer to `chirp/drivers/uv5r.py`.

Scope: serial setup, the magic/ident handshake, retry and blacklist logic, the reads that run between ident and the main download, and the errors raised along the way. The block-read framing is described only as far as the post-ident reads need it.

## 1. Serial parameters

| Parameter | Value | Source |
|---|---|---|
| Baud | 9600 | `uv5r.py:796`; base default also 9600 at `chirp/chirp_common.py:1262` |
| Data/parity/stop | 8N1. The driver never sets bytesize, parity or stopbits, so the pyserial default applies. | absence: grep of `uv5r.py` finds no such assignment |
| Flow control | None. RTS/CTS off. | `chirp/chirp_common.py:1264`; passed as `rtscts` at `chirp/wxui/clone.py:170` |
| DTR | Asserted on open | `chirp/chirp_common.py:1266`; applied at `chirp/wxui/clone.py:172` |
| RTS | Asserted on open | `chirp/chirp_common.py:1268`; applied at `chirp/wxui/clone.py:171` |
| Read timeout at open | 0.25 s (GUI), 0.5 s (CLI) | `chirp/wxui/clone.py:170`, `chirp/cli/main.py:231` |
| Read timeout during clone | 1 s. The driver overwrites the port timeout at the start of every ident attempt and never changes it again, so 1 s applies to every read for the rest of the session. | `uv5r.py:384` |
| Input/output buffer flush | None. The UV-5R driver never flushes or resets the port buffers. | absence in `uv5r.py`; contrast `chirp/drivers/baofeng_common.py:36-39`, which the UV-5R driver does not call |

The timeout is a total per-read-call budget (pyserial semantics): a request for N bytes returns whatever has arrived after 1 s.

At 9600 8N1 one byte occupies 10 bit times, about 1.04 ms on the wire.

The UV-5R driver imports `baofeng_common` (`uv5r.py:20`) and uses only its BCD frequency decoder (`uv5r.py:1643`, `uv5r.py:1658`). The separate ident routine in `baofeng_common.py:201-261` belongs to other Baofeng drivers and plays no part here.

## 2. Magic values per model

Each magic is 7 bytes. The driver tries the model's list in order.

| Constant | Bytes | Source |
|---|---|---|
| ORIG | `50 BB FF 01 25 98 4D` | `uv5r.py:341` |
| 291 | `50 BB FF 20 12 07 25` | `uv5r.py:342` |
| F11 | `50 BB FF 13 A1 11 DD` | `uv5r.py:343` |
| UV82 | `50 BB FF 20 13 01 05` | `uv5r.py:344` |
| UV6 | `50 BB FF 20 12 08 23` | `uv5r.py:345` |
| UV6_ORIG | `50 BB FF 12 03 98 4D` | `uv5r.py:346` |
| A58 | `50 BB FF 20 14 04 13` | `uv5r.py:347` |
| UV5G | `50 BB FF 20 12 06 25` | `uv5r.py:348` |
| BJ-UV55 | `50 BB DD 55 63 98 4D` | `chirp/drivers/bjuv55.py:32` |

| Model class | Magic order | Source |
|---|---|---|
| UV-5R (base, and the UV-5R Generic, UV-5G Pro, UV-5RX3, GT-5R subclasses that inherit it) | 291, then ORIG | `uv5r.py:800-802` |
| F-11 | F11 | `uv5r.py:2258` |
| UV-82, UV-82X3 | UV82 | `uv5r.py:2269` |
| UV-6 | UV6, then UV6_ORIG | `uv5r.py:2300-2302` |
| KT-980HP | 291 | `uv5r.py:2332` |
| BF-F8HP | 291, then A58 | `uv5r.py:2384-2386` |
| UV-82HP | UV82 | `uv5r.py:2412` |
| UV-5G | UV5G | `uv5r.py:2482` |
| BJ-UV55 | BJ-UV55 | `chirp/drivers/bjuv55.py:238` |

Blacklist magics, tried only after every model magic fails (`uv5r.py:524-527`):

| Bytes | Reported reason |
|---|---|
| `50 0D 0C 20 16 03 28` | "Radio identifies as BTECH UV-5X3" |
| `50 BB FF 20 12 06 25` | "Radio identifies as Radioddity UV-5G" |

## 3. Single ident attempt

One attempt with one magic (`uv5r.py:382-442`):

1. Set the port read timeout to 1 s (`uv5r.py:384`).
2. Send the 7 magic bytes one at a time. After each byte, including the last, wait 10 ms (`uv5r.py:387-389`). Total send phase is about 7 x (1.04 ms + 10 ms), roughly 77 ms.
3. Read 1 byte (1 s timeout) (`uv5r.py:390`).
   - `06`: continue.
   - Anything else, or nothing: fail with the no-contact error (section 8, E1). A wrong byte is logged at debug level; nothing is logged for silence (`uv5r.py:392-395`). The raised error is the same in both cases.
4. Send `02` (`uv5r.py:397`). No delay before or after.
5. Read the ident one byte at a time, up to 12 single-byte reads, each with the 1 s timeout. Stop early as soon as a byte equal to `DD` arrives (`uv5r.py:411-417`). Timed-out reads contribute zero bytes and the loop still counts them.
6. Accept the response only if its total length is exactly 8 or 12 bytes (`uv5r.py:420`). Any other length fails with E2.
   - 8 bytes: the ident is the response unchanged (`uv5r.py:427-428`).
   - 12 bytes: keep response bytes at indexes 0, 3, 5, 7, 8, 9, 10, 11, in that order, to form an 8-byte ident. Indexes 1, 2, 4, 6 are dropped (`uv5r.py:424-426`). The comment states the dropped bytes hold `01` (`uv5r.py:405-408`); the code drops them by position without checking their value.
7. If this is a normal attempt (`secondack` true), send `06` and read 1 byte (1 s timeout). Anything other than `06` fails with E3 (`uv5r.py:436-440`). Blacklist probes skip this step (`uv5r.py:543`).
8. Success: the 8-byte ident is returned and becomes the first 8 bytes of the downloaded image (`uv5r.py:399-402`, `uv5r.py:562`).

Ident content checks: none beyond the length rule and the `DD` terminator. The driver does not check a leading byte. The baofeng_common variant checks for a leading `AA` and trailing `DD` (`baofeng_common.py:228`); this driver does not.

Ident byte semantics used elsewhere: byte index 3 of the (8-byte) ident is the radio's upper band code. Value `02` marks a 220 MHz-band radio (`uv5r.py:276`, `uv5r.py:351-352`, `uv5r.py:617-622`).

### Edge cases that follow from step 5 and 6

- Response ends with `DD` at position 8 or 12: accepted at once.
- Radio sends exactly 8 bytes with no `DD`: the host keeps reading, takes four more 1 s timeouts, then accepts the 8 bytes. About 4 s of extra latency.
- A `DD` byte arrives before position 8: the loop stops, length is short, E2.
- Radio sends more than 12 bytes with no `DD`: the host keeps the first 12, accepts them as a 12-byte ident, and the rest stays in the input buffer.
- Radio silent after `02`: 12 timeouts, about 12 s, then E2.

## 4. Happy path sequence (UV-5R, BFB291+ firmware, download)

```
Host                                        Radio
 |                                            |
 | open 9600 8N1, DTR=1 RTS=1, timeout=1 s    |
 |                                            |
 | 50 ------------------------------------->  |   10 ms gap after each byte
 | BB ------------------------------------->  |
 | FF ------------------------------------->  |
 | 20 ------------------------------------->  |
 | 12 ------------------------------------->  |
 | 07 ------------------------------------->  |
 | 25 ------------------------------------->  |   (10 ms)
 |  <------------------------------------- 06 |   ACK, wait up to 1 s
 | 02 ------------------------------------->  |
 |  <---------------- 8 or 12 bytes, last DD  |   read 1 byte at a time, 1 s each
 | 06 ------------------------------------->  |
 |  <------------------------------------- 06 |   wait up to 1 s
 |                                            |   ---- ident complete ----
 | 53 1E 80 40 ---------------------------->  |   'S' 0x1E80 len 0x40 (first command)
 |  <-------------------------- 58 1E 80 40   |   'X' header echo, no leading 06
 |  <----------------------- 64 data bytes    |   discarded
 | 06 ------------------------------------->  |
 |   (50 ms)                                  |
 | 53 1E C0 40 ---------------------------->  |
 |  <------------------------------------- 06 |   one 06 precedes the header
 |  <-------------------------- 58 1E C0 40   |
 |  <----------------------- 64 data bytes    |   bytes 48..61 = firmware version
 | 06 ------------------------------------->  |
 |   (50 ms)                                  |
 | 53 1F C0 40 ---------------------------->  |
 |  <------------------------------------- 06 |
 |  <-------------------------- 58 1F C0 40   |
 |  <----------------------- 64 data bytes    |   byte 15 (0x1FCF) == FF => dropped-byte radio
 | 06 ------------------------------------->  |
 |   (50 ms)                                  |
 | 53 00 00 40 ---------------------------->  |   main download begins at 0x0000
 |  <------------------------------------- 06 |
 |  ...                                       |
```

For the 291 magic failing and ORIG succeeding, the first 7-byte burst gets no `06`, the host waits 1 s, sleeps 2 s, then sends the ORIG burst.

## 5. Retry, blacklist and failure selection

Order of operations in `_ident_radio` (`uv5r.py:530-558`):

1. For each magic in the model's list, run one attempt (section 3).
   - Success returns immediately (`uv5r.py:534-535`).
   - Any failure of the radio-error family is logged, remembered as the most recent error, and followed by a 2 s sleep (`uv5r.py:536-539`). The sleep also follows the final magic.
   - Failures outside the radio-error family (for example a serial port exception) escape at once with no retry. The outer clone wrapper turns them into "Failed to communicate with radio: <detail>" (`uv5r.py:900-906`, `uv5r.py:909-915`).
2. If every magic failed, probe each blacklist magic in turn with the second-ACK step skipped (`uv5r.py:541-546`). No sleep between blacklist probes. A probe counts as a match when it gets `06` and an 8- or 12-byte ident. On a match, raise E4 naming the model (`uv5r.py:551-554`). The radio is left mid-handshake, since the host never sends the closing `06`.
3. If no blacklist probe matched, raise the most recent model-magic error (`uv5r.py:556-557`). The generic no-contact error at `uv5r.py:558` is reachable only with an empty magic list.

Distinguishing failure modes:

| Observed on the wire | Error surfaced |
|---|---|
| No byte after magic | E1 |
| Wrong byte after magic | E1 (byte value only in debug log) |
| `06`, then ident of wrong length | E2 |
| Ident OK, no `06` or wrong byte after host `06` | E3 |
| All model magics fail, a blacklist magic succeeds | E4 |

Because the final error reported is the one from the last model magic, a UV-5R that rejects both magics reports the ORIG attempt's error.

Buffer handling between attempts: none. Bytes that arrive late from a failed attempt stay in the input buffer and are read as the first reply to the next attempt. The 2 s sleep is the only separation.

Radio state after a previous session: the driver contains no wake-up, reset or "exit clone mode" step. The user prompts tell the operator to power-cycle the radio before each download or upload (`uv5r.py:833-848`). Section 9 lists this as open.

Worst-case time to failure for a silent UV-5R: two magics x (77 ms + 1 s + 2 s) plus two blacklist probes x (77 ms + 1 s), about 8.3 s.

## 6. Post-ident reads

### Block read framing (as used here)

Request, host to radio, 4 bytes: `53` ('S'), address high, address low, length (`uv5r.py:446-447`).

Reply, radio to host:

- When the request is not the first command after ident: one `06` byte, then the header (`uv5r.py:449-453`).
- When the request is the first command after ident: the header directly, with no leading `06`.
- Header, 4 bytes: `58` ('X'), address high, address low, length. All three fields must echo the request (`uv5r.py:455-463`).
- Then exactly `length` data bytes (`uv5r.py:465-470`).

After a good block the host sends `06` and sleeps 50 ms (`uv5r.py:472-473`). The host does not read a reply to that `06` at this point. It reads the radio's `06` as the leading byte of the next block reply. Consequence: the handshake's final `06`/`06` exchange already consumed the radio's ACK, so the first read after ident has no leading `06`. Every later read has one.

### Download path (`uv5r.py:561-572`)

| Model condition | Reads before the main download | Use of the data |
|---|---|---|
| `_aux_block` false (UV-6 family, `uv5r.py:2303`) | `0x0000` len `0x40`, first command | Discarded (`uv5r.py:564-565`). The main download then rereads `0x0000`. |
| Model name "BJ-UV55" | `0x1FF0` len `0x40`, first command | Bytes 0..5 are the firmware version (`uv5r.py:495-498`) |
| All other models | `0x1E80`, `0x1EC0`, `0x1FC0`, each len `0x40`; only the first is a first command | `0x1E80` discarded; `0x1EC0` bytes 48..61 (radio addresses `0x1EF0`-`0x1EFD`) are the 14-byte firmware version; `0x1FC0` byte 15 (radio address `0x1FCF`) equal to `FF` flags the dropped-byte defect (`uv5r.py:506-521`) |

Why the order matters, per the source comment at `uv5r.py:500-504`: newer radios return alternative (bad) data for the aux memory area (which starts at `0x1EC0`) unless the session first reads a block outside that area. Reading `0x1E80` first and discarding it is the workaround. The comment does not say whether the first read after ident is itself special; the `0x1E80` read happens to be both the first command and the outside-aux read.

Dropped-byte defect, per `uv5r.py:513-516`: some newer radios drop the byte at `0x1FCF` when the aux area is read in `0x40` blocks. The following `0x30` bytes shift forward one position, `0x1FCF` reads as `FF`, and the missing last byte (`0x1FFF`) is padded with `80`. When the flag is set, the download later reads `0x1EC0`-`0x1FBF` in `0x40` blocks and `0x1FC0`-`0x1FFF` in `0x10` blocks (`uv5r.py:582-591`). When it is clear, the whole aux area uses `0x40` blocks, because radios before firmware BFB291 do not support `0x10` reads of the aux area (`uv5r.py:592-599`).

Main download after the probe reads: `0x0000`-`0x17FF` in `0x40` blocks, none flagged first (`uv5r.py:576-577`). Resulting image: 8-byte ident, `0x1800` main bytes, then `0x140` aux bytes when the model has an aux block.

### Upload path (`uv5r.py:615-641`)

After ident, the upload path for non-BJ-UV55 models with an aux block reads six blocks, all len `0x40`: `0x1E80` (first command, discarded), `0x1EC0`, `0x1F00`, `0x1F40`, `0x1F80`, `0x1FC0` (`uv5r.py:478-484`). It extracts:

| Item | Radio addresses | Source |
|---|---|---|
| Firmware version (14 bytes) | `0x1EF0`-`0x1EFD` | `uv5r.py:485` |
| Aux area 1 | `0x1F00`-`0x1F5F` | `uv5r.py:486` |
| Aux area 2 | `0x1F70`-`0x1F7F` | `uv5r.py:487` |
| Aux area 3 | `0x1F90`-`0x1FBF` | `uv5r.py:488` |
| Dropped-byte flag | `0x1FCF` == `FF` | `uv5r.py:490` |

The version string is searched for `BFB` followed by three ASCII digits; a value below 291 marks an "original" radio (`uv5r.py:645-650`). The UV-6 family skips these reads. BJ-UV55 does the single `0x1FF0` read.

## 7. Timing constants

| Value | Where | Purpose |
|---|---|---|
| 9600 baud | `uv5r.py:796` | Line rate for all models in this driver |
| 0.25 s / 0.5 s | `chirp/wxui/clone.py:170`, `chirp/cli/main.py:231` | Port timeout at open; replaced before first use |
| 1 s | `uv5r.py:384` | Read timeout for the ACK, each ident byte, the second ACK, and every block read thereafter |
| 10 ms | `uv5r.py:389` | Pause after each magic byte, including the last |
| 12 reads max | `uv5r.py:412` | Upper bound on single-byte ident reads |
| 2 s | `uv5r.py:539` | Pause after each failed model-magic attempt |
| 0 s | `uv5r.py:541-546` | No pause between blacklist probes |
| 50 ms | `uv5r.py:473` | Pause after the host's `06` that closes each block read |
| 50 ms | `uv5r.py:608` | Pause after each upload write, before reading its ACK |

## 8. Errors raised in this phase

| ID | Message | Condition | Source |
|---|---|---|---|
| E1 | "No response from radio. Check connector and cabling!" (no-contact error, troubleshooting link `.../wiki/Error-NO_CONNECTION_K1`) | Byte after the magic is missing or is not `06`. Also the fallback when the magic list is empty. | `uv5r.py:392-395`, `uv5r.py:558`; message text `chirp/errors.py:21`, link `chirp/errors.py:70-72` |
| E2 | "Unexpected response from radio." | Ident response length is neither 8 nor 12 | `uv5r.py:429-434` |
| E3 | "Radio refused clone" | Reply to the host's post-ident `06` is missing or is not `06` | `uv5r.py:436-440` |
| E4 | "Radio identifies as BTECH UV-5X3. Please choose the proper vendor/model and try again." or the same with "Radioddity UV-5G" | All model magics failed and a blacklist magic produced an ACK and a valid-length ident | `uv5r.py:551-554` |
| E5 | "Radio refused to send second block 0x%04x" | Non-first block read: leading byte is missing or not `06` | `uv5r.py:449-453` |
| E6 | "Radio refused to send block 0x%04x" | Fewer than 4 header bytes | `uv5r.py:455-457` |
| E7 | "Unknown response from radio" | Header command byte is not `58`, or address or length does not echo the request | `uv5r.py:459-463` |
| E8 | "Radio did not send block 0x%04x" | Zero data bytes | `uv5r.py:465-467` |
| E9 | "Radio sent incomplete block 0x%04x" | Some, but fewer than `length`, data bytes | `uv5r.py:468-470` |
| E10 | "Failed to communicate with radio: <detail>" | Any non-radio-error exception during download or upload | `uv5r.py:900-915` |

All of E1-E9 belong to the radio-error family, so E1-E3 trigger the next-magic retry in section 5. E5-E9 happen after ident and have no retry.

## 9. Open questions

1. Meaning of the radio's `06` that precedes non-first block headers. The code is consistent with "the radio answers each host `06` with `06`" and with "the radio ACKs each `S` request except the first". The first reading fits the handshake, where the host's `06` gets a `06`. A capture with a long gap between the host's `06` and the next `S` would settle it.
2. Whether "first command after ident" is special to the radio, or only to the host's ACK bookkeeping. The UV-6 path reads and discards `0x0000` as its first command with no comment explaining why (`uv5r.py:564-565`).
3. The 12-byte ident layout. The comment says the dropped bytes are `01` (`uv5r.py:405-408`) and ties the 12-byte form to the UV-6 (`uv5r.py:402-403`). The code applies the 12-byte rule to every model, never checks the dropped values, and does not say which UV-5R firmware, if any, sends 12 bytes.
4. Ident leading byte. This driver checks nothing but length and the `DD` terminator. The sibling driver expects a leading `AA` (`baofeng_common.py:228`). Whether UV-5R idents always start with `AA` is not stated here.
5. Recovery when the radio is still in clone mode from an earlier aborted session. The driver has no reset sequence and no buffer flush; the only guidance is the power-cycle prompt (`uv5r.py:833-848`). Behavior of a radio that receives a new magic mid-session is undocumented.
6. Upload ACK alignment. The last post-ident read leaves the radio's answering `06` unread. The first upload write (`uv5r.py:605-612`) reads one byte as its ACK, which would be that stale `06`. Each later write would then read the previous write's ACK. The source does not comment on this; it may be harmless off-by-one.
7. BJ-UV55 download. The BJ-UV55 branch never sets the dropped-byte flag (`uv5r.py:566-567`), yet the class inherits `_aux_block = True` (`uv5r.py:806`) and the aux step reads that flag (`uv5r.py:581-582`). That looks like it would fail after the main download with E10. The BJ-UV55 probe also requests `0x40` bytes at `0x1FF0`, which runs past `0x2000`. The driver is listed in `tests/py3-untested-drivers.txt`.
8. Whether DTR and RTS levels matter to the radio. Chirp asserts both by default and the UV-5R driver does not override them. Many programming cables power or key from these lines; the source gives no reason for the default.
9. Whether the 10 ms per-byte magic pacing is required. The sibling driver sends its magic in one write (`baofeng_common.py:212`). No comment in `uv5r.py` explains the pacing.
10. The 8-byte-without-`DD` case (section 3 edge cases) costs about 4 s and is accepted. Whether any real radio sends that form is unknown.
