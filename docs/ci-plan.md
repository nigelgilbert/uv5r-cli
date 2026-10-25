# Plan: run the unit tests in GitHub Actions

Status: planned 2026-10-25 on `feature/ci`. PR #3 merged, and `main` is merged into the branch at
`1271e2e`. Start item 1. Draft PR #4 tracks the branch.

## Goal

Every push to `main` and every pull request runs `npm run typecheck` and `npm test` on a
GitHub-hosted runner. A failing run blocks the merge.

The suite needs no radio, AIOC or microphone. `test/core/fake.ts` stands in for the radio, and
the tests mock `serialport` and `node:child_process`, which covers ffmpeg and afplay. Tests that
need hardware plugged in go in a top-level `e2e/` folder. `vitest.config.ts` includes only
`test/**/*.test.ts`, so CI leaves `e2e/` out with no config change.

## Cost

The repo is public. Standard GitHub-hosted runners on every OS are free and unlimited for public
repos. Larger runners are billed. `runs-on` uses `ubuntu-latest` only, since the suite mocks the
macOS-only afplay and already runs on macOS locally.

## Baseline

The suite at `ee631ea`, three commits before PR #3's tip, passed on macOS, in a Linux `node:24` container as a
non-root user, under CPU contention, and with `CI=true`. It has not run on a GitHub runner.

- `ubuntu-latest` ships Node 22. `parse.test.ts`, `args.test.ts` and `key.test.ts` spawn
  `node src/cli/main.ts`, which needs Node 24's type stripping.
- `npm ci` needs no apt packages. `serialport` and `typescript@7` ship linux-x64 binaries, and
  `package-lock.json` already lists them.
- The workflow's action SHAs were resolved with `gh api` on 2026-10-25.

## Agent work items

An agent does items 1 to 5 on `feature/ci`. Nigel does items 6 to 10.

Leave `src/`, `test/` and `vitest.config.ts` unchanged. If a test fails, report the test name
and its log excerpt, and stop.

### 1. Run the suite locally on Node 24

Run `node --version` and confirm it prints v24. Then run:

```sh
npm ci
npm run typecheck
npm test
```

Stop and report if any command fails.

### 2. Add the workflow

Create `.github/workflows/ci.yml` with this content, copied verbatim:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

- The SHAs pin each action to one commit. A tag such as `v7` can be moved.
- `node-version: 24` matches `engines` and the baseline.
- `cache: npm` is set explicitly. setup-node v7 caches on its own only when `package.json`
  sets `packageManager` or `devEngines.packageManager`.
- `timeout-minutes: 10` stops a hung run. The default is 6 hours.
- `concurrency` cancels an older PR run when a new commit lands. A running `main` run finishes. A
  queued `main` run gives way to a newer push, so the badge shows the latest merge.
- `pull_request` runs fork code with a read-only token and no secrets. Leave
  `pull_request_target` out. It runs with the repo's secrets, so checking out PR code there
  exposes them.

### 3. Lint the workflow

Run `brew install actionlint`, then `actionlint` from the repo root. Fix every finding.

Commit items 2 and 3 alone: `Add CI workflow for typecheck and tests`.

### 4. Ready PR #4 and watch the run

```sh
git push
gh pr edit 4 --title "Run typecheck and tests in GitHub Actions"
gh pr ready 4
gh pr checks 4 --watch
```

Rewrite the PR #4 body with `gh pr edit 4 --body` to summarize the plan, the workflow, Dependabot
and the README lines. End it with the session's attribution line.

The PR page shows the check as `ci / test`. On failure, read the log with
`gh run view <run-id> --log-failed`. If a test failed, report it and stop. If the workflow
failed, fix `.github/workflows/ci.yml`, push, and watch again. After a second workflow
failure, stop and report.

### 5. Add Dependabot and the README lines

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
    open-pull-requests-limit: 0
```

Dependabot opens a PR when a pinned action has a new release, and rewrites the SHA and its
version comment. For npm, `open-pull-requests-limit: 0` turns off version updates, so only
security updates open PRs once item 7 is done.

In `README.md`, insert this badge on a new line after `# uv5r-cli`, with a blank line before
and after it:

```md
[![ci](https://github.com/nigelgilbert/uv5r-cli/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nigelgilbert/uv5r-cli/actions/workflows/ci.yml)
```

In `## Development`, add this sentence after the code block: "GitHub Actions runs both commands
on every push to `main` and every pull request."

Commit both files: `Add Dependabot for actions and a CI badge`. Push and run
`gh pr checks --watch` again.

Stop when the check is green. Leave the merge and the repo settings to Nigel.

## Nigel's steps

### 6. Require the check on `main`

Do this after item 4's run and before merging, so the ruleset gates this PR too.

Go to Settings → Rules → Rulesets → New branch ruleset. Target the default branch. Leave the
bypass list empty. Turn on "Require a pull request before merging" with required approvals at 0,
so you can merge your own PRs. Turn on "Require status checks to pass", add `test`, and leave
"Require branches to be up to date" off. Set Enforcement to Active. The check appears in the
picker only after it has run once. The pull request rule sends every change through a PR.

### 7. Turn on Dependabot security updates

Go to Settings → Advanced Security. Enable Dependabot alerts, then Dependabot security updates.
Both were off on 2026-10-25.

### 8. Merge PR #4

### 9. Bring PR #5 onto CI

Merge `main` into `feature/speech-plan` and push. PR #5 runs CI from then on.

### 10. Cap Actions spending at $0 (optional, any time)

At https://github.com/settings/billing, open Budgets and alerts → New budget. Pick
Product-level, Actions, $0, and tick "Stop usage when budget limit is reached". Without a
payment method on file, GitHub already blocks billed usage.

## Deferred

- If a wall-clock bound flakes on the runner, move that test to `vi.useFakeTimers`. The bounds
  are at `test/cli/key.test.ts:26`, `:38`, `:40` and `test/core/transport.test.ts:96`, each
  under 500 ms.
