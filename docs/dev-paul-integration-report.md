# dev-paul → main integration report

_Generated 2026-07-20. Read-only analysis; no code was changed to produce this._

> **Integration status — updated 2026-07-21.** The forward-integration described
> below is essentially complete. `dev-paul`'s exact tree is preserved as the git
> tag `dev-paul-snapshot-2026-07-21`. The categorization below reflects the
> original analysis; the following landed on `main` afterward:
>
> - **Tests / tooling / infra:** #33 (10 passing tests), #34 (tooling, hooks,
>   `signupValidation`, `.gitattributes`), #35 (Playwright e2e specs, local-run).
> - **Backend Cloud Functions:** resendStaffInvite (#36), monitorDriveQuota (#38),
>   sweepStaleTranscriptionJobs (#39), backfillObservationIds + uploadModuleFile +
>   migrateModuleSectionBodies (#40), withdrawDayPreference + regenerateObservationPdf
>   (#41), resendWindowInvite (#42), rate-limiting (#46). All the "NEEDS-WIRING"
>   functions plus their missing `@ops/shared` / lib deps were ported and registered.
> - **Frontend:** GlobalBanner (#37), TranscriptionJobs + MyObservations routes +
>   `sonner` (#43), signup-details display + new-observation gating (#44),
>   BrandingProvider runtime theming (#45).
>
> **Deliberately not ported:** the 18 DUPLICATE refactors (main already implements
> these); `WindowDetailPage` (orphan even on dev-paul); `CLAUDE.md` (pending a
> human read-through); wiring the e2e specs into CI (needs verification against
> main's UI on a live emulator first); and the remaining infra bits
> (`pdf-renderer` font-embedding + vitest, `extensions/firestore-send-email.env`,
> which edits `firebase.json` deploy config).

## Situation

`main` and `dev-paul` diverged from the same starting point (`83a9f0a`) and were then
independently developed into **two parallel integrations of the same app**. They are not
"ahead/behind" — each contains substantial work the other lacks, and both heavily rewrote
the same ~200 shared files. Net tree difference: **371 files, +50k / −14k**.

Because of this, `dev-paul` (PR #23) **cannot be rebased or merged mechanically** — doing so
would conflict across hundreds of files and risk reverting features `main` gained in its
2026-07-20 merge (staff CSV import/rollover, auto-assign, edit-observation-window,
transcription grouping, export scripts, audit docs, etc.).

This report maps every file that is **unique to `dev-paul`** (exists there, absent from `main`)
so the remaining work can be integrated deliberately, piece by piece.

## Unique-to-dev-paul inventory

| Group                           | Count | Status                                                                    |
| ------------------------------- | ----- | ------------------------------------------------------------------------- |
| Test files                      | 87    | 10 ported (PR #33, merged); 4 e2e need infra; 73 tied to unbrought source |
| Source / infra files            | 57    | Categorized below                                                         |
| `.claude/` workflow bookkeeping | 14    | Ephemeral agent state — do **not** bring to main                          |

### Already done

- **PR #33 (merged):** ported the 10 dev-paul test files that pass against main's current
  source, as a pure coverage gain (no source changes). CI green.

---

## Source / infra files (57) — categorization

Three categories:

- **DUPLICATE** — main already implements the capability (often under a different filename or
  architecture). Bringing the file lands dead/competing code unless it _replaces_ main's version.
- **NEW · SELF-CONTAINED** — main lacks it and it drops in without editing existing main source.
- **NEW · NEEDS-WIRING** — main lacks it, but it's inert until wired in (function registration,
  route, provider mount, or a missing `@ops/shared` / sibling-source dependency).

### DUPLICATE (18) — main already covers this

| File                                                  | main equivalent                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `functions/src/auth/computeClaims.ts`                 | claim logic inline in `auth/syncMyClaims.ts` + `auth/onStaffWritten.ts` (adds new `elevatedAccessRevoked` helper) |
| `functions/src/email/onMailDelivered.ts`              | reimplements `email/onMailWritten.ts`                                                                             |
| `functions/src/lib/audit.ts`                          | audit-write done inline via `COLLECTIONS.auditLog.add(...)` across ~10 main files                                 |
| `functions/src/lib/authz.ts`                          | admin/special checks inline via `isAdminRole(token.role)` in callables                                            |
| `functions/src/observations/deleteObservationFile.ts` | superset of main's `observations/removeEvidenceFile.ts`                                                           |
| `functions/src/observations/finalizeClaim.ts`         | draft→finalized CAS inline in `observations/finalizeObservation.ts`                                               |
| `functions/src/observations/roleLookup.ts`            | role resolution inline in `observations/finalizeObservation.ts`                                                   |
| `functions/src/observations/scriptTextblocks.ts`      | paragraph/tag traversal inline in `observations/geminiTagScript.ts`                                               |
| `functions/src/scheduling/draftCleanup.ts`            | draft teardown inline in `scheduling/cancelBooking.ts`                                                            |
| `web/src/admin/_shared/exportCsv.ts`                  | CSV export via `admin/staff/staffCsv.ts`                                                                          |
| `web/src/admin/rubrics/CreateRubricDialog.tsx`        | inline create in `admin/rubrics/RubricsListPage.tsx`                                                              |
| `web/src/admin/staff/AdvanceYearDialog.tsx`           | main's `admin/staff/RolloverDialog.tsx` (also needs `advanceCycle` — absent on main)                              |
| `web/src/dashboard/moduleMaterials.ts`                | `collectionGroup('items')` query inline in `dashboard/StaffDashboardPage.tsx`                                     |
| `web/src/hooks/useGeminiFeatures.tsx`                 | main has `hooks/useGeminiFeatures.ts` (`.tsx` is a Provider refactor)                                             |
| `web/src/hooks/useTranscriptionJob.ts`                | main's `observations/useTranscriptionJobs.ts` + `transcriptionJobGrouping.ts`                                     |
| `web/src/observations/observationWindowQuery.ts`      | "my windows" filter inline in `observations/MyObservationWindowsPage.tsx`                                         |
| `web/src/routes/staffDirectoryQuery.ts`               | staff-directory filters inline in `routes/StaffDirectoryPage.tsx`                                                 |
| `pdf-renderer/assets/fonts.css`                       | duplicates remote gstatic `@import` already in `pdf-renderer/src/template.ts` (see Uncertain)                     |

> Most DUPLICATE files are dev-paul **refactors** that extract inline logic into named helpers.
> They only add value if main's callers are rewired to use them — that's a refactor of working
> code, not a port, and should be a deliberate decision per file, not a bulk merge.

### NEW · SELF-CONTAINED (15) — safe, additive drop-ins

Infra / docs / tooling (11):
`.gitattributes` · `.github/workflows/deploy-pdf-renderer.yml` · `CLAUDE.md` ·
`pdf-renderer/README.md` · `pdf-renderer/scripts/generate-fonts.mjs` ·
`web/scripts/perf/README.md` · `web/scripts/perf/measure-page-load.mjs` ·
`web/scripts/perf/routes.mjs` · `docs/operations.md` ·
`packages/shared/src/signupValidation.ts` · `scripts/seed-dev.ts`

Web leaf modules (4):
`web/src/components/brandingCache.ts` · `web/src/hooks/useFirestoreCollectionGroup.ts` ·
`web/src/hooks/useFirestoreCollectionOnce.ts` · `web/src/hooks/useUnsavedChangesGuard.ts`

Caveats:

- `deploy-pdf-renderer.yml` has its `push` trigger hard-coded to the **`dev-paul`** branch — it
  won't auto-fire on main until that's changed (`workflow_dispatch` works as-is). GCP IAM roles
  are a deploy-time prereq.
- `signupValidation.ts`, `brandingCache.ts`, and the three hooks compile and harm nothing but land
  as **dead code** until a consumer imports them (their consumers are themselves DUPLICATE / NEEDS-WIRING).
- `generate-fonts.mjs` is safe to add, but its output only matters once `pdf-renderer/src/template.ts`
  is rewired (that pairing is NEEDS-WIRING).

### NEW · NEEDS-WIRING (24) — capability new to main, inert until integrated

Cloud Functions not registered in `functions/src/index.ts` (+ missing deps):

| File                                                         | Wiring / missing deps                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `functions/src/drive/monitorDriveQuota.ts`                   | needs `loadSecurityAdminEmail` in `lib/emailUtils.ts`; register in index.ts                                              |
| `functions/src/email/resendStaffInvite.ts`                   | needs `staffInviteMailDocId` in emailUtils; register                                                                     |
| `functions/src/lib/rateLimit.ts`                             | call `checkRateLimit` from a callable; add firestore.rules deny for `rateLimitCounters`                                  |
| `functions/src/modules/onModuleDeleted.ts`                   | register (deps present)                                                                                                  |
| `functions/src/modules/uploadModuleFile.ts`                  | needs `MAX_MODULE_FILE_BYTES` in shared; register                                                                        |
| `functions/src/observations/regenerateObservationPdf.ts`     | needs dev-paul `roleLookup.ts`; `deleteDriveFile` + `shareObservationFolderWithObserver` in `lib/drive.ts`; register     |
| `functions/src/scheduling/resendWindowInvite.ts`             | needs `resendWindowInviteInput` (shared), `resendWindowInviteMailDocId` (emailUtils), `inviteeEntryKey` export; register |
| `functions/src/scheduling/withdrawDayPreference.ts`          | needs `withdrawDayPreferenceInput` (shared) + `removeDayCount` (`engine/bookingRules.ts`); register                      |
| `functions/src/scripts/backfillObservationIds.ts`            | register (deps present)                                                                                                  |
| `functions/src/scripts/migrateModuleSectionBodies.ts`        | needs `MODULE_CONTENT_SUBCOLLECTION` (shared); register                                                                  |
| `functions/src/transcription/sweepStaleTranscriptionJobs.ts` | register                                                                                                                 |

Web features needing route / provider / dependency:

| File                                                    | Wiring / missing deps                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `web/src/admin/transcription/TranscriptionJobsPage.tsx` | route + `ADMIN_NAV` item                                                           |
| `web/src/components/BrandingProvider.tsx`               | mount in App root; add `--ops-brand-primary*` theme vars; needs `brandingCache.ts` |
| `web/src/components/GlobalBanner.tsx`                   | render in `components/Layout.tsx` (main already stores `globalBannerText`)         |
| `web/src/components/ui/sonner.tsx`                      | add `sonner` dep; mount `<Toaster/>`                                               |
| `web/src/hooks/useNewObservationsDisabled.ts`           | import in create-observation flow to gate creation                                 |
| `web/src/observations/SignupDetailsCard.tsx`            | render inside `ObservationEditorPage.tsx`                                          |
| `web/src/routes/MyObservationsPage.tsx`                 | route + nav; imports `toast` from sonner (absent)                                  |
| `web/src/scheduling/SignupDetailsDisplay.tsx`           | render inside ObservationInfoPopover                                               |
| `web/src/scheduling/WindowDetailPage.tsx`               | route; needs backend `resendWindowInvite` + types (orphan even on dev-paul)        |
| `pdf-renderer/assets/fonts-embedded.css`                | rewire `pdf-renderer/src/template.ts` to inline it instead of remote `@import`     |
| `pdf-renderer/vitest.config.ts`                         | add vitest devDep + `test` script + tests to pdf-renderer package.json             |
| `web/tsconfig.e2e.json`                                 | add `apps/web/e2e/*.spec.ts` (4 exist on dev-paul) + reference in eslint config    |
| `extensions/firestore-send-email.env`                   | add `extensions` block to `firebase.json`; deploy the extension                    |

---

## Test files (87) — status

- **10 ported** (PR #33, merged).
- **4 e2e Playwright specs** (`auth`, `auth-404-routing`, `dashboard`, `observation-lifecycle`) —
  need `apps/web/e2e/` + `tsconfig.e2e.json` + CI wiring. Reasonable standalone batch.
- **73 remaining unit tests** are coupled to dev-paul source not on main (they import extracted
  helpers, assert evolved component behavior, or reference dev-paul-only types/fields). Each will
  only pass once its subject source is brought over — i.e. they travel with the DUPLICATE /
  NEEDS-WIRING work above, not separately.

---

## Recommendations

1. **Safe now (low risk):** bring the 15 NEW · SELF-CONTAINED files (mostly docs/tooling) as one
   or two focused PRs. Note the dead-code caveats; consider deferring the leaf modules until their
   consumers land.
2. **Feature-by-feature (deliberate):** the 24 NEEDS-WIRING files are real capabilities main lacks
   (rate-limiting, module-file upload, PDF regen, transcription admin page, global banner, runtime
   branding, resend-invite, migrations). Each is a proper feature PR — bring the file, its missing
   `@ops/shared`/sibling deps, its tests, and wire it in. Prioritize by product value.
3. **Skip / decide per-file:** the 18 DUPLICATE files. Only adopt one if you specifically prefer
   dev-paul's refactor over main's inline version; otherwise they're redundant.
4. **Never bring:** the 14 `.claude/` workflow bookkeeping files.
5. **PR #23 (`dev-paul`):** keep open as the reference source until the wanted pieces are extracted,
   then close it — it should not be merged as-is.

### Shared prerequisites for the NEEDS-WIRING set

Several dev-paul functions depend on symbols **absent on main**, which must be ported first or the
files won't compile:

- **`@ops/shared`:** `MAX_MODULE_FILE_BYTES`, `MODULE_CONTENT_SUBCOLLECTION`,
  `resendWindowInviteInput`, `withdrawDayPreferenceInput`, `advanceCycle`, `isAdminRole`, `isSpecialRole`
- **`functions/src/lib/emailUtils.ts`:** `loadSecurityAdminEmail`, `staffInviteMailDocId`, `resendWindowInviteMailDocId`
- **`functions/src/lib/drive.ts`:** `deleteDriveFile`, `shareObservationFolderWithObserver`
- **`functions/src/scheduling/engine/bookingRules.ts`:** `removeDayCount`
- **`functions/src/scheduling/createObservationWindow.ts`:** export `inviteeEntryKey`

## Uncertain / flagged

- `pdf-renderer/assets/fonts.css` — duplicates the remote `@import` main uses, but is referenced by
  neither branch's `template.ts`; adds no capability either way.
- `packages/shared/src/signupValidation.ts` — compiles drop-in, but is not imported by any
  production code even on dev-paul (only its own test).
- `web/src/hooks/useUnsavedChangesGuard.ts` — self-contained as a `beforeunload` guard; the full
  in-app nav-blocking dialog it's built for would need a context provider (→ NEEDS-WIRING).
- `functions/src/auth/computeClaims.ts` — DUPLICATE of inline claim logic, but adds a genuinely new
  `elevatedAccessRevoked` (revoke-on-demotion) behavior main lacks.
- `web/src/scheduling/WindowDetailPage.tsx` — NEEDS-WIRING, but is an orphan even on dev-paul (no
  route references it there), so its intended integration is unverified.
