# Review: core and cli split

Branch `feature/core-cli-split` (PR #2), base `main`. Reviewed by Claude and GPT-6.1 Sol in 1 of 3 cycles.

## Findings

### 1. [docs/clone-protocol-plan.md:259](docs/clone-protocol-plan.md#L259) — low

**Defect.** The handshake plan puts snapshot tests in `test/cli.test.ts`, a root path the split removed, and the path-change list at [docs/core-cli-split-plan.md:88-102](docs/core-cli-split-plan.md#L88-L102) omits it.

**Failure.** The PR 3 agent creates `test/cli.test.ts` at the test root. [test/core/imports.test.ts:29](test/core/imports.test.ts#L29) scans only `src/cli/` and `test/cli/`, so a core-internal import in that file goes unchecked.

**Fix.** Change `:259` to `test/cli/cli.test.ts`. Optionally rewrite `:80`, `:97`, `:236` and `:237` to `src/core/ident.ts` and `test/core/ident.test.ts`, and widen the scan to all of `test/` except `test/core/`.

### 2. [docs/core-cli-split-plan.md:3](docs/core-cli-split-plan.md#L3) — low

**Defect.** The plan still says "No code yet", [docs/core-cli-split-review.md:3](docs/core-cli-split-review.md#L3) says "Status: open" after commits 0d13f69, 0cd3c4d and c30aa59 fixed review findings 1 to 4, and [README.md:222](README.md#L222) describes only the core-side check in `imports.test.ts`.

**Failure.** A reader on main takes the split as unimplemented and the review findings as outstanding. The README omits the cli-side check at [test/core/imports.test.ts:28](test/core/imports.test.ts#L28).

**Fix.** Mark the plan implemented. Mark review findings 1 to 4 fixed with their commits, and leave finding 5 and the "Not run" bench check open. Add a clause to `README.md:222` saying the test also fails on a `core/` import from `src/cli/` or `test/cli/` that bypasses `src/core/index.ts`.

### 3. [docs/grill-handshake-brief.md:15](docs/grill-handshake-brief.md#L15) — low

**Defect.** The brief says the split "lands as PR 1" and the handshake "as PR 2", while on GitHub PR #1 is an earlier merged PR and PR #2 is this split.

**Failure.** An agent briefed from this doc reads "PR 2" as the handshake work and opens the split PR.

**Fix.** Write "first work item" and "second work item", or use the real numbers: #2 for the split, #3 for the handshake.

## Cut

- Root-level test files escape the import scan: merged into finding 1, since the stale plan path is the only way one would appear.
- Mocks of core modules bypass `index.ts`: speculative. Current mocks target `serialport`, `node:child_process` and `cli/audio.ts`.
- `index.ts` lacks `TransportReason`, `DeviceStateReason` and `MAGIC`: speculative. No cli code needs them, the surface matches [docs/core-cli-split-plan.md:74-81](docs/core-cli-split-plan.md#L74-L81), and `core/testing` is a listed follow-up.
- Hand-written `EXIT_CODES` duplicates `EXIT`: pre-existing at `main:src/main.ts:96` beside `main:src/errors.ts:6`. The split only moved `EXIT` into `src/cli/exit.ts`.
- `cli/args.ts` re-exports `parseDecimal` without core coverage: plan item 3 at [docs/core-cli-split-plan.md:115](docs/core-cli-split-plan.md#L115) asks for the re-export. [test/core/codec.test.ts:65](test/core/codec.test.ts#L65) covers it through `parseFrequency` and [test/core/plan.test.ts:21](test/core/plan.test.ts#L21) through plan offsets.
