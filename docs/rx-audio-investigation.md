# RX audio investigation, 2026-10-12

The bench UV-5R (firmware HN5RV011) delivered no receive audio through the AIOC. Two
faults were found. A zeroed settings block had turned voice and beep off, which mutes
receive audio on this firmware; "Result, 2026-10-12 afternoon" records the repair and the
staged-commit rule behind it. After that the volume knob was down or the 2.5 mm plug short
of its contact; "Resolved, 2026-10-17 evening" records the fix and the reference knob
position. The sections run in the order the work happened.

## Symptom

`ffmpeg -f avfoundation -i ":AIOC Audio"` captures a flat line at about -49 dBFS. Played
through the MacBook speakers it gives under a second of noise at start, then silence.

## What was measured and cleared

| Layer | Test | Result |
|---|---|---|
| Capture tooling | ffmpeg avfoundation and a native AVAudioEngine capture selected by CoreAudio UID `...:2` | Identical samples. Tooling is fine. |
| macOS permission | Sample values | Non-zero. A TCC denial or host mute gives exact zeros. |
| CoreAudio | Input volume and mute on both elements of the AIOC input device | Volume 1.0, mute 0. |
| AIOC stream | Raw int16 samples over 1 s | 13 adjacent 12-bit codes, -16 to -208 in int16, about 7 LSB below mid-scale, zero zero-crossings. This is the ADC bias with no AC on the speaker line. |
| AIOC firmware | HID feature-report register reads | Magic `AIOC` (firmware 1.3+), `AUDIO_RX` 0x72 = 0 (1x gain), PTT1 source 0x404 (DTR and not RTS), PTT idle, record rate 48000, record volume 0xFFFF both channels. Factory defaults. |
| AIOC hardware revision | v1.2 schematic note | The speaker net reaches both PB2 (1x path) and the OPAMP1 input, so 1x gain reads the real input on every board revision. |
| Serial port | `lsof` on the AIOC tty and cu devices | Nothing holds the port. The transport sets DTR low and RTS low on open. |
| Clone mode exit | Raw `S` read with no magic at 1 s, 4 s and 8 s after a session | Reply at 1 s, no reply at 4 s and 8 s. The radio leaves clone mode as `protocol.ts` assumes. Audio stayed flat across the whole window. |
| Radio service squelch thresholds | Aux bytes 0x1F60 and 0x1F80 in the dump | Plausible ramps, unchanged from the fixture. |

Three research agents covered the AIOC firmware, UV-5R behaviour and macOS USB audio.
Their findings that matter here:

- Nothing in AIOC firmware gates the RX ADC for serial, CDC, DTR, RTS or PTT state.
- On the BFB297 firmware family, which HN5RV011 derives from, VOICE set to OFF cuts receive
  audio until the setting is restored and the radio is power cycled. On N5R-20 and N5R-30
  firmware, BEEP set to OFF mutes audio. Sources: Miklor FAQ section 2.10 and the
  buytwowayradios "stops receiving after CHIRP upload" post.
- Some UV-5R units detect the plug by a DC load and keep the internal speaker live
  (AIOC issue 106). Check this if the fix below restores settings and audio stays absent.

## Cause

Compare the committed fixture, dumped before any write, with a dump taken today.

| Address | Fixture | Today |
|---|---|---|
| 0x0E20 | `03 00 00 03 00 00 05 00 01 03 00 00 00 00 01 00` | `00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00` |
| 0x0E30 | `03 00 00 00 05 02 02 00 00 00 00 00 00 03 01 02` | `00 00 00 00 00 02 00 00 00 00 00 00 00 00 00 00` |
| 0x0E40 | `00 00 00 01 05 00 01 00 01 00 9f 00 00 01 80 00` | `00 00 00 01 05 00 01 00 01 00 1f 00 01 00 80 00` |

Decoded with CHIRP's `uv5r.py` settings struct at 0x0E20:

| Byte | Field | Fixture | Today |
|---|---|---|---|
| 0x0E20 | squelch | 3 | 0 |
| 0x0E23 | save | 3 | 0 |
| 0x0E26 | abr (backlight) | 5 | 0 |
| 0x0E28 | beep | 1 | 0 |
| 0x0E29 | timeout | 3 | 0 |
| 0x0E2E | voice | 1 (English) | 0 (off) |
| 0x0E30 | dtmfst | 3 | 0 |
| 0x0E34 | pttlt | 5 | 0 |
| 0x0E35 | mdfa | 2 (name) | 2 (name) |
| 0x0E36 | mdfb | 2 | 0 |
| 0x0E3D..3F | wtled, rxled, txled | 3, 1, 2 | 0, 0, 0 |

