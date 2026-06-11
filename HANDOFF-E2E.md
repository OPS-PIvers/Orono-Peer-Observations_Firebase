# Handoff: finish wiring the Playwright e2e suite into CI

**Context:** Final task of the June 2026 MVP→production push (161/161 audited gaps shipped;
`dev-paul` is fully CI-green through commit `d834f66`). An implementation agent was stopped
mid-task by a forced machine restart; its **unvalidated WIP** is committed on this branch
(`e2e-ci-wip`). This file is the complete brief — the original session is not available.

## Goal

Add an `e2e` job to `.github/workflows/ci.yml` that runs the existing Playwright suite
(`apps/web/e2e/*.spec.ts`, desktop + iPad projects) against the **Firebase emulator stack**,
and land everything on `dev-paul` only once CI is fully green.

## State of this branch

WIP from the stopped agent (committed as-is, UNVALIDATED — review before trusting):

- `apps/web/e2e/*.spec.ts` (4 specs) + `apps/web/playwright.config.ts` — CI-portability fixes
  it was making mid-validation.
- ⚠️ `apps/web/src/App.tsx` (±6 lines) — **out of scope for that agent.** It was diagnosing the
  auth-404 routing spec when stopped. Scrutinize this diff first: if it is not a genuine,
  minimal product fix required for the spec to pass, revert it and fix the spec instead.
- `ci.yml` was deliberately NOT touched yet — the rule was: prove the suite green locally
  first, only then add the job.

## How to validate (Linux — same as CI)

```bash
pnpm install --frozen-lockfile
pnpm --filter @ops/shared build
pnpm --filter @ops/functions build
(cd apps/functions/lib && npm install --production --ignore-scripts)  # see deploy-dev.yml for why
pnpm --filter @ops/web exec playwright install --with-deps   # check playwright.config.ts for browsers
npm i -g firebase-tools                                       # emulator needs Java 21+ (temurin)
firebase emulators:exec --project peer-evaluator-rubric \
  --only firestore,auth,functions,storage --import ./fixtures/seed \
  "pnpm --filter @ops/web test:e2e"
```

The canonical invocation is documented in the header of `apps/web/playwright.config.ts`
(Vite dev server in emulator mode + dev-auth-server are started by its `webServer` block).
Seed fixtures live in `fixtures/seed`; `scripts/seed-dev.ts` regenerates them.

## CI job requirements (once locally green)

- New job in `.github/workflows/ci.yml`; do NOT modify the existing `validate` / `rules-tests`
  jobs. Copy `rules-tests`' setup pattern (pnpm 10.30.2 / node 22 / `actions/setup-java@v5`
  temurin 21). `timeout-minutes: 25`. Upload the Playwright report via
  `actions/upload-artifact@v4` with `if: failure()`.
- Emulator-only: no secrets, no live Firebase.
- `pnpm exec prettier --write .github/workflows/ci.yml` before committing.

## Repo rules (CLAUDE.md is canonical — read it)

- No suppressions of any kind (`any`, `@ts-ignore`, `eslint-disable`, skipped tests).
- Gate before every push: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`.
- ⚠️ Pushing to `dev-paul` deploys Firestore rules/indexes + Functions to the LIVE project
  and runs full CI. Merge this branch into `dev-paul` (or cherry-pick) and push only when
  everything is verified. Delete this HANDOFF-E2E.md and the `e2e-ci-wip` branch in that
  final commit/cleanup.

## Done means

CI on `dev-paul` green across all three jobs (validate, rules-tests, e2e) on the final commit.
