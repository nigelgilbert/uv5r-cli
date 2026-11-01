# Align the key verb with rules.transmit

**Type**: AFK

**Status:** Done, c9b0c82

## Parent

`../bench-operator/docs/decisions-2026-11-01.md`, item 2.

## What to build

`rules.transmit` in `uv5r help --json` says "Each one ends with the uv5r.json callsign." `key` raises PTT and sends no ID. Against the fake radio:

```
$ uv5r key --seconds 1 --target fake --json
{"pttAsserted":true,"seconds":1,"released":true,"assertedAtMs":1793518116640,"releasedAtMs":1793518117641}
```

`key` stays a carrier test with its current result shape. The rule changes to describe the verbs as they are. The bench harness sends the ID around key runs in bench-operator #023.

- Reword `TRANSMIT_RULE` in `src/cli/main.ts`. Keep the control-operator and license sentences. Replace "Each one ends with the uv5r.json callsign." with: "`say` and `id` end with the uv5r.json callsign. `key` sends a carrier and no ID; send the callsign after it with `uv5r id` or by voice, at the end of the transmission and every ten minutes."
- Apply the same text in `README.md` line 93, which carries the rule word for word.
- Add the ID sentence to the `key` entry's `effects` so `help key` says it on its own.
- Update the test that checks the rule text.

## Acceptance criteria

- [ ] `uv5r help --json | jq .rules.transmit` prints the new wording, and README matches it.
- [ ] `uv5r help key --json` names `uv5r id` in `effects`.
- [ ] `npm run typecheck` and `npm test` pass.

## Blocked by

- #012, which drops the help byte budgets