The live 0x0E30 block is a zero-filled buffer with only `mdfa` set. The deleted
`CODE_REVIEW.md` in the first commit lists `ADDR.tdr`, `ADDR.mdfa`, `ADDR.mdfb`,
`ADDR.vfoa` and `ADDR.vfob` as addresses with no production callers, so an earlier version
of the CLI wrote display mode and related settings and that code was removed. The README
says the radio acks and ignores those writes. The radio applied them. Voice OFF and beep
OFF followed, and on this firmware that mutes receive audio.

The 0x0E40 changes are the work mode byte flipping to channel mode and the display A/B
flag clearing. Those match knob and key use and need no repair.

## Protocol quirks found on this firmware

- A 16-byte read at 0x0E10, 0x0E20, 0x0E30 or 0x0E40 returns the 0x0E40 record. A 64-byte
  read at 0x0E00 returns the true layout. `dumpImage` uses 64-byte reads, so dumps are
  correct. `readStatus` reads 0x0E40 with 64 bytes.
- A 16-byte write at 0x0E20 or 0x0E30 is acked and ignored. Verified by writing the fixture
  bytes, reading back in the same session and again in a fresh session.
- `restoreImage` writes 0x0E00 to 0x1800 in 16-byte blocks. In the settings region those
  writes do nothing, so `restore` cannot repair this damage.
- The write size that zeroed the region is unknown. The early code is gone from history.
  A 32-byte write at 0x0E20 and a 64-byte write at 0x0E00 are the candidates. Neither was
  run; both were blocked by the permission classifier in the session that found this.

## Repair steps

This is the morning plan. "Result, 2026-10-12 afternoon" records what was done, and its
measured rule supersedes the 32-byte and 64-byte write attempts. `Session.writeBlock` now
takes one aligned 16-byte block.

Run these on the bench with the human present. Steps 1 to 3 write radio EEPROM and need
explicit permission.

1. Dump first: `node src/cli/main.ts dump --out before-repair.img`.
2. Write the fixture's settings bytes back. Try a 32-byte write at 0x0E20 first. If the
   64-byte readback at 0x0E00 still shows zeros, try a 64-byte write at 0x0E00 using the
   fixture's bytes 0x0E00 to 0x0E3F. Set byte 0x0E20 (squelch) to 0 for the test.
3. Close the session, wait 6 s, capture 5 s from the AIOC and print per-second RMS:

   ```sh
   ffmpeg -hide_banner -loglevel info -f avfoundation -i ":AIOC Audio" -t 5 \
     -af "asetnsamples=48000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level" \
     -f null - 2>&1 | grep -o "RMS_level=.*"
   ```

   Open-squelch static reads well above -30 dBFS. Flat -49 dBFS means the write did not
   take or the mute has another cause; power cycle the radio and capture again before
   concluding.
4. Write squelch back to 3 with the same block write, then dump and diff against the
   fixture. Only 0x0010, 0x07E0, 0x07F0, 0x1010, 0x17E0, 0x17F0 (channel tunes and names)
   and the 0x0E40 knob bytes should differ.
5. If audio is still absent after the settings read back correctly, have the human set
   menu 14 VOICE to ENG and menu 8 BEEP to ON from the keypad and power cycle. If the
   internal speaker still plays with the AIOC inserted, see AIOC issue 106.

## Monitor command

```sh
ffmpeg -hide_banner -loglevel warning -f avfoundation -i ":AIOC Audio" \
  -f audiotoolbox -audio_device_index 3 -
```

Index 3 is MacBook Pro Speakers on this machine. List devices with
`ffmpeg -f lavfi -i anullsrc -t 0.1 -f audiotoolbox -list_devices true -`.

## Result, 2026-10-12 afternoon

The settings block is back to the fixture values. Writes of 16, 32 and 64 bytes on their
own were acked and dropped. A full `restore` of today's image with the fixture bytes
patched in at 0x0E20 took, and a sequence of single writes isolated the rule:

- Writes at 0x0E20 and 0x0E30 land in a 32-byte staging buffer that starts zero-filled
  each session.
- A 16-byte write at 0x0E40 commits the buffer to EEPROM.
- 0x0E20 followed by 0x0E40 committed squelch and zeroed 0x0E30. 0x0E20 followed by 0x0E30
  committed nothing. 0x0E20 followed by 0x0000 committed nothing. 0x0E00 and 0x0E10
  before 0x0E20 committed nothing.

