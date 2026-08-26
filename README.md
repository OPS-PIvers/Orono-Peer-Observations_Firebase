# Orono Peer Observations

Firebase + React rebuild of the Orono Public Schools Peer Evaluator Form
(originally a Google Apps Script web app). Solo-developed by Paul Ivers,
targeting Aug/Sept 2026 cutover for the 2026–27 school year.

## Stack

- **Frontend** Vite + React 19 + TypeScript, Tailwind 4 + shadcn/ui
- **Backend** Firebase Cloud Functions v2 (TypeScript, Node 22)
- **PDF rendering** Cloud Run (Hono + Puppeteer)
- **Data** Cloud Firestore
- **Blob storage** Google Drive via service account + Domain-Wide Delegation
- **Auth** Firebase Auth + Google SSO restricted to `@orono.k12.mn.us`

## Repo layout

```
apps/
  web/             Vite SPA — peer-evaluator + admin UIs
  functions/       Cloud Functions (auth blocking, observation lifecycle, transcription orch.)
  pdf-renderer/    Cloud Run service (Puppeteer PDF generation)
packages/
  shared/          Workspace-internal: Zod schemas, types, brand tokens, constants
scripts/
  import/          One-shot Sheet → Firestore migration scripts
DESIGN.md          OPS Tech brand tokens (canonical, machine-readable)
```

## Local dev

```bash
pnpm install
pnpm --filter @ops/shared build      # generate dist for the workspace package
pnpm dev:emulators                   # Firestore + Auth + Functions + Storage
pnpm dev                             # Vite (separate terminal)
```

Set `VITE_USE_EMULATORS=true` in `apps/web/.env.local` for emulator-pointed dev
(see `apps/web/.env.example`). Most dev should happen here, not against live
Firebase.

On Windows the emulators need Java 21+ on `PATH` and an AF_UNIX temp directory
outside the user profile — without the latter the Firestore emulator exits 1
before it starts. See docs/local-dev-windows.md.

## Useful scripts

| Command                      | What it does                                                             |
| ---------------------------- | ------------------------------------------------------------------------ |
| `pnpm validate`              | typecheck + lint + format check + tests                                  |
| `pnpm test:rules`            | Firestore security rules tests via emulator                              |
| `pnpm test:e2e`              | Playwright E2E (desktop + iPad viewports)                                |
| `pnpm import:emulator`       | Import current Sheet into the running emulator                           |
| `pnpm import:prod --confirm` | One-shot prod import (cutover only — destructive)                        |
| `pnpm export:emulator`       | Export staff/observations/rubrics/auditLog from the emulator to JSON/CSV |
| `pnpm export:prod`           | Same, from live Firestore — see `scripts/export/README.md`               |

## Branches

- `dev-paul` — work-in-progress; auto-deploys to a Hosting preview channel against live Firestore
- `main` — production; deploys to live with manual approval gate

## See also

- DESIGN.md — brand tokens
- TODO.md — backlog: bugs, ops work, committed follow-ups
- FEATURES_ROADMAP.md — 88 feature briefs from a codebase discovery pass; a menu of opportunities, not a plan
- docs/dependency-overrides.md — why each `pnpm.overrides` entry in package.json exists and when it can be removed
- docs/local-dev-windows.md — why the Firestore emulator fails to start on Windows, and the one-line fix
