# Consolidated Backlog

Extracted 2026-07-24 from a verified sweep of all planning docs (`docs/superpowers/`, audits, integration report). Every item below was confirmed genuinely unshipped by checking the code and git history — a doc's own "done" claims were not trusted. Fully shipped plans were removed; see git history for their contents.

Last updated 2026-07-24, after the parallel implementation sweep that cleared the "Ready code work" section (PRs #48, #50–#58, plus #59/#60 as fallout fixes), the doc cleanup that archived the audits under `docs/archive/` and deleted the six fully-shipped `docs/superpowers/plans/` documents, and the send-time href sanitization + ESLint ignore narrowing that closed two of the sweep follow-ups.

## Human-gated (needs a decision, secret, or deploy)

- [ ] **KMS envelope-encryption of Google Calendar OAuth tokens** — tokens are plaintext in `/userCalendarTokens`. Needs a Cloud KMS key provisioned + deploy config. (M) _From CODEBASE_AUDIT; real residual security exposure._
- [ ] **Firestore backup completion monitoring** — Cloud Scheduler function to alert admins if the daily backup misses its window. Flagged as future work in `docs/operations.md:148`; post-cutover enhancement. (M)
- [ ] **Adopt (or reject) the Firestore Send Email extension** — add `extensions/firestore-send-email.env` + extensions block to `firebase.json` and deploy, vs. keeping the existing email flow. (S)
- [ ] **Review the CLAUDE.md preserved in tag `dev-paul-snapshot-2026-07-21`** — `main` has no CLAUDE.md at all, so this is an adopt-or-drop decision, not a merge. (S)
- [ ] **Triage the 18 DUPLICATE refactors from dev-paul** — per-file adopt/skip decision against tag `dev-paul-snapshot-2026-07-21`; `computeClaims.ts` specifically carries a genuinely new `elevatedAccessRevoked` revoke-on-demotion behavior worth a deliberate look. PR #23 is already closed (unmerged, 2026-07-21), so the tag is the only source. (M)

## Ready code work (no blockers)

_Empty — everything that was here shipped on 2026-07-24. See "Shipped" below._

## Follow-ups from the sweep

- [ ] **Verify the WebKit Firestore stall on a real iPad.** The `tablet-ipad` Playwright project runs the iPad viewport on Chromium because under WebKit the Firestore _collection_ listeners never advance past their first cached snapshot against the emulator suite (the staff picker sits at "0 of 1 match" past a 30s wait; single-document listeners are fine, so sign-in and dashboard chrome pass). Unknown whether this is emulator-transport-specific or reproduces on iPad Safari against production Firestore — needs a device, not CI. See the comment in `apps/web/playwright.config.ts`. (M)
- [ ] **Adopt the shared Tiptap toolbar in `EmailBodyField`** — #50 deduped `tiptap-editor.tsx` and `ScriptEditor.tsx` into `components/ui/tiptap-toolbar.tsx`; `EmailBodyField` still carries its own copy. (S)
- [ ] **Give `apps/pdf-renderer` a `test:coverage` script** and add it to the coverage job's package list in `.github/workflows/ci.yml` — the job currently covers `@ops/shared`, `@ops/functions`, `@ops/web` and fails on a missing summary, so pdf-renderer must be added deliberately, not implicitly. (S)

## Future feature (needs its own brainstorm → spec → plan)

- [ ] **Module assignments (Google-Doc workflow)** — per-staff Doc copy + embed, submission + notification flow, Drive auth model (per-user OAuth vs. service account). Never implemented; stub spec explicitly says "do not implement from this document." Once built, register `assignmentSubmitted` in the dashboard step-builder's `EVENT_EVALUATORS` (trivial, purely additive). (L)

## Shipped (2026-07-24 sweep)

- [x] **Re-validate stored link hrefs server-side in the email path** — `sanitizeHtmlHrefs` in `@ops/shared` rewrites any non-http/https/mailto href to `#` inside `sendEmail`, after variable substitution and before `renderEmailShell`, so every templated/manual/scheduled path is covered; rejected values are logged and recorded on the `emailSent` audit entry. The `isSafeUrl`/`toSafeUrl` validator moved from `apps/web/src/lib/url.ts` to `@ops/shared` so both sides share one implementation. (#64)
- [x] **Narrow the repo-wide ESLint ignore glob** — `'**/lib/**'` replaced with the two real build-output paths. It had been hiding four source directories, not the one the backlog assumed: `apps/web/src/lib`, `apps/functions/src/lib`, `apps/functions/src/calendar/lib`, and `scripts/lib` (the last is `.mjs`, still ignored by the separate scripts rule). 32 previously-invisible lint errors fixed. (#64)
- [x] **Wire Playwright e2e specs into CI** — emulator-backed `Playwright E2E` job boots Firestore/Auth/Functions/Storage, mints dev custom tokens, seeds, then runs both browser projects. (#49)
- [x] **Unit tests for `finalizeObservation`, `syncMyClaims`, `onStaffWritten`, email delivery, calendar subsystems.** (#48)
- [x] **Replace remaining `window.prompt()` call sites (7)** with a shared `PromptDialog` plus `lib/url.ts` protocol/control-character validation, closing the `javascript:` href injection path. (#52)
- [x] **Consolidate `toDate()`** — five near-duplicates collapsed into `@ops/shared`. (#55, test alignment in #60)
- [x] **Dedup Tiptap toolbar** into `components/ui/tiptap-toolbar.tsx`. (#50)
- [x] **pdf-renderer font embedding + vitest** — fonts inlined, remote gstatic `@import` dropped, missing-stylesheet failures now logged instead of silently falling back. (#51)
- [x] **Strip the last 2 invisible button overrides** — replaced with a real `onDark` button variant. (#54)
- [x] **Sticky dialog footer.** (#53)
- [x] **Publish coverage reports from CI** — `Test Coverage` job uploads per-package summaries and fails if one is missing. (#58)
- [x] **pnpm-override provenance comments** — recorded in `docs/dependency-overrides.md` with production-reachability corrected per entry. (#57)
- [x] **Set `maxInstances` on heavy callables** — ceiling of 10 on `finalizeObservation`, `geminiTagScript`, `onTranscriptionJobCreated`, `regenerateObservationPdf`, with the capacity rationale in comments. (#56)

## Decided, not built

- **PageHeader default: dark vs. light** — closed as-is. Commit `abce5fc`'s dark default stands; `light` stays opt-in. The fleet-wide `light` rollout the admin-console plan envisioned would require a button-override audit for no user-visible gain, and #54 removed the invisible-button hazard that made the current default risky.
- **Multi-codebase function splitting** — rejected. The cold-start cost that motivated it was already addressed by the lazy `googleapis` import; per-function deploys are available today via `firebase deploy --only functions:<name>`; and splitting would force edits to the protected deploy workflows and `firebase.json` for isolation the project does not currently need. Revisit only if deploy times or cold starts regress measurably.