That is how the early display-mode write wiped the block: it wrote the 0x0E30 half, then
the work-mode byte at 0x0E4C, and the radio committed zeros over 0x0E20 with it.

The CLI now has `settings` (read, or write both halves plus the 0x0E40 record and verify
in a fresh session), `restore` verifies the block the same way, `status` reads the page
with 64-byte reads and reports squelch, voice, beep and abr, `listen --seconds N` wraps
the ffmpeg capture, and `FakeRadio` models the alias and the staged commit.

Audio after the repair, without a power cycle: -49 dBFS flat, peak -47. Next step is step 5
above: power cycle the radio, then `uv5r listen --seconds 5`.

## Open, 2026-10-12 evening

After the power cycle and with squelch at 0, the radio plays static from its own speaker
with the AIOC unplugged and mutes it when the AIOC's 3.5 mm plug is seated. The AIOC
capture stays at -49 dBFS with a peak of -47.14 in every run, including with a fingertip
on the unplugged 3.5 mm tip. The AIOC board and solder joints look good under inspection.
Squelch is back at 3.

The samples sit at ADC mid-scale with 13 codes of noise: a clean bias node with no AC on
it. Candidates still untested: the firmware sampling a pin other than the speaker line
(board revision detection), the receive gain or input mux registers, and the AIOC's
RX path before the bias node. Next test: change the AIOC receive gain over HID and watch
whether the noise floor moves.

### Gain sweep, 2026-10-12 evening

The AIOC's RX gain register (HID 0x72, bits 16-19) selects the ADC path: 1x samples PB2
on ADC2 through the static divider, 2x to 16x sample OPAMP1's PGA output from PA5 on ADC1.
`listen` now high-passes at 50 Hz so the bias cannot read as signal. With squelch 0 and the
radio plugged in, AC level by gain: 1x -66, 2x -61, 4x -56, 16x -44 dBFS. That is the ADC
noise floor scaling with gain plus about half a millivolt from the radio at 16x. Static at the jack would clip the 2x range.

The AIOC schematic's K-connector note: 2.5 mm plug tip = SPK+ from the radio, ring =
TxData from the radio, sleeve = GND; 3.5 mm plug tip = +V/PTT2, ring = MIC+, sleeve =
PTT1/RxData. Receive audio enters on the 2.5 mm tip, then C14 (4.7 uF coupling), R5
(5.1 k series) into the node PB2 and PA5 share, with R16 (5.1 k) to ground and C11. Two
finger-hum tests at 16x were run on the 3.5 mm tip by mistake and show nothing about the
receive path. The test to run is a fingertip on the 2.5 mm tip at 16x.

The gain register was written volatile each time and left at 1x; nothing was stored.

## Second AIOC, 2026-10-17

A second AIOC (USB serial f40b162d; the first was 146d3f3a) on the same radio. Serial
programming works. Receive audio does not.

| Test | Result |
|---|---|
| `listen`, squelch 5 | -72 dBFS floor after the first second |
| `listen`, squelch 0 written with `settings` | steady -62.1 dBFS, peak -46 |
| Gain sweep 1x/2x/4x/8x/16x | -62.1, -56.7, -50.8, -44.8, -38.9 dBFS: +6 dB per doubling, 4 to 6 dB above the first unit |
| Spectrum at 1x and 16x | flat broadband hiss, gentle peak 200-800 Hz, most power above 3 kHz, one spur at 16 kHz. No voice-band hump, no mains or USB tones |
| Raw 1x samples | 13 codes, std 1.6 LSB (about 1.3 mV rms at the node), 37k zero crossings in 2 s. The first unit never crossed zero |
| TX loopback, 1 kHz out of the AIOC at 4x RX gain | tone present at 992 Hz, 51 dB below the drive. The ADC path works and the plugs are not cross-wired |
| AIOC host registers | 0xD0 = 0 (no mute, stream idle), 0xD3 = 0xFFFFFFFF (record volume full), 0x72 = 0 (1x) |

Opening the squelch adds 10 dB, so the radio drives the 2.5 mm tip. What arrives is
amplifier hiss at about 1.3 mV with no static behind it. Open-squelch static at mid volume
is hundreds of millivolts.

What the research pass added, from the UV-5R F8 schematic and the AIOC repo:

- Volume pot VR3 feeds the TDA2822 amp, and the amp output drives the 2.5 mm tip through
  R160. The knob sets the tip level. The 2.5 mm socket's switch cuts the internal speaker.
