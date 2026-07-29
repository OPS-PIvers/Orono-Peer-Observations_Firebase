# Consolidated Backlog

Extracted 2026-07-24 from a verified sweep of all planning docs (`docs/superpowers/`, audits, integration report). Every item below was confirmed genuinely unshipped by checking the code and git history — a doc's own "done" claims were not trusted. Fully shipped plans were removed; see git history for their contents.

**Scope:** this file holds bugs, ops work, and committed follow-ups. Feature and product opportunities live in [`FEATURES_ROADMAP.md`](FEATURES_ROADMAP.md) — 88 code-grounded briefs from a 2026-07-24 discovery pass, of which 19 have shipped (8 in the 2026-07-25 tier-1/tier-2 sweep, 11 in the 2026-07-29 tier A sweep) and 69 remain open. Admin-console defects live in [`docs/ADMIN_CONSOLE_AUDIT.md`](docs/ADMIN_CONSOLE_AUDIT.md) — 54 briefs (AC-01 … AC-62) from the 2026-07-29 three-axis audit, all open.

Last updated 2026-07-29, after the admin-console audit (54 new items, see below) and before that the tier A `FEATURES_ROADMAP.md` sweep (PRs #73–#84, plus #85–#86 fixing cross-feature defects the per-PR reviews missed). That sweep cleared the one existing "Ready code work" item and added seven new follow-ups, most of them pre-existing gaps that only became visible once the surrounding code was touched. Before that: the 2026-07-25 sweep (PRs #65–#72). Before that: the 2026-07-24 parallel implementation sweep that cleared "Ready code work" (PRs #48, #50–#58, plus #59/#60 as fallout fixes), the doc cleanup that archived the audits under `docs/archive/` and deleted the six fully-shipped `docs/superpowers/plans/` documents, and the send-time href sanitization + ESLint ignore narrowing that closed two of the sweep follow-ups.

## Admin console audit (2026-07-29) — 54 open items

A three-axis audit (wiring / staff-surface coverage / non-dev usability) of the whole admin console.
Full self-contained briefs, themes, and suggested implementation slices are in
[`docs/ADMIN_CONSOLE_AUDIT.md`](docs/ADMIN_CONSOLE_AUDIT.md). **Point the `mass-plan-implementation`
skill at that document**, not at this section — the briefs there are written to be implementable
without conversation context, and the doc's "Suggested implementation slices" table (S1–S9) is a
ready-made batching plan.

Method: 8 parallel area passes + 4 adversarial verifiers instructed to refute every blocking/high
claim. 96 raw findings → 54 unique defects. Verifiers returned 32 CONFIRMED / 3 PARTIAL / 0 REFUTED
with 6 severity corrections. Code-reading only — **no agent ran the app**, so visual polish is
unaudited.

**Cutover blockers — fix before a district uses this in production:**

- [ ] **AC-01** Archiving a staff member never revokes their admin/PE claims — `onStaffWritten.ts:44` and `syncMyClaims.ts:78` both ignore `isActive`. (M) _Overlaps the deferred dev-paul `computeClaims.ts` triage item below; that item is the fix for this._
- [ ] **AC-02** Deleting a middle rubric component then adding one reuses the ID, merging two components — `RubricEditorPage.tsx:86-118`. (S)
- [ ] **AC-03** Rubric component color "Reset" always crashes Save (`color: undefined` own-property) — `RubricGridEditor.tsx:236`. (S)
- [ ] **AC-04** Deactivating a Work Product / Instructional Round question hides already-recorded answers, including on finalized observations — contradicts that page's own copy. `QuestionAnswerViewer.tsx:36`. (M)
- [ ] **AC-05** Creating a Role/Building/Module with a colliding ID silently overwrites an archived (invisible) doc — `RolesPage.tsx:355` + Buildings/Modules. (S)
- [ ] **AC-06** Role "Special access" checkbox has zero effect — real check is a hardcoded 3-slug allowlist. `RolesPage.tsx:396`. (M) _Needs a product decision; see the brief._
- [ ] **AC-07** Two hardcoded school-year boundaries (July vs August) disagree for a full month every year — dashboard hero vs Profile archive. (S)

**Remaining 47 items** are grouped in the audit doc by tier:

- **Tier 2 — dead controls and broken admin actions** (AC-08 … AC-16, 9 items): two callables deny `hasAdminAccess`-only admins; the email "Recipient" selector is cosmetic for 14 of 17 triggers; "Send Test…" works for 1 of 17; "Schedule active" is dead; the observation-saves rate limit is enforced nowhere.
- **Tier 3 — missing error handling on inline writes** (AC-17 … AC-22, 6 items): one pattern across six files. Inputs bind directly to the live Firestore snapshot, so a rejected write silently reverts the admin's typing with no message.
- **Tier 4 — data integrity and validation** (AC-23 … AC-31, 9 items).
- **Tier 5 — coverage gaps** (AC-32 … AC-47, 16 items): the cutover-risk group — branding not reaching email or the sign-in screen, hardcoded district name and support contact, proficiency-scale labels, no way to create a rubric from scratch, audit log declaring far more actions than it writes.
- **Tier 6 — usability and polish** (AC-48 … AC-62, 15 items): chiefly save-state ambiguity, including an unsaved-changes guard that already exists in the codebase and is wired up nowhere.

**Needs your decision before implementation:** AC-42 (observation types as a fixed enum — may be a
legitimate engineering boundary) and the full version of AC-27 (rubric draft/publish states).

## Human-gated (needs a decision, secret, or deploy)

- [ ] **KMS envelope-encryption of Google Calendar OAuth tokens** — tokens are plaintext in `/userCalendarTokens`. Needs a Cloud KMS key provisioned + deploy config. (M) _From CODEBASE_AUDIT; real residual security exposure._
- [ ] **Firestore backup completion monitoring** — Cloud Scheduler function to alert admins if the daily backup misses its window. Flagged as future work in `docs/operations.md:148`; post-cutover enhancement. (M)
- [ ] **Adopt (or reject) the Firestore Send Email extension** — add `extensions/firestore-send-email.env` + extensions block to `firebase.json` and deploy, vs. keeping the existing email flow. (S)
- [ ] **Review the CLAUDE.md preserved in tag `dev-paul-snapshot-2026-07-21`** — `main` has no CLAUDE.md at all, so this is an adopt-or-drop decision, not a merge. (S)
- [ ] **Triage the 18 DUPLICATE refactors from dev-paul** — per-file adopt/skip decision against tag `dev-paul-snapshot-2026-07-21`; `computeClaims.ts` specifically carries a genuinely new `elevatedAccessRevoked` revoke-on-demotion behavior worth a deliberate look. PR #23 is already closed (unmerged, 2026-07-21), so the tag is the only source. (M) **⚠ No longer optional: this is the fix for AC-01** (archiving a staff member never revokes their access). Read `computeClaims.ts` from the tag before implementing AC-01.

## Ready code work (no blockers)

- [ ] **Backfill the `rate_limit_tripped` audit write into `uploadAudio` and `requestTranscription`** — discovered during the 2026-07-29 sweep: `AUDIT_ACTIONS.rateLimitTripped` was defined in `packages/shared/src/schema/auditLog.ts` but written by **nothing**, so neither of the two callables rate-limited since #46 has ever produced an audit trail when a limit trips. #73 is the first real caller. Bring the other two in line. (S) _Subsumed by **AC-38** — the audit found this is the narrow case of a much broader gap: most declared `AUDIT_ACTIONS` are written by nothing. Ship them together._
- [ ] **Re-check the `gemini.scriptAutoTag.enabled` kill switch inside `applyScriptTags`'s transaction** — it is currently read only on the pre-transaction load, so an admin disabling auto-tag mid-review does not block an in-flight apply. Same shape as the finalized-status race #77 closed, but narrower. (S) _Non-blocking finding from the #77 adversarial review._
- [ ] **Bring `CellChip` and `EvidenceChip` up to the 24px WCAG 2.5.8 minimum** — they sit at roughly 17–24px in `apps/web/src/components/rubric/RubricRow.tsx` and do render on iPad (iPad mini's 744 CSS px portrait width is below the app's 768px `useIsDesktop` breakpoint, so iPad users get the mobile accordion). Pre-existing; disclosed and deliberately deferred by #84 to keep that PR's diff reviewable. (S)
- [ ] **Give the rubric matrix a valid `role="grid"`/`role="table"` ancestor, or drop the row roles** — `DomainSection.tsx` and `RubricRow.tsx` assert `role="row"`/`rowheader`/`columnheader` with no grid/table ancestor, so their required context role is unsatisfied and assistive tech may not expose them as intended. Pre-existing and independent of #84's toggle-button fix. (M)
- [ ] **Test coverage for `ProfilePage`'s growth-chart rendering** — `computeGrowthTrend` is unit-tested but the rubric-grouping and dash/marker series-differentiation logic (the actual WCAG 1.4.1 fix from #79) is not, because `ProfilePage.tsx` has no test harness. Standing one up is its own task. (M)
- [ ] **End-to-end test for the forced-sign-out flush glue in `ObservationEditorPage`** — both sides of the contract are tested (ordering in `AuthProvider.test.tsx`, registry semantics in `forcedSignOutFlush.test.ts`) but the six lines of registration in the editor are not, since the page has never had a render test. (M)
- [ ] **Add `.claude/worktrees/` to `.gitignore`** — agent worktrees are created inside the repo and are neither tracked nor ignored, so `eslint .` lints entire duplicate copies of the codebase and a stray `git add -A` could commit gigabytes. (S)

## Follow-ups from the 2026-07-24 sweep

- [ ] **Verify the WebKit Firestore stall on a real iPad.** The `tablet-ipad` Playwright project runs the iPad viewport on Chromium because under WebKit the Firestore _collection_ listeners never advance past their first cached snapshot against the emulator suite (the staff picker sits at "0 of 1 match" past a 30s wait; single-document listeners are fine, so sign-in and dashboard chrome pass). Unknown whether this is emulator-transport-specific or reproduces on iPad Safari against production Firestore — needs a device, not CI. See the comment in `apps/web/playwright.config.ts`. (M)
- [ ] **Adopt the shared Tiptap toolbar in `EmailBodyField`** — #50 deduped `tiptap-editor.tsx` and `ScriptEditor.tsx` into `components/ui/tiptap-toolbar.tsx`; `EmailBodyField` still carries its own copy. (S)
- [ ] **Give `apps/pdf-renderer` a `test:coverage` script** and add it to the coverage job's package list in `.github/workflows/ci.yml` — the job currently covers `@ops/shared`, `@ops/functions`, `@ops/web` and fails on a missing summary, so pdf-renderer must be added deliberately, not implicitly. (S)

## Future feature (needs its own brainstorm → spec → plan)

- [ ] **Module assignments (Google-Doc workflow)** — per-staff Doc copy + embed, submission + notification flow, Drive auth model (per-user OAuth vs. service account). Never implemented; stub spec explicitly says "do not implement from this document." Once built, register `assignmentSubmitted` in the dashboard step-builder's `EVENT_EVALUATORS` (trivial, purely additive). (L)

## Shipped (2026-07-29 tier A sweep)

- [x] **Rate-limit `regenerateObservationPdf`** — 10/user/hour, configurable via the `rateLimits` settings block. Fails **closed** on limiter error, matching `requestTranscription` (the first implementation failed open, which meant inducing Firestore transaction contention could bypass the limit on the most expensive callable in the app). ([#73](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/73))

The 11 feature items from that sweep are recorded in [`FEATURES_ROADMAP.md`](FEATURES_ROADMAP.md#shipped).

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
