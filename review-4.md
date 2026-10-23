# Review 4: PR #1, feature/improve-cli-for-small-models

Date: 2026-10-23

This review covers the branch at commit 5a3997c. Typecheck is clean and all 358 tests pass. A second reviewer checked each finding against the source and tried to refute it, with a cross-check from Astra. Nothing here breaks in normal use.

Items run from highest to lowest priority. Each one names the code, describes what an agent sees, and gives the fix.

## Findings

### 1. An unplugged cable during a protocol wait exits 13 with no JSON error

Location: [src/protocol.ts:26-29](src/protocol.ts#L26-L29), [src/protocol.ts:66](src/protocol.ts#L66), [src/protocol.ts:78](src/protocol.ts#L78), [src/protocol.ts:140](src/protocol.ts#L140), [src/protocol.ts:169](src/protocol.ts#L169), [src/transport.ts:61](src/transport.ts#L61), [src/main.ts:935](src/main.ts#L935)

This branch unrefs the timer in the shared `sleep` so a sweep that a signal ends during the settle exits at once. Every protocol wait uses that `sleep`: the 3 s handshake retry, the 300 ms ident wait, the 50 ms write-ack waits, and `settle` in [src/check.ts:77](src/check.ts#L77), [src/radio.ts:121](src/radio.ts#L121) and the two sweep settles.

While the port is open, its poller keeps the event loop alive and the unref has no effect. When the cable comes out, the port emits `close`, `fail` records `serial-io-failed`, and the poller goes away. The unref'd timer is then the only pending handle. The loop drains, and the top-level `await cli(...)` ends with Node's "Detected unsettled top-level await" warning and exit 13. The recorded failure never reaches a read, so stdout and stderr carry no error object. On main the timer was ref'd, and the next read threw `serial-io-failed` with exit 3.

This comes from reading the code and from a scratch run of a drained top-level await. It has not been reproduced on the bench.

Failure scenario: an agent runs `uv5r restore radio.img`, and the cable is knocked loose during the post-write settle. The process exits 13 with a Node warning on stderr. Exit 13 is missing from the exit table, so the agent has no reason, no remedy and no idea whether the write landed.

Fix: restore the ref'd timer in `sleep`. In `slotZero`, replace `Promise.race([settle(), stop.stopped])` with a settle that clears its own timer when `stop.stopped` resolves.

### 2. `-h --help` is rejected as `--help given twice`

Location: [src/args.ts:16-19](src/args.ts#L16-L19), [src/args.ts:22-25](src/args.ts#L22-L25), [test/args.test.ts:30-33](test/args.test.ts#L30-L33)

The duplicate-flag check is new on this branch. `-h` sets the same `help` key as `--help`, so `-h --help`, `-h -h` and `--help --help` all throw.

Failure scenario: `uv5r tune -h --help` exits 2 with "--help given twice; pass it once". A wrapper that appends `--help` to a command that already holds `-h` gets the same error and a message naming a flag the user typed once.

Fix: skip the duplicate check for `help`. Keep it for every other flag, since the tests reject a repeated `--json`.

### 3. A failed `dump` leaves an empty image file

Location: [src/main.ts:713-718](src/main.ts#L713-L718), [src/main.ts:314](src/main.ts#L314), [test/cli.test.ts:585](test/cli.test.ts#L585)

Review 3 item 16 proposed the `openSync(out, 'a')` probe and named the empty file as its cost. The `dump` help and a test document that cost. The default output name carries a timestamp, so each failed run adds a new empty file.

Failure scenario: `uv5r dump` with no AIOC plugged in exits 3 and leaves `uv5r-2026-10-23T03-10-00.img` at 0 bytes. Three retries leave three. A later `uv5r restore` on one of them exits 2 with "image too short".

Fix: test `existsSync(out)` before the probe. When the probe created the file and the dump then fails, unlink it. Change the help line to "a new FILE is removed when the read fails" and flip the test. An unconditional unlink would delete an existing `--out` file. An `accessSync` on the directory misses a read-only file and an `--out` that names a directory.

### 4. A dwell cut short by a signal leaves a truncated WAV

Location: [src/sweep.ts:118-120](src/sweep.ts#L118-L120), [src/sweep.ts:222-224](src/sweep.ts#L222-L224), [src/sweep.ts:176-178](src/sweep.ts#L176-L178)

When a signal kills ffmpeg mid-dwell, `listen` rejects, `runSweep` drops the record, and the partial WAV stays in `--out-dir`. A failed capture without a signal leaves the same file.

Every quiet dwell already leaves a WAV that the summary never names, since `summarize` lists `out` for active entries only. The extra file adds little confusion. Astra rated this higher.

Failure scenario: `uv5r sweep plan.json --out-dir rx`, then Ctrl-C ten seconds into channel 5. `rx/ch05-....wav` holds ten seconds. An agent that plays every WAV in the directory may read it as a full dwell.

Fix: capture to `NAME.wav.part` and rename it once `listen` resolves. ffmpeg already takes `-f wav`, so the suffix does not change the muxer. Unlink the part file when `listen` rejects.

### 5. Finished ffmpeg children stay reachable through the stop promise

Location: [src/audio.ts:309](src/audio.ts#L309), [src/audio.ts:333-339](src/audio.ts#L333-L339)

Each capture adds a `.then` handler to `stop.stopped`, which never resolves in a sweep without a signal. The handler holds `child`, and `execFile` keeps the buffered stderr chunks reachable through the child's listeners. Retention matches ffmpeg's real output. stdout stays empty under `-f null -`.

Measured sizes:

- 32 s capture with this filter chain: about 19 KB of stderr.
- 128 entries at 30 s: about 3 MB.
- 128 entries at 600 s: about 50 MB.

On a signal, each stale handler returns at the `exitCode` guard.

Fix: in the `execFile` callback, set a flag the handler checks and drop the `child` reference. A per-capture AbortController on `execFile` leaves the shared-promise subscription in place, drops the SIGKILL escalation, and can call back before ffmpeg exits.

## Checked and left alone

- The `sleep` unref causing a mid-handshake exit 0 with a healthy port. The data listener at [src/transport.ts:55](src/transport.ts#L55) keeps the poller active for every wait, and a drained loop exits 13. Item 1 covers the case that happens.
- One helper for the check sequence in `check` and `sweep`. Review 3 left this alone, and it still holds. Both paths write the same bytes, since `{ rxHz }` and `channelSpec(freq, new Map())` encode the same record through the codec defaults. They share `refuseOpenSquelch`, `receiveOnly` and `judgeCheck`. They differ only in the error detail each attaches and in the sweep's progress updates and signal race.
- The hand checks for `--offset` and `--tone` in `checkVerb` ([src/main.ts:610-614](src/main.ts#L610-L614)). They run before `checkFlags` to give a hint for the two flags most likely carried over from `tune`. The generic message for those flags shows only for `check --help --offset 1`.
- Making every repeated boolean flag a no-op. That undoes the repeated `--json` rejection the tests cover. Item 2 scopes the change to `help`.
