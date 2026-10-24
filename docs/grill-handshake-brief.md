# Grill brief: clone handshake plan

Status: brief for a grill session, 2026-10-23. Delete after the grill.

## Read first

- [clone-protocol-plan.md](clone-protocol-plan.md). The plan under review.
- [clone-protocol.md](clone-protocol.md). The spec the plan implements.
- [core-cli-split-plan.md](core-cli-split-plan.md), section "Where the handshake engine lands". Path and API changes the split imposes on the plan.

Skip `docs/chirp-notes/`. The clean-room boundary keeps Chirp-derived text out of any session that shapes code.

## Context

- Branch `feature/core-cli-split` holds the docs at `78bda2d`. The split lands as PR 1; the handshake plan lands as PR 2 on top of it.
- One radio on the bench: UV-5R, firmware `HN5RV011`, answers the 291 magic, AIOC on `/dev/cu.usbmodemf40b162d5`.
- Today's code sends one magic and knows one firmware family.

## Decisions to stress

1. The scan lives in `identify`. Every other verb keeps two attempts of one magic.
2. `UV5R_MAGIC` is an environment variable. A flag waits for a second radio.
3. The first ack wins. Open bench question 2 decides whether that holds.
4. A pause after every failed attempt. Open bench question 1 decides the budget.
5. The 115200 probe runs after every 9600 attempt fails. Open bench question 6 is untestable here.
6. The UV-6 and F-11 are recognized and refused.
7. `restore` keeps its current checks.

## Bench answers in hand

None yet. Questions 1 and 2 in the plan need a throwaway probe script; today's code cannot send a chosen magic.

## Wanted from the grill

- A verdict on decisions 1 through 5.
- The issue split. Proposed slices: ident tables and classify; `Session.start(magic)` and the env var; the `identify` verb and probe.
- Remedy text for a verb failure that should send the user to `identify`.
