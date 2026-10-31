# Live speech clips at the receiving station

**Status:** 🔴 Open

## Observed

Two-station bench, 2026-10-25, [docs/bench-two-station.md](../docs/bench-two-station.md),
station B notes after round 3.

- Live-mic transmissions from station A arrived at station B peaking at 0 dBFS, RMS -13 to
  -19 dBFS, and clipped.
- Synthesized speech from `say` arrived at about -23 dBFS.
- whisper lost the opening words of every live round and misheard most of round 1.
- `hear` printed no warning for the clipped segments. The only sign was `peakDbfs` 0 in the
  transmission lines.

## How the stations were set up

Both stations set the volume knob by the recipe in `docs/receive.md` and step 4 of the bench
doc: open-squelch static reads -20 to -12 dBFS RMS. Both landed near -10 dBFS.

Station B set the macOS output volume of `AIOC Audio` from 100 to 50 percent by hand during
round 1. Station A left it where it was. Neither value is recorded by the CLI.

## What is known about the signal path

- The AIOC firmware applies the host-side input volume as a digital multiply after the ADC,
  capped at 0 dB. Its analog gain register sits at 1x, the minimum. The radio's volume knob is
  the only control over the level the ADC sees. Source: `tud_audio_set_req_entity_cb` and
  `ADC1_2_IRQHandler` in `stm32/aioc-fw/Src/usb_audio.c` at skuep/AIOC, read 2026-10-30.
- A UV-5R carrying a person speaking close to the mic peaked about 10 dB above the open-squelch
  static level that the recipe targets. The recipe reads RMS of noise and reads no speech peak.
- `listen` warns when 1 percent of samples sit at full scale. `hear` computes the peak of each
  segment and warns on nothing.

## Volume verb, 2026-10-31

`uv5r volume` landed on `feature/volume-verb` with a provisional static band of -28 to -22 dBFS
RMS, [docs/plan-volume.md](../docs/plan-volume.md). The first hardware loop is in
[docs/bench-volume-trial-1.md](../docs/bench-volume-trial-1.md).

- The loop closed in four runs on unit HN5RV011. Static read -29.5 at the starting knob
  position and -27.8 after about a quarter turn clockwise.
- The macOS input volume of `AIOC Audio` at 61 and at 100 percent gave the same static
  reading. The firmware note above predicts a lower reading at 61.
- A quarter turn moved static about 2 dB at that knob position. The instruction sizes in the
  plan assume more.
- The band measurement in the plan's "Setting the band" is skipped. The band stays provisional
  until a two-station session shows live speech clipping or whisper losing words at an `ok`
  position.

## Open questions

- Where a knob setting that keeps live speech under full scale leaves NOAA voice and `say`
  audio, and whether whisper still hears them at that level.
- Whether the level gap between live speech and `say` comes from the sending station's output
  volume, the UV-5R mic path, or both.
- Why the host input volume had no effect on 2026-10-31 when the firmware reading says it
  scales the samples.
