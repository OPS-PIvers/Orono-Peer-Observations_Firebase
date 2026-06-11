# CLAUDE.md

Operational guide for working in this repo. For product/brand context see [README.md](README.md)
and [DESIGN.md](DESIGN.md) (canonical OPS Tech brand tokens).

## What this is

Orono Public Schools **Peer Evaluator Observations** app — a Firebase + React + TypeScript rebuild
of a Google Apps Script web app. Solo-developed; targeting an Aug/Sept 2026 cutover. Google SSO is
restricted to `@orono.k12.mn.us`.

## Monorepo layout (pnpm workspaces)

| Workspace           | Package          | Stack / role                                                         | Build              |
| ------------------- | ---------------- | -------------------------------------------------------------------- | ------------------ |
| `apps/web`          | `@ops/web`       | Vite + React 19 + TS, Tailwind 4 + shadcn/ui — evaluator & admin UIs | `vite build`       |
| `apps/functions`    | `@ops/functions` | Cloud Functions v2 (Node 22) — auth blocking, observation lifecycle  | `tsup` → `lib/`    |
| `apps/pdf-renderer` | —                | Cloud Run (Hono + Puppeteer) — PDF generation                        | —                  |
| `packages/shared`   | `@ops/shared`    | Workspace-internal Zod schemas, types, constants, brand tokens       | `tsc -b` → `dist/` |

Data is Cloud Firestore; blob storage is Google Drive (service account + Domain-Wide Delegation).

## Commands (run from repo root)

| Command                    | What it does                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`                 | Vite dev server (`@ops/web`)                                                                    |
| `pnpm dev:emulators`       | Emulators **with** snapshot import — requires `fixtures/seed` to exist (see below)              |
| `pnpm dev:emulators:fresh` | Emulators **without** import — use on a fresh checkout; exports snapshot on exit                |
| `pnpm seed:dev`            | Write synthetic seed data to the running emulator (emulator must already be up)                 |
| `pnpm build`               | `pnpm -r build` — all workspaces                                                                |
| `pnpm typecheck`           | `pnpm -r typecheck` — all workspaces                                                            |
| `pnpm lint`                | `eslint . --max-warnings 0` (strict; warnings fail)                                             |
| `pnpm format` / `:check`   | Prettier write / check                                                                          |
| `pnpm test`                | `pnpm -r test` — Vitest per workspace                                                           |
| `pnpm test:scripts`        | Vitest unit tests for the seed-dev script (validates synthetic data against shared Zod schemas) |
| `pnpm test:rules`          | Firestore security-rules tests (needs emulator — see gotchas)                                   |
| `pnpm test:e2e`            | Playwright E2E (desktop + iPad viewports)                                                       |
| `pnpm validate`            | **typecheck + lint + format:check + test** — the full gate                                      |

## Required workflow rules

- **Run the gate before every `git push`.** At minimum `pnpm typecheck && pnpm lint && pnpm format:check`
  on what you changed (full `pnpm validate` when practical). CI failures from preventable
  typecheck/lint/format issues are not acceptable.
- **No suppressions.** ESLint runs `strictTypeChecked` + `stylisticTypeChecked` (type-checked rules).
  Do not introduce `any`, `@ts-ignore`/`@ts-expect-error`, `eslint-disable`, or skipped tests. Fix the
  underlying issue. Genuinely-needed config exceptions live in `eslint.config.js` with a comment.
- **Type imports are enforced:** `import type { … }` for types (`consistent-type-imports`).
- **Match existing style** — Prettier-formatted; follow the patterns in neighboring files.
- **Commit/push only when asked.** `dev-paul` is the working branch; `main` is production.

## Gotchas (these cause real failures)

- **Build `@ops/shared` before typechecking or running the web app.** Consumers import it from `dist/`,
  not source. After editing `packages/shared`: run `pnpm --filter @ops/shared build`, **and** if the Vite
  dev server is running, restart it (clear the `.vite` cache) so it picks up the new `dist`. The
  production `pnpm build` is unaffected (it rebuilds shared first via `pnpm -r`).
- **`@ops/functions` deploys from `apps/functions/lib`** (the `tsup` output), not from source. Firebase's
  function source is `apps/functions/lib` per `firebase.json`.
- **`pnpm test:rules` needs a working emulator.** On Windows it requires `TEMP`/`TMP` pointing at a short
  path (e.g. `C:/Temp`) **and Java 21** on `PATH`, or the Firestore emulator crashes on startup.
- **ESLint is type-aware**, so it needs each workspace's tsconfig to resolve. New source files must be
  covered by a `tsconfig` referenced in `eslint.config.js` `parserOptions.project`.
- **Line endings are enforced LF via `.gitattributes`** (`* text=auto eol=lf`), which overrides
  `core.autocrlf`. The working tree is LF on every platform (including Windows), so local Prettier/ESLint
  agree with CI and the full `pnpm lint` / `pnpm format:check` is reliable. If you ever hit a wall of
  `Delete ␍` warnings, your checkout predates this — renormalize with
  `git rm --cached -r . && git reset --hard`.

## Deploy (GitHub Actions — do not run manual deploys)

- Push to **`dev-paul`** → deploys a Hosting **preview** channel **plus the live project's Firestore
  rules + indexes, Storage rules, and Functions** (`deploy-dev.yml` runs `--only firestore,storage` and
  `--only functions` against `peer-evaluator-rubric`). A dev push is NOT sandboxed — rules/functions
  changes go live.
- **`main`** → production hosting deploy via a manual `workflow_dispatch` (approval-gated). Don't trigger it.
- `apps/pdf-renderer` deploys via its own paths-gated workflow (`deploy-pdf-renderer.yml`).
- CI runs on pushes to `main`/`dev-paul` and on PRs.

## Repeatable agent workflows

`.claude/workflows/optimize-codebase.js` is a reusable [Workflow](.claude/workflows/optimize-codebase.js)
that audits the codebase across 5 dimensions, ranks findings by impact, and (in `mode:'full'`) implements
them in file-disjoint waves with verify-after-each-wave. Use `mode:'analyze'` for a read-only audit.

`.claude/workflows/mvp-to-production.js` is its feature-completion sibling: per-subsystem auditors →
adversarial skeptics → ranked gap work-list (`mode:'audit'`), then dependency-aware file-disjoint
implementation waves (`mode:'implement'` with `gapsFile`/`specFile` pointing at `.claude/workflows/runs/`).
Implementers are model-routed by effort×risk (haiku/sonnet/opus; the top tier only for high-risk
security/rules slices). The June 2026 run that took the app from MVP to feature-complete (161 gaps,
3 batches) is archived in `.claude/workflows/runs/`.

For both: git commits, push, CI/deploy monitoring, and the PR remain the orchestrator's responsibility —
not the workflow's. Agents must never edit `.github/workflows/*` or `firebase.json` deploy config.
