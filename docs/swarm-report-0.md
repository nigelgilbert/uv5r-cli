# Swarm report 0: issues 007 to 012

Base commit 6ea47bb. One pass, no validation round. Two Opus agents: one for the skill file, one for the five issues that share `src/cli/main.ts` and `test/cli/cli.test.ts`. Final commit carries 990 tests, up from 982, with typecheck clean.

## Per item

### #012 Drop the size caps and read --offset by the frequency rule

Commit a59dd39. Files: `src/cli/main.ts`, `test/cli/cli.test.ts`, `README.md`.

The 4096, 3072 and 340 byte assertions and the SKILL.md 60-line test are gone, with the `SKILL` constant. The flag-name test keeps its check under the name "lists the same flag names in the catalog as in each verb's help". The unknown-verb test keeps the no-help-text check. `parseOffset` in main.ts reads the magnitude as MHz below 1000, else Hz, keeps the sign, then applies `checkTenHz`. `--offset -600000`, `-600e3` and `-0.6` all write txHz 146220000 for 146.82 on the fake radio.

### #010 Align the key verb with rules.transmit

Commit c9b0c82. Files: `src/cli/main.ts`, `README.md`, `test/cli/say-cli.test.ts`, `test/cli/cli.test.ts`.

`KEY_ID_RULE` holds the key ID sentence. `TRANSMIT_RULE` and the `key` verb's `effects` both include it. README carries the rule word for word. The say-cli test checks the full literal text.

### #011 Name UV5R_FAKE_STATE in the --target help

Commit de837b8. Files: `src/cli/main.ts`, `test/cli/cli.test.ts`.

`--target` help reads "serial device, or fake; fake reads and writes the state file UV5R_FAKE_STATE names".

### #007 State the frequency rule in the help catalog

Commit 684511f. Files: `src/cli/main.ts`, `src/core/codec.ts`, `README.md`, `test/cli/cli.test.ts`.

`rules.frequency` prints the shared sentence. `FREQ_ARG.help` is "MHz below 1000, else Hz; 136-174 or 400-520 MHz, 10 Hz steps" for `tune` and `check`. `--offset` has value `FREQ` and help "signed repeater offset, as in -0.6". `tune 0` exits 2 with `bad frequency "0"; a frequency is MHz when below 1000, else Hz`. README states the rule once under Output and errors.

### #009 Match the tinysa help catalog shape

Commit 27d22c6. Files: `src/cli/help.ts`, `test/cli/cli.test.ts`, `test/cli/hear-cli.test.ts`.

`usageLine` lists positionals, then every flag in array order, required bare and optional in brackets. An exclusive pair prints as one group with a bar: tune shows `[--offset FREQ | --rx-only]`. Catalog, `help VERB` text and JSON share the line. `key` reads `uv5r key --seconds S [--json] [--target PATH]`. `SCHEMA_VERSION` is 4. A test pins the key, settings, restore and tune lines and checks that the catalog and each verb's help agree.

### #008 The uv5r skill carries one transmit section

Commit 7c61c3a. File: `.claude/skills/uv5r/SKILL.md`.

A `## Transmit` section names `key`, `say` and `id`, Ctrl-C, `say --rehearse`, `uv5r id` after a key and `idOwed: true`. The old bullets under Ask the human and On a failed command are gone. The file is 43 lines.

## Test command and result

```
npm run typecheck   clean
npm test            37 files, 990 tests passed
```

## Findings dropped and why

- #012 and #007 give different help text for `--offset`. #007 is the later decision and its text landed: "signed repeater offset, as in -0.6". The rule lives once under `rules.frequency`.
- #008 says SKILL.md stays at most 60 lines as the test checks. #012 deleted that test. The file is 43 lines.
- The #010 clause "at the end of the transmission and every ten minutes" stays out of SKILL.md. The issue's own bullet text for the section omits it, and `rules.transmit` carries it.

## Open items

- tinysa-cli #010 and #011 add the same frequency sentence and usage form on their side.
- bench-operator #020, #022 and #023 link the skill section, move the harness contract to schema 4, and send the ID around key runs.
