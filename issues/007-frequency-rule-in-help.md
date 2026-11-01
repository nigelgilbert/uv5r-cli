# State the frequency rule in the help catalog

**Type**: AFK

**Status:** Done, 684511f

## Parent

`../bench-operator/docs/decisions-2026-11-01.md`, item 4b.

## What to build

`parseFrequency` in `src/core/codec.ts` already reads a number below 1000 as MHz and anything else as Hz. The help catalog does not say so. The shared sentence, word for word in both CLIs:

> A frequency is MHz when below 1000, else Hz. 144.684, 144684000 and 144.684e6 are the same value. Results are Hz integers.

Add it under `rules` as `frequency` in `src/cli/main.ts`. Set `FREQ_ARG.help` at line 190 to "MHz below 1000, else Hz; 136-174 or 400-520 MHz, 10 Hz steps", which `tune` and `check` share. `--offset` takes the same rule: parse it as `parseFrequency` does, keeping the sign, so `-0.6`, `-600000` and `-600e3` are the same offset. Set its flag value to `FREQ` and its help to "signed repeater offset, as in -0.6". The `bad frequency` usage error in codec.ts line 101 adds the first clause of the rule. State the rule once in README.md. tinysa-cli #010 adds the same sentence to its catalog.

## Acceptance criteria

- [ ] `uv5r help --json | jq .rules.frequency` prints the shared sentence.
- [ ] `uv5r help tune --json` and `uv5r help check --json` show the new `FREQ` text.
- [ ] `uv5r tune 0 --channel 1 --target fake --json` exits 2 and the message names the rule.
- [ ] `uv5r tune 146.52 --channel 1 --offset 600000 --target fake --json` and `--offset 0.6` write the same TX frequency.
- [ ] README states the rule once. `npm run typecheck` and `npm test` pass.

## Blocked by

- #012, which drops the help byte budgets
