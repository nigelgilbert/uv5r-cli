# Errors, signals and slot 0

How a failed or interrupted command reports itself, how PTT is guarded, and what slot 0 holds afterwards. `uv5r help --json` lists every reason with its exit code and retry meaning under `errors`.

## Error object

In JSON mode a failed command prints nothing on stdout and one error object on stderr. The lines
`hear` printed before a failure stay on stdout, and the error exits with its reason's code. On a
terminal the CLI prints the message and a remedy line as text.

The object has `reason`, `message`, `remedy` and `retry`. Each detail field below sits at its top
level beside them. Act on `reason`, `remedy` and `retry`.

- A `load` error from a plan entry write adds `slot`.
- A `sweep` error after the port is requested adds `summary`, the sweep result so far.
- An error inside the sweep loop adds `phase` (`check`, `entry` or `dwell`), `slot` (0),
  `channel` (the plan channel, `null` during the check) and `requestedMhz` (the entry frequency,
  or the `checkMhz` frequency during the check).
- `summary.slot0` says whether a write landed.
- A failed check also carries the check result fields.

## Signals

On SIGINT, SIGTERM, SIGHUP or SIGTSTP (Ctrl-Z) once `key`, `say`, `id` or `sweep` has opened the
port, the verb prints its result on stdout with `interrupted` and no error. It exits 128 plus the
signal number. SIGTSTP exits 146 on macOS and 148 on Linux.

`say` without `--rehearse`, and `id`, do the same for a signal before the port opens, with
`pttAsserted: false`.

A `say` or `id` result after a signal adds `idOwed`. `true` means the player ran past `--lead`
without finishing the ID. Identify by voice or run `uv5r id`.

A failed PTT release after the signal exits 3 with `interrupted` in the error.

On the same signals `hear` stops capture and closes the open segment. It prints a `backlog`
warning for each segment left untranscribed, lets the segment in inference finish and print,
prints the summary with `interrupted` and exits 128 plus the signal number.

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