- The MCU switches the amp supply through Q18/Q19 on the MUTE line. The amp is off while
  squelch is closed.
- No source confirms that a squelch written in clone mode applies before a power cycle.
- AIOC register 0x72 holds only RXGAIN in bits 16-19. There is no RX enable or mux.
- AIOC issue 132: intermittent TRS solder joints drop audio on HW 1.2 with FW 1.4.1.

Both cables read the same signature, and this one passes loopback, so the cables are
cleared. The remaining candidates sit on the radio side: volume knob near minimum, the
2.5 mm plug not seated, or the amp still muted after the clone-mode squelch write.

Bench steps, in order, with `uv5r listen --seconds 4` after each:

1. Turn the volume knob to about three quarters.
2. Hold MONI. The amp powers up and static plays regardless of the stored squelch.
3. Power cycle the radio with the AIOC plugged in.
4. Pull and reseat the 2.5 mm plug. If the internal speaker plays with the plug in, the
   plug is not seated.

Static reads above -30 dBFS at 1x and rolls off above 4 kHz.

`listen --seconds 15` fails with "captured 13 of 15 seconds" on this unit; 4 s runs work.
ffmpeg captures asked for 6 s and 8 s returned 5.3 s and 6.4 s.

### Aux block differs from the fixture

Today's dump matches every image taken since 2026-10-13 00:43 in the aux region
0x1EC0-0x1FFF, and all of them differ from the 2026-10-12 fixture at 0x1F00-0x1FBF.
Example at 0x1F60 (VHF squelch thresholds): fixture `00 74 75 76 77 78 79 7a 7b 7c`, now
`00 17 18 19 1a 1b 1c 1d 1e 1f`. The firmware string at 0x1EF0 matches.

A transcript search of every session that touched the radio found no write at or above
0x1800. `restore` reported 382 blocks, the three main-memory ranges. The
fixture was dumped with the same address list `dumpImage` uses, and a CLI dump at
2026-10-12 05:26 local still matched it. The images from 2026-10-13 also differ from the
fixture in places nothing wrote: FM band strings at 0x0F40, the cleared 0x0B10-0x0BDF
block, the factory channels 2-21 gone, and channel contents no command set. Nothing
touched the radio between 2026-10-12 11:12 and 2026-10-13 00:11 local.

Conclusion: the radio on the port since 2026-10-13 is a different unit, or the same unit
after full programming outside these sessions. Same ident, same firmware string. The
settings-block damage and the voice/beep mute of 2026-10-12 belong to the earlier radio.
The hiss-only capture on 2026-10-13 and today belongs to this one. Confirm with the human
which radio is on the bench before reading the 2026-10-12 sections against it.

### Resolved, 2026-10-17 evening

With the volume knob turned up and the AIOC reseated, `listen` at 1x reads -1 dBFS with
68 percent of samples clipped. The spectrogram is broadband noise rolling off above 4 kHz,
which is FM static through the radio's audio low-pass. Receive audio reaches the Mac.
The volume knob was down, or the 2.5 mm plug was short of its contact, on every earlier
capture. Both cables are good.

Squelch written with `settings` applies as soon as the session ends: squelch 3 read -71
dBFS, squelch 0 read -1 dBFS, with no power cycle between.

At full volume the 1x path clips. The knob was set so open-squelch static reads -16 dBFS
RMS with a peak near -6 at 1x, and that is the reference position for every capture.
`listen` reports `peakDbfs` above 0 when the input clips.

### Research pass and skeptic ranking, 2026-10-17

Four agents listed angles (radio jack hardware, radio firmware and EEPROM state, AIOC and
macOS capture chain, measurement strategy) and a skeptic ranked them against the evidence
above. The lists were discarded once the fault was found; the outcome is below.

Dead: every mute, tone, firmware-variant, aux-corruption, demod-fault, AIOC-path, TCC,
loading and plug-detection hypothesis. Squelch applies live, the amp drives the tip at
full scale, both cables pass.

Worth a cheap test, to learn which action fixed it:

1. Knob to minimum, plug untouched, squelch 0, `listen --seconds 4`. About -62 dBFS with
   most power above 3 kHz means the knob caused it. The bare floor means the knob alone
   does not reproduce it.
2. Knob sweep with per-second RMS to get the calibration curve. Steps mean a scratchy pot.
3. Pull the plug about 1 mm at a fixed knob. A fall to the floor means the tip opens short
   of full depth.
