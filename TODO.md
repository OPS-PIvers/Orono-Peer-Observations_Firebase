# Consolidated Backlog

Extracted 2026-07-24 from a verified sweep of all planning docs (`docs/superpowers/`, audits, integration report). Every item below was confirmed genuinely unshipped by checking the code and git history — a doc's own "done" claims were not trusted. Fully shipped plans were removed; see git history for their contents.

## Human-gated (needs a decision, secret, or deploy)

- [ ] **KMS envelope-encryption of Google Calendar OAuth tokens** — tokens are plaintext in `/userCalendarTokens`. Needs a Cloud KMS key provisioned + deploy config. (M) _From CODEBASE_AUDIT; real residual security exposure._
- [ ] **Set `maxInstances` on heavy callables** — `finalizeObservation`, `geminiTagScript`, `onTranscriptionJobCreated` have no ceiling (only `onObservationWritten` does). Needs a capacity/cost decision; trivial code once decided. (S)
- [ ] **Firestore backup completion monitoring** — Cloud Scheduler function to alert admins if the daily backup misses its window. Flagged as future work in `docs/operations.md:148`; post-cutover enhancement. (M)
- [ ] **Adopt (or reject) the Firestore Send Email extension** — add `extensions/firestore-send-email.env` + extensions block to `firebase.json` and deploy, vs. keeping the existing email flow. (S)
- [ ] **Review dev-paul's CLAUDE.md** before deciding whether/how to merge into main's. (S)
- [ ] **Triage the 18 DUPLICATE refactors from dev-paul** — per-file adopt/skip decision; `computeClaims.ts` specifically carries a genuinely new `elevatedAccessRevoked` revoke-on-demotion behavior worth a deliberate look. (M)
- [ ] **Close PR #23 (dev-paul)** once the residual items above are triaged. Tree preserved via tag `dev-paul-snapshot-2026-07-21`. (S)
- [ ] **PageHeader default: dark vs. light** — the admin-console plan intended a fleet-wide `light` default; commit `abce5fc` deliberately kept `dark` (opt-in light). Either formally close as-is or schedule the rollout (which needs a button-override audit). (M)

## Ready code work (no blockers)

- [ ] **Wire Playwright e2e specs into CI** — 4 specs exist in `apps/web/e2e/` (ported in #35) but no workflow runs them; needs an emulator-backed CI job, and specs were authored against dev-paul's UI so selectors may need updates. (M)
- [ ] **Unit tests for `finalizeObservation`, `syncMyClaims`, `onStaffWritten`, email delivery, calendar subsystems** — the codebase audit's highest-value test targets; still zero coverage despite other suites landing. (M)
- [ ] **Replace remaining `window.prompt()` call sites (7)** with Dialog+Input and URL/protocol validation — `tiptap-editor.tsx:238`, `ScriptEditor.tsx:492`, `BookingPage.tsx:563`, `EmailBodyField.tsx` ×3, `MyObservationWindowsPage.tsx:109`. `javascript:` href injection risk on link prompts. (S)
- [ ] **Consolidate `toDate()`** — 5 near-duplicate implementations (`googleCalendar.ts:197`, `regenerateObservationPdf.ts:238`, `blocking.ts:15`, `schedulingEmail.ts:13`, `onBuildingScheduleWritten.ts:101`) into `@ops/shared`. (S)
- [ ] **Dedup Tiptap toolbar** shared between `tiptap-editor.tsx` and `ScriptEditor.tsx` (local `ToolbarButton`/`insertOrEditLink` copies). (S)
- [ ] **pdf-renderer font embedding + vitest** — port `fonts-embedded.css`, rewire `template.ts` to inline fonts instead of the remote gstatic `@import`; add vitest to the package. (S)
- [ ] **Strip the last 2 invisible button overrides** — `text-ops-blue-dark bg-white hover:bg-white/90` at `RubricEditorPage.tsx:213` and `StaffPersonPage.tsx:332`; becomes an invisible-button bug if a page flips to `variant="light"`. (S)
- [ ] **Sticky dialog footer** — `DialogFooter` never got `sticky bottom-0 -mx-6 -mb-6 mt-2`; long dialogs scroll action buttons out of view. Cosmetic. (S)
- [ ] **Publish coverage reports from CI.** (S)
- [ ] **pnpm-override provenance comments** in `package.json`. (S)
- [ ] **Multi-codebase function splitting** for deploy/cold-start isolation — low urgency since lazy `googleapis` import already addressed the main cold-start cost. (L)

## Future feature (needs its own brainstorm → spec → plan)

- [ ] **Module assignments (Google-Doc workflow)** — per-staff Doc copy + embed, submission + notification flow, Drive auth model (per-user OAuth vs. service account). Never implemented; stub spec explicitly says "do not implement from this document." Once built, register `assignmentSubmitted` in the dashboard step-builder's `EVENT_EVALUATORS` (trivial, purely additive). (L)
