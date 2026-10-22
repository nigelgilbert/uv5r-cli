# key reports what it did

**Type**: AFK

**Status:** 🔄 Implemented, awaiting review

## Parent

review.md, work item 3.

## What to build

`key` results replace `keyed` with `pttAsserted` and track assertion and release separately. `pttAsserted: true` follows a successful assertion and `false` means it was unconfirmed. `released: true` follows a successful release. On a failure the JSON error carries `pttAsserted`, `released` and `phase`. An unconfirmed release tells the human to unplug the AIOC. The error gives no automatic retry advice.

`help key` and SKILL.md state that `key` raises PTT on the channel the display shows, that the CLI cannot read that channel, and that a receive-only slot radiates nothing. The agent asks the human for the display before keying. The NOAA entries in `channels.example.json` get `rxOnly: true`.

## Acceptance criteria

- [x] A fake transport whose release fails after a successful assertion yields `pttAsserted: true`, `released: false`, a `phase` and a nonzero exit
- [x] A fake whose assertion and release both fail yields `pttAsserted: false`, `released: false`
- [x] A successful key prints `pttAsserted: true`, `released: true` and `seconds`
- [x] `load channels.example.json` writes NOAA records with `txMhz: null`
- [x] `npm test` and `npm run typecheck` pass

## Blocked by

None - can start immediately

## Result

Files changed:

- `src/radio.ts`: `holdPtt` tracks `pttAsserted` and `released` separately and returns `{pttAsserted, seconds, released, interrupted?}`. A failed step throws a `TransportError` (exit 3) whose detail carries `pttAsserted`, `released`, `phase` (`assert`, `hold` or `release`, the first step that failed), plus `seconds` after an assertion and `interrupted` after a signal. An unconfirmed release tells the human to unplug the AIOC.
- `src/main.ts`: `keyVerb` prints the `holdPtt` result. The `key` summary and a line under `--seconds` state the display rule and the receive-only rule.
- `.claude/skills/uv5r/SKILL.md`: the `key` rule only.
- `channels.example.json`: `rxOnly: true` on the three NOAA entries.
- `README.md`: the `key` result sentence names the new fields.
- `test/key.test.ts`, `test/cli.test.ts`: release failure, double failure, assertion-only failure, success shape, help text, NOAA `txMhz: null` on `load`.

Deviations:

- `README.md` was outside item 3. Its `key` result sentence named `keyed`, so it changed with the rename.
- The `hold` phase exists in the type; no current code path fails during the hold.

Review fixes: `keyVerb` catches errors from `withTransport`. An error whose detail lacks
`pttAsserted`, such as a missing device or a failed PTT release while the port opens, gains
`pttAsserted: false`, `released: false`, `phase: 'open'` and `retry: 'no'`. `KeyPhase` adds
`open`. The `help key` exit 3 case names no device and a serial error, and says `phase` is
`open` when the port did not open. Tests in `test/cli.test.ts` and `test/key.test.ts`.
