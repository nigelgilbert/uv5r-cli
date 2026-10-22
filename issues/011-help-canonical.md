# CLI help is the canonical reference

**Type**: AFK

**Status:** 🔄 Implemented, awaiting review

## Parent

review.md, work item 4.

## What to build

The `verbs` table holds each verb's usage, flags with defaults, effects, preconditions, writes-to-radio, result example and exit cases. Text help, `help VERB` and `help --json` generate from it. `help --json` carries the operating rules (check-first, the scratch slot, the channel rule), exit-code guidance that points at each error's `reason` and remedy, flag defaults and a schema version.

An unknown verb returns `unknown verb "X"; verbs: status, tune, ...; run uv5r help VERB`, under 300 bytes. `-h` means `--help`. `--version` prints the version from package.json. An unknown help subject and a bare unknown flag exit 2. A repeated flag exits 2. `--floor` is bounded to -100..0.

One channel rule in help, README and SKILL.md, in the same words: `--channel N` writes memory slot N. The radio receives slot N after the reload when it is in MR mode with N selected on the active display line. The display may show a name or a frequency. The CLI cannot read the display, so ask the human when it matters which channel the radio is on.

## Acceptance criteria

- [x] `help tune --json | jq .` parses and holds usage, flags, effects, preconditions, writes-to-radio, a result example and exit cases
- [x] `help --json` holds the operating rules, exit-code guidance, flag defaults and a schema version
- [x] The unknown-verb error is under 300 bytes
- [x] `tune 154.68 --channel 1 --channel 2` exits 2 before the port opens
- [x] `listen --seconds 5 --floor 100` exits 2
- [x] `--version` prints the package version; `-h` prints help; `help nonsense` exits 2
- [x] Help, README and SKILL.md state the channel rule in the same words
- [x] `npm test` and `npm run typecheck` pass

## Blocked by

- #009
- #010

## Result

Files changed:

- `src/help.ts` (new): `VerbDoc`, `FlagDoc`, `ArgDoc`, `ExitCase`, `HELP_SCHEMA_VERSION`, and the text and JSON renderers.
- `src/main.ts`: the `verbs` table holds each verb's summary, example, arguments, flags with defaults, effects, preconditions, `writesToRadio`, result example and exit cases. Text help, `help VERB`, `VERB --help`, `-h` and `help [VERB] --json` render from it. Per-verb `checkFlags` lists and `BOOLEAN_FLAGS` derive from the table. Adds `CHANNEL_RULE`, the operating rules, exit-code guidance, `--version`, the unknown-verb and unknown-help-subject errors, the top-level unknown-flag check and the `--floor` bound.
- `src/args.ts`: `-h` sets `help`; a repeated flag throws a UsageError naming it. Unknown-option errors add `run uv5r help VERB` and a `flag` detail.
- `package.json`: `"version": "0.1.0"`.
- `README.md`, `.claude/skills/uv5r/SKILL.md`: the channel rule replaces the "parked on" phrasing; the `--channel` row points at it; help, `--version`, `-h`, repeated-flag and `--floor` range lines.
- Tests: `test/cli.test.ts`, `test/args.test.ts`, `test/listen-cli.test.ts`, `test/check.test.ts`, `test/sweep.test.ts`.

Deviations:

- `help` and `--version` print text on a pipe and JSON only with an explicit `--json`. The overview stays readable for an agent running `uv5r help` through Bash, and `test/parse.test.ts` expects text on a pipe.
- The unknown verb in the error is cut to 40 characters to keep the error under 300 bytes for any input.
- The settings field table moved from the overview to `help settings`, under `fields`.

Review fixes:

- `VERB --help` runs `checkFlags` against the verb's flags plus `help`, and
  `checkPositionals`, before it prints. `status --bogus --help` and `status extra --help`
  exit 2. `uv5r help VERB` is unchanged.
- `RULES` adds `oneVerb`, `clone` and `speaker`. The three earlier rules keep their words.
  The `help.rules` test lists all six.
