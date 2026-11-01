# Development

The files on the bench, the code layering and the fake radio the tests run against.

## Bench files

- `fixtures/golden/`: CHIRP images of the reference radios, `unit-<n>.img`. Slots 22-127 of
  `unit-1.img` hold a 155.700 record behind an FF first byte and decode as empty.
  - `manifest.json`: each unit's ident, firmware, magic, aux hash and the slots its display
    showed.
  - `unit-<n>.json`: the decoded settings and all 128 slots, written by
    `test/core/golden.test.ts`.
- `channels.example.json`: the reference shape for generated plans.
- `channels.json`: the plan the `channel-plan` skill writes for the current location. Ignored by
  git.
- `uv5r.example.json`: the reference shape for the station config.
- `uv5r.json`: the station config with the callsign. Ignored by git.
- `models/`: the whisper.cpp models `hear` loads. Ignored by git. [receive.md](receive.md) has
  the download steps.
- `models.sha256`: the SHA-256 of both models. Check them with `shasum -a 256 -c models.sha256`.
- `.claude/skills/uv5r/SKILL.md`: the operating rules an agent loads to drive the radio.
- `.claude/skills/channel-plan/SKILL.md`: the research recipe an agent loads to build a channel
  plan for a new location into `channels.json`, shaped like `channels.example.json`.

## Layering

`src/core/` talks to the radio: transport, protocol, codec, radio, plan and errors. `src/cli/`
parses arguments, prints and exits. `cli` imports `core` through `src/core/index.ts`. `core`
imports nothing from `cli`.

`test/core/imports.test.ts` fails on any import path under `src/core/` that contains `cli/`, and
on any `core/` import from `src/cli/` or `test/cli/` other than `src/core/index.ts` and
`test/core/fake.ts`.

`src/tts/` holds the speech code. It imports `core` through `src/core/index.ts` and nothing from
`cli` but `src/cli/audio.ts`. `test/core/imports.test.ts` checks `src/tts/` and `test/tts/` for
both rules.

## The fake radio

`src/core/fake.ts` holds `FakeRadio`, an in-memory radio with the bench behaviour: aligned
reads, acked writes, VFO writes ignored, settings reload on session drop, the 16-byte read alias
in `0x0E10..0x0E4F`, and the staged settings block committed by a write at `0x0E40`.
`test/core/fake.ts` re-exports it for the tests.

### `--target fake`

`--target fake` or `UV5R_TARGET=fake` opens `FakeTransport`, a `FakeRadio` kept in the file
`UV5R_FAKE_STATE` names. No config is needed: `tune`, `status`, `read` and `key` read no
`uv5r.json`. The bench-operator harness runs each verb from the repo root as:

```sh
UV5R_FAKE_STATE=/abs/run/state.json TINYSA_SIM_PTT=/abs/run/ptt.json BENCH_RUN_ID=RUN \
  node src/cli/main.ts tune 446.00625 --channel 3 --low-power --target fake --json
```

A missing state file starts from the `FakeRadio` image with work mode `0x0E4C` set to 1, so
`status` reports `workmode: channel`. Every acked write and every close saves the file:

```json
{ "eeprom": "BASE64 OF 0x2000 BYTES", "tunedSlot": 3, "tuneEndedMs": 1793260328340,
  "freq_hz": 446006250, "power": "low", "lastCommandMs": 1793260328288 }
```

`tunedSlot` is the slot the last channel write hit and stands in for the display. `freq_hz` and
`power` are what transmits until that tune applies. `lastCommandMs` is the last byte of the last
clone session.

The fake keeps the radio's lead time on the real clock. A handshake within 2.5 s of
`lastCommandMs` lands in the old session and gets no ack, so the verb waits 3 s and retries. A
tune applies 3 s after `tuneEndedMs`. Before that, a key reports the values that applied
before, or the slot's values from before the first tune. An empty or receive-only slot reports
`null` for both.

The first `setPtt(true)` of a process writes the file `TINYSA_SIM_PTT` names and rewrites it
every 500 ms while PTT is held. The release that follows stops the rewrites and writes
`ptt: false`. The open and close releases of the clone verbs leave the file alone. Each write
goes to a temp name in the same directory and is renamed over the file:

```json
{ "run_id": "RUN", "written_ms": 1793260320951, "ptt": false, "ptt_on_ms": 1793260319948,
  "ptt_off_ms": 1793260320951, "freq_hz": 446006250, "power": "low" }
```

`ptt_on_ms` and `ptt_off_ms` are the edges of the last key, `null` before an edge. `run_id` is
`BENCH_RUN_ID`, or `null` when it is unset.

`UV5R_FAKE_FAULT` selects one fault:

- `tune-delay:MS`: hold the handshake ack of `tune` for MS.
- `name-not-taken`: ack name writes and drop them, as the bench radio did on 2026-10-29. `tune`
  exits 5 with `verification-failed` and `failed: ["name"]`; `read` shows the new frequency and
  power.
- `tune-wrong-freq`: add 1 MHz to the TX frequency of each channel record write. `tune` exits 5
  with `verification-failed` and `failed: ["txHz"]`; the next `read` and key report the shifted
  `txHz`.
- `ptt-control-failed`: fail the DTR set that raises PTT. `key` exits 3 with
  `ptt-control-failed` and `retry: no`, and the PTT file stays as it was.
- `hang`: hold PTT on `key` past `--seconds` until SIGINT, SIGTERM, SIGHUP or SIGTSTP arrives,
  or the watchdog fires 5 s after the hold. A signal releases PTT and the result carries
  `interrupted`. The watchdog releases PTT and the result carries `timedOut: true` and
  `released: true`. Both releases write `ptt: false` to the PTT file.
