# Review: PR #3, feature/clone-protocol

Branch `feature/clone-protocol` against `main`. Typecheck passes and all 553 tests pass on HEAD. No correctness, wire or timing bug was found. The findings below are wording, docs and cleanup, most severe first.

## Findings

### 1. Session-unavailable message contradicts its answers list

`src/core/radio.ts:321`

The message reads "opened no clone session and answered no foreign or 115200 program magic: ${answers}". The answers list can hold foreign wrong-acks, refusals and invalid idents (`radio.ts:211-212`) and 115200 wrong-acks (`radio.ts:296`).

Example: the radio sends 15 to the BTECH UV-5X3 foreign magic and to PROGRAMBFNORMALU at 115200. The message says it answered neither, then lists both answers.

Fix: change the text to "opened no clone session; answers: ${answers}".

Resolved: the message reads "opened no clone session; answers: ${answers}".

### 2. README gives one wrong-ack pause for every case

`README.md:249`

The README says "A wrong ack pauses 2 s". Two cases differ:

- The first magic retries after `SETTLE_MS`, 3 s, after a wrong ack (`radio.ts:243`).
- A wrong ack at 115200 waits `PROGRAM_PAUSE_MS`, 1 s (`radio.ts:297`).

The identify help (`src/cli/main.ts:223`) and the docstring (`radio.ts:227`) already state the 3 s first-magic retry. Fix: add both cases to the README sentence.

Resolved: the README states the 3 s first-magic retry, the 1 s pause at 115200 and the 2 s pause for other wrong acks. The identify help already stated each case.

### 3. UV-5G Mini named under two magics with no firmware split

`src/core/ident.ts:54` and `:58`

PROGRAMCOLORPROU and PROGRAMGMRS5RMIU both list "UV-5G Mini". `README.md:234/238` and `docs/clone-protocol.md:515/519` give fw 0.01 and fw 0.05. The radio-unsupported error names the same model for both magics and drops the firmware hint.

Fix: write "UV-5G Mini fw 0.01" and "UV-5G Mini fw 0.05" in the two strings.

Resolved: removed UV-5G Mini. PROGRAMGMRS5RMIU is gone and PROGRAMCOLORPROU no longer names it. PROGRAMBFGMRS05U, PROGRAMBF5RTECHU and PROGRAMBF-K6PROU are also gone, since they name no UV-5R. The 115200 phase keeps PROGRAMBFNORMALU and PROGRAMCOLORPROU, and the silent scan takes about 29 s.

### 4. Contrastive wording in comments and one runtime message

- `src/core/ident.ts:100`: "The voice prompt setting is on/off instead of a language list." Write "The voice prompt setting is on/off."
- `src/core/ident.ts:102`: "The second band is 220-260 MHz in place of UHF." Write "The second band is 220-260 MHz."
- `src/core/protocol.ts:156`: "answered the clone handshake with ${got} in place of 06". This message is new on the branch. Update the expectation at `test/core/radio.test.ts:200` with it.

Resolved: both comments use the suggested text. The handshake message reads "answered the clone handshake with ${got}", and the test expectation matches.

### 5. Review doc names a removed constant

`docs/clone-protocol-review.md:22`

The line says identify "owes `SCAN_SILENT_PAUSE_MS` or `SETTLE_MS` before the next attempt". Commit d827632 removed `SCAN_SILENT_PAUSE_MS`. Silence now gets no pause, and a wrong ack waits `SCAN_WRONG_ACK_PAUSE_MS` (`radio.ts:214`).

Fix: update the line to the current pauses, or mark the section as describing an earlier stage of the branch.

Resolved: the line names no pause after silence, `SCAN_WRONG_ACK_PAUSE_MS` after a wrong ack and `SETTLE_MS` after an invalid ident or a refused closing `06`.

### 6. Dead BASETYPES entry

`src/core/ident.ts:67`

`{ family: 'uv-82x3', strings: ['HN5RV01'] }` never matches. UV82 is the only magic that lists `uv-82x3` (`ident.ts:29`), and `HN5RV01_FAMILY` returns `uv-82x3` for UV82 before the loop runs (`ident.ts:82,149`).

Fix: delete the entry.

Resolved: deleted the entry. The basetype test drops its two cases for it.

### 7. Core barrel exports names the CLI does not use

`src/core/index.ts:5` and `:8`

The barrel now exports `attempt`, `BASETYPES`, `DTMF_TABLES`, `parseIdent`, `classify` and `MAGICS`. No code in `src/cli` or `test/cli` imports them. The core tests import them from `ident.ts` and `protocol.ts` directly. `attempt` sends one handshake and leaves the radio in clone mode with no session.

Fix: remove the unused names from the barrel.

Resolved: removed the six names and the `AttemptOutcome` and `ParsedIdent` types from the barrel.

### 8. PROGRAM_MAGICS drops its names (optional)

`src/core/ident.ts:53-59`

Each entry starts as an ASCII name and keeps only the bytes. Three places decode the name back with `Buffer.from(...).toString('latin1')`: `src/core/radio.ts:281`, `src/cli/main.ts:227` and `test/core/ident.test.ts:64`.

Fix: add a `name` field to each entry, as the classic `Magic` type has, and read `entry.name`.

Resolved: each entry has a `name` field. The three decodes and the two in `test/core/radio.test.ts` read `.name`.

## Dropped

- Duplicate magic lookups in `radio.ts:220,238`. `magicByName` rejects unsupported magics (`ident.ts:120-125`), so it cannot serve the scan lookup. The remaining duplication is a few lines.
- Public `Session.finish`. It has one internal caller (`radio.ts:249`), its docstring states the confirmed-handshake precondition (`protocol.ts:160-164`), and misuse fails at the first block-header check (`protocol.ts:205-207`).

## Follow-ups from the adversarial review

- `docs/clone-protocol-review.md:8`: dropped the stale test count.
- `README.md`: deleted "A wrong ack at 115200 pauses 1 s"; the timing table covers it.
- `test/core/radio.test.ts`: the 115200 wrong-ack test asserts the full session-unavailable message.
- `test/core/ident.test.ts`: added HN5RV011 with A58, which gives `bf-f8hp` from `N5RV`; the PROGRAM_MAGICS test checks the bytes decode to `name`.
- `src/core/index.ts`: removed `Classification`.