4. DC from the AIOC tip pad to sleeve: about 3.6 V with squelch open, 0 V closed (AIOC
   issue 48). This checks seating and amp power without the knob.

Loose ends outside the fault, by value:

1. `listen` level guard: report clipped fraction, warn above 1 percent, warn when squelch-0
   RMS is below -50 ("knob down or plug not seated").
2. Short captures: ffmpeg 9.0.2 avfoundation on macOS 26.7.1 returns 88 percent of the
   requested length from every device, including the built-in microphone. The AIOC reports
   RECRATE 48000 and RECSTATE running. Fixed: `listen` asks ffmpeg for
   `ceil(seconds / 0.88) + 2`, drops frame 0 and keeps frames 1 to `seconds`.
3. Radio identity: store a hash of 0x1F00-0x1FBF with each backup and warn when a dump's
   calibration differs.
4. Aux-read reliability: read a block outside aux first and dump twice. The bench values
   repeat in every dump since 2026-10-13, so a read error does not explain the fixture
   mismatch.
5. The 16 kHz spur sits above the audio low-pass; filter it in analysis.

The tip carries about 3.6 V DC while squelch is open, per AIOC issue 48. C14 blocks it
from the capture.

### HID register tool

Build with `swiftc -O -o aiocreg aiocreg.swift`. `aiocreg read 0x72`, `aiocreg write 0x72 0x00040000`. Writes are volatile.

```swift
import IOKit.hid
import Foundation

// aiocreg read ADDR | write ADDR VALUE   (volatile; no STORE)
let mgr = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
IOHIDManagerSetDeviceMatching(mgr, [kIOHIDVendorIDKey: 0x1209, kIOHIDProductIDKey: 0x7388] as CFDictionary)
IOHIDManagerOpen(mgr, IOOptionBits(kIOHIDOptionsTypeNone))
guard let set = IOHIDManagerCopyDevices(mgr) as? Set<IOHIDDevice>, let dev = set.first else { print("no AIOC HID"); exit(1) }
guard IOHIDDeviceOpen(dev, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess else { print("open failed"); exit(1) }

func report(_ cmd: UInt8, _ addr: UInt8, _ value: UInt32) -> Bool {
  var req: [UInt8] = [cmd, addr, UInt8(value & 0xff), UInt8((value >> 8) & 0xff), UInt8((value >> 16) & 0xff), UInt8((value >> 24) & 0xff)]
  return IOHIDDeviceSetReport(dev, kIOHIDReportTypeFeature, 0, &req, req.count) == kIOReturnSuccess
}
func read(_ addr: UInt8) -> UInt32? {
  guard report(0x00, addr, 0) else { print("set report failed"); return nil }
  var buf = [UInt8](repeating: 0, count: 8)
  var len = CFIndex(buf.count)
  guard IOHIDDeviceGetReport(dev, kIOHIDReportTypeFeature, 0, &buf, &len) == kIOReturnSuccess else { print("get report failed"); return nil }
  return UInt32(buf[2]) | UInt32(buf[3]) << 8 | UInt32(buf[4]) << 16 | UInt32(buf[5]) << 24
}
let a = CommandLine.arguments
guard a.count >= 3, let addr = UInt8(a[2].replacingOccurrences(of: "0x", with: ""), radix: 16) else { print("usage: aiocreg read ADDR | write ADDR VALUE"); exit(2) }
if a[1] == "write" {
  guard a.count >= 4, let v = UInt32(a[3].replacingOccurrences(of: "0x", with: ""), radix: 16) else { print("need VALUE"); exit(2) }
  guard report(0x01, addr, v) else { print("write failed"); exit(1) }
}
if let v = read(addr) { print(String(format: "0x%02X = 0x%08X", addr, v)) }
```

### Bench unit confirmed, 2026-10-24

A read-only `dump` of the radio on the bench differs from the 2026-10-12 fixture in 5 bytes.
The aux block 0x1EC0-0x1FFF matches, 0x1F60 reads `00 74 75 76 77 78 79 7a 7b 7c`, and
the factory channels are present. The 5 bytes sit at 0x0E4A, 0x0E4D, 0x0F1E, 0x0F3F in the
settings area and at 0x1000, the slot 0 name. All of them are addresses the bench verbs write.
The unit on the bench today is the radio the fixture came from. The 2026-10-13 and 2026-10-17
images, with the changed aux block and the cleared channels, came from a second unit. The
2026-10-12 sections apply to today's radio.
