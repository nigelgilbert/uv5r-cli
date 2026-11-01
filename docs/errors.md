# Errors, signals and slot 0

How a failed or interrupted command reports itself, how PTT is guarded, and what slot 0 holds afterwards.

## Error object

In JSON mode a failed command prints nothing on stdout and one error object on stderr. The lines
`hear` printed before a failure stay on stdout, and the error exits with its reason's code. On a
terminal the CLI prints the message and a remedy line as text.

The object has `type`, `kind`, `reason`, `message`, `remedy` and `retry`. Each detail field below
sits at its top level after them and cannot replace them. Act on `reason`, `remedy` and `retry`.

```json
{
  "type": "error",
  "kind": "device-state",
  "reason": "verification-failed",
  "message": "channel 1 record written; name did not take the write",
  "remedy": "read channel 1; rerun the write to fix the name",
  "retry": "after-remedy",
  "failed": ["name"],
  "settings": { "name": { "desired": "446.006", "observed": "" } },
  "wrote": "34 34 36 2e 30 30 36 ff ff ff ff ff ff ff ff ff",
  "read": "ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff ff"
}
```

`kind` follows from `reason` and sets the exit code:

| `kind` | Exit | Reasons |
|---|---|---|
| `usage` | 2 | `invalid-argument`, `station-unconfigured`, `utterance-too-long` |
| `transport` | 3 | `device-unavailable`, `serial-io-failed`, `ptt-control-failed`, `dependency-missing`, `audio-process-failed`, `capture-incomplete`, `file-write-failed`, `speech-engine-failed`, `audio-device-unavailable` |
| `timeout` | 4 | `serial-timeout` |
| `device-state` | 5 | `session-unavailable`, `protocol-reply-invalid`, `radio-unsupported`, `write-unacknowledged`, `verification-failed`, `image-incompatible`, `audio-inactive`, `squelch-open`, `channel-busy` |
| `busy` | 6 | `device-busy` |
| `unexpected` | 1 | `unexpected-error` |

- A `verification-failed` error from `tune`, `load`, `erase` or `settings` adds `failed`, the
  fields that read back wrong, and `settings`, a map from each failed field to
  `{desired, observed}`. `wrote` and `read` hold the bytes as hex. `failed` is empty when the
  bytes differ outside the decoded fields.
- `tune`, `load` and `erase` compare `rxHz`, `txHz`, `txTone`, `rxTone`, `bandwidth` and `power`
  on the record, then `name`. An erase desires `null` for each record field and `""` for the name.
- `settings` compares the setting fields.
- A `load` error from a plan entry write adds `slot`.
- A `sweep` error after the port is requested adds `summary`, the sweep result so far.
- An error inside the sweep loop adds `phase` (`check`, `entry` or `dwell`), `slot` (0),
  `channel` (the plan channel, `null` during the check) and `requestedHz` (the entry frequency
  in Hz, or the `checkMhz` frequency during the check).
- `summary.slot0` says whether a write landed.
- A failed check also carries the check result fields.
- An audio capture error adds `input`, the avfoundation input it captured from.
- A `key`, `say` or `id` error adds `assertedAtMs` and `releasedAtMs` for each PTT change that
  resolved.
- A `volume` error from the squelch write, the read-back, the capture or the restore, after it
  reads a squelch above 0, adds `squelch`, the kept value. The `remedy` writes it back.

## Signals

On SIGINT, SIGTERM, SIGHUP or SIGTSTP (Ctrl-Z) once `key`, `say`, `id` or `sweep` has opened the
port, the verb prints its result on stdout with `interrupted` and no error. It exits 128 plus the
signal number. SIGTSTP exits 146 on macOS and 148 on Linux.

`say` without `--rehearse`, and `id`, do the same for a signal before the port opens, with
`pttAsserted: false`.

A `say` or `id` result after a signal adds `idOwed`. `true` means the player ran past `leadMs`
without finishing the ID. Identify by voice or run `uv5r id`.

A failed PTT release after the signal exits 3 with `interrupted` in the error.

On the same signals `hear` stops capture and closes the open segment. It prints a `backlog`
warning for each segment left untranscribed, lets the segment in inference finish and print,
prints the summary with `interrupted` and exits 128 plus the signal number.

On the same signals `volume` stops the capture, writes the kept squelch back, prints no result
and exits 128 plus the signal number. A failed restore exits with its own error.

Other verbs end on a signal with no output.

## PTT watchdogs

- An uncaught error lowers PTT on any open port and exits 1.
- When a release fails or takes over 1 s, the error says to unplug the AIOC.
- A PTT assertion that runs past 3 s exits 3 with `ptt-control-failed` and says to unplug the
  AIOC.
- A port close past 3 s does the same after a verb succeeds. After a failure the verb keeps its
  own error.

## Slot 0 after check and sweep

Slot 0 is the scratch slot. `check` examples use slot 0 and `sweep` writes only slot 0. `tune` and
`load` write any slot.

Once the `check` write succeeds, the slot keeps the receive-only record, also after a capture
failure. A failure before or during the write leaves the slot state unknown.

After `sweep`, slot 0 keeps the last write and the summary's `slot0` names it:

- `{channel, name}` of the last verified entry write;
- `{channel: null, name}` after only the check write;
- `null` when unknown.

Nothing restores slot 0. Run `uv5r load PLAN.json` to put a plan in its own slots.

Each `sweep` WAV holds a full dwell. A dwell cut short by a signal or a failed capture leaves no
WAV.
