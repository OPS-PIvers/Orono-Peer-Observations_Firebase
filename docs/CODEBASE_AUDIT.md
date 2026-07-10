# Codebase Audit — July 2026

An audit of the full monorepo (web app, Cloud Functions, pdf-renderer, security
rules, shared packages, scripts, and CI) covering correctness, security,
performance/cost, and engineering hygiene. Findings are grouped by priority;
each one cites the file and line range it refers to. The three P0 findings were
manually re-verified against the code before publishing this report.

**Scope reviewed:** `apps/web` (~200 files), `apps/functions` (24 deployed
functions), `apps/pdf-renderer`, `firestore.rules`, `storage.rules`,
`firestore.indexes.json`, `packages/shared`, `scripts/`, `tests/rules`,
`.github/workflows`.

**Overall assessment:** the codebase is in good shape — strict TypeScript,
default-deny security rules with server-derived claims, transactional booking
logic, lazy-loaded routes, and disciplined CI. The findings below are the gap
between "good" and "robust at scale": a handful of production-breaking index
gaps, two real security/correctness holes, and a set of cost/latency and
test-coverage improvements.

---

## P0 — Critical (can break or leak in production today)

### 1. Five client queries require composite indexes that are not defined

`firestore.indexes.json` defines 12 composite indexes, but the emulator does
not enforce them, so tests pass while these production queries throw
`FAILED_PRECONDITION` against real Firestore:

| Query (equality + equality + orderBy)                                  | Where it runs                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `observations`: `observedEmail` + `status` + `finalizedAt DESC`        | `apps/web/src/dashboard/StaffDashboardPage.tsx:136-150`, `apps/web/src/observations/RecentObservationsStrip.tsx:30-41`                                                   |
| `observations`: `observedEmail` + `type` + `status` + `createdAt DESC` | `apps/web/src/hooks/useActiveStandardObservation.ts:14-24`, `useActiveInstructionalRoundObservation.ts`, `useActiveWorkProductObservation.ts`                            |
| `workProductQuestions`: `type` + `isActive` + `order ASC`              | `apps/web/src/observations/WorkProductAnswerForm.tsx:21-23`, `WorkProductResponseViewer.tsx`, `InstructionalRoundAnswerForm.tsx`, `InstructionalRoundResponseViewer.tsx` |
| `staff`: `role` + `isActive` + `name ASC`                              | `apps/web/src/routes/ProfilePage.tsx:31-35`                                                                                                                              |
| `emailTemplates`: `triggerType` + `isActive` + `name ASC`              | `apps/web/src/routes/StaffPersonPage.tsx:41-45`                                                                                                                          |

**Impact:** core dashboard and observation views break at runtime despite green
CI — this is a test blind spot as much as a bug.
**Fix:** add the five composite indexes to `firestore.indexes.json` and deploy.
Longer term, consider a CI smoke test against a real (non-emulator) project so
index gaps are caught before deploy.

### 2. `admin-uploads/**` in Cloud Storage is readable by any signed-in user

`storage.rules:15` — `allow read: if request.auth != null;` on
`admin-uploads/{path=**}`. The file's own header comment says this path holds
"temp uploads pre-Drive transfer" (which can include audio/evidence containing
staff PII) alongside branding logos, and there is no `@orono.k12.mn.us` domain
check.

**Impact:** any authenticated user can read (and list) every object under
`admin-uploads/`, including other users' pre-transfer sensitive uploads — a
cross-user data leak. Writes are correctly admin-gated; reads are not.
**Fix:** split branding from sensitive staging. Keep a dedicated
`admin-uploads/branding/**` sub-path auth-readable and lock everything else to
`request.auth.token.isAdmin == true`. At minimum, add the domain check used
throughout `firestore.rules`.

### 3. `finalizeObservation` can double-finalize under concurrent calls

`apps/functions/src/observations/finalizeObservation.ts:60-169` — the
observation is read once and `obs.status !== 'Draft'` is checked outside any
transaction (line 73); the `status: 'Finalized'` write happens ~100 lines later
(line 164), after several awaited external calls (PDF render, Drive folder
creation, upload, share). Two near-simultaneous calls (double-click, client
retry) both pass the Draft check and both see `driveFolderId: null`.

**Impact:** duplicate Drive folders and PDFs for the same observation, two
share notifications to the observed staff member, duplicate audit-log entries,
and a non-deterministic "final" PDF. Note that the booking functions
(`bookObservationSlot`, `cancelBooking`, etc.) already do this correctly with
`db.runTransaction` — finalize is the outlier.
**Fix:** claim the transition atomically first — a transaction that verifies
`status === 'Draft'` and writes an intermediate `Finalizing` status (failing
the loser with `failed-precondition`) — then do the Drive/PDF work, then flip
to `Finalized`. The same `ensureObservationFolder` race exists in
`uploadEvidenceFile.ts:105-119` and would be fixed by the same claim pattern.

---

## P1 — High (security hardening, cost, and reliability)

### 4. Unbounded live listeners on ever-growing collections

- `apps/web/src/observations/ObservationsListPage.tsx:61-81` — the main
  observations table opens an `onSnapshot` with `orderBy` but no `limit()`.
  This collection accumulates every observation district-wide, forever; every
  admin viewing the default "all" tab re-downloads and live-syncs the entire
  history. Read costs and load time grow every school year with no ceiling.
- `apps/web/src/routes/StaffPersonPage.tsx:91-103` — same pattern scoped to
  one person.

**Fix:** add `limit(50)` plus cursor-based "load more" (`startAfter`), or move
historical/finalized observations out of the live-query path.

### 5. Fire-and-forget Firestore writes with no error feedback

Core CRUD flows swallow write failures entirely:

- `apps/web/src/modules/ModulePage.tsx:63-72` (`void setDoc(...)` /
  `void deleteDoc(...)`)
- `apps/web/src/admin/modules/ModuleSectionEditor.tsx:58-84` (add/patch/remove)
- `apps/web/src/admin/staff/StaffPage.tsx:88-94` and the `PatchStaff` callback
  type in `StaffInlineEditors.tsx` (fire-and-forget by design)

**Impact:** on permission-denied, offline, or rules rejection the UI silently
reverts to the last snapshot — the user's edit "did nothing" with zero
feedback. Worst for admin inline edits where silent data loss is easy to miss.
**Fix:** reuse the `savingState`/`saveError` pattern that
`ObservationEditorPage`'s autosave already implements; surface a toast or
inline error on catch.

### 6. Every function pays the `googleapis` cold-start cost

`apps/functions/src/index.ts` barrel-exports all 24 functions;
`tsup.config.ts:12-24` builds a single non-split bundle; and
`lib/drive.ts:1-3`, `lib/sheets.ts:1`, `calendar/lib/googleCalendar.ts:1-7` all
import `googleapis` (a very large SDK) at module top level. Lightweight,
frequently-hit callables like `syncMyClaims` load Drive/Sheets/Calendar code
they never use.

**Fix:** lazily `await import('googleapis')` inside `getDriveClient()` /
`getSheetsClient()` / `buildOAuthClient()`, or split deployment into multiple
Firebase codebases grouped by dependency weight.

### 7. Google Calendar OAuth tokens stored in plaintext

`apps/functions/src/calendar/auth/connectGoogleCalendar.ts:84-96` and
`calendar/lib/googleCalendar.ts:84-96` persist refresh/access tokens as plain
strings in `/userCalendarTokens`. The rules correctly deny all client access
(`firestore.rules:307-309`, and this is tested), but that is the only control —
a rules regression, Admin-SDK misuse, or a Firestore export/backup exposes
every staff member's long-lived calendar credential.

**Fix:** envelope-encrypt the tokens with Cloud KMS before writing; decrypt
only inside `getCalendarClientFor`.

### 8. Email template substitution does not HTML-escape values

`apps/functions/src/lib/emailUtils.ts:19-21` — `substituteVariables` performs
raw string replacement of `{{var}}` into HTML email bodies, and it is used by
every email sender (`sendManualEmail`, `onStaffWritten`,
`createObservationWindow`, `bookObservationSlot`, ...). Values like
`observedName` and `cancellationReason` are user-editable Firestore fields.

**Impact:** malformed or malicious content in a name/reason field is injected
as raw HTML into emails sent to other staff.
**Fix:** HTML-escape all substituted values by default, with an explicit
opt-out for the few genuinely pre-rendered variables (e.g. link hrefs).

### 9. Rules validate _who_ can write, not _what_ they write

- `firestore.rules:264-279` — an observer editing a Draft can freely rewrite
  `observedName`, `observedRole`, `observedYear`, and `type` (none are in the
  `unchanged()` list) or inject arbitrary fields. Zod validation runs only in
  the browser; a scripted client with valid claims bypasses it entirely.
  Mutating `type` mid-draft breaks downstream assumptions.
- `firestore.rules:184-186` — the observer branch on `observationWindows`
  allows updating _any_ field of the window — `invitedEmails`,
  `peBusyIntervals`, `dayCounts`, `status` — even though the file's own comment
  (lines 176-178) says staff never write these directly. (The `slots` /
  `preferences` ledgers are correctly `write: if false`, so booking accounting
  itself is safe.)
- `firestore.rules:288-294` — the acknowledge branch restricts which keys
  change but never asserts `acknowledgedBy == request.auth.token.email`.

**Fix:** add `diff().affectedKeys().hasOnly([...])` constraints and identity
assertions to these branches, and/or route observation mutations through a
callable that validates with the shared Zod schema (as finalize and booking
already do).

### 10. Hardcoded environment values in scripts and workflows

- Project ID `peer-evaluator-rubric` is hardcoded in five places:
  `scripts/dev-auth-server.mjs:22`, `scripts/check-staff.mjs:5`,
  `scripts/delete-observation.mjs:12`, `scripts/seed-admin-staff.mjs:12`,
  `scripts/import/firebase.ts:6`.
- A personal admin email is the fallback default in
  `scripts/import/import.ts:109`.

**Fix:** centralize in env vars (`FIREBASE_PROJECT_ID`,
`IMPORT_SECURITY_ADMIN_EMAIL`) that fail fast when unset. (The OAuth _client
ID_ inlined in `deploy-dev.yml`/`deploy-prod.yml` is public by design and not a
secret, but moving it to a GitHub variable alongside this cleanup would keep
config in one place.)

---

## P2 — Medium

### Functions efficiency

- **Sequential N+1 loops in `createObservationWindow`**
  (`apps/functions/src/scheduling/createObservationWindow.ts:76-100, 106-113, 210-258`):
  one awaited staff read per invitee and one awaited email send at a
  time. With 40+ invitees this risks the 120s timeout. Use `getAll()` /
  `Promise.allSettled` — the correct pattern already exists in
  `onRoleYearMappingWritten.ts:47-74`. Same serial-email issue in
  `expireObservationWindows.ts:73-105`.
- **Full-collection scans as "find one by field"**:
  `finalizeObservation.ts:80-83`, `geminiTagScript.ts:105-108`, and
  `scheduledEmailReminders.ts:85-91` read the entire `/roles` collection to
  find one role. `backfillScriptTagColors.ts:46-66` and
  `migrateRolesToSlugs.ts:45-52,113` read all of `/observations` unbounded
  (already needing the max 540s timeout). Use `.where(...).limit(1)` and
  cursor-paginated migrations.
- **Inconsistent callable input validation**: scheduling callables validate
  with shared Zod schemas; `finalizeObservation.ts:55-58`,
  `geminiTagScript.ts:62-65`, `uploadEvidenceFile.ts:64-73`, and
  `sendManualEmail.ts:35-41` use ad-hoc presence checks. Add Zod schemas in
  `@ops/shared` for every callable.

### pdf-renderer

- **Puppeteer singleton never self-heals**
  (`apps/pdf-renderer/src/index.ts:52-68`): if `puppeteer.launch()` rejects or
  the browser crashes, the cached broken promise poisons every subsequent
  request until Cloud Run recycles the container. Reset `browserPromise = null`
  on launch failure and on `browser.on('disconnected', ...)`.
- **Google Fonts fetched over the network on every render**
  (`apps/pdf-renderer/src/template.ts:226` + `networkidle0` wait in
  `index.ts:35`): an external round-trip per PDF. Self-host the woff2 files.

### Rules cost

- **`get()` fan-out on the module-items collection-group rule**
  (`firestore.rules:61-70,137-143`): up to four `get()` calls per returned doc
  on the dashboard's `collectionGroup('items')` query. Hoist the staff doc
  fetch so it happens once, or denormalize the auto-enable decision onto item
  docs.

### Testing & CI

- **E2E infrastructure exists but never runs**: `apps/web/playwright.config.ts`
  points at an `e2e/` directory with no specs, and CI never invokes
  `pnpm test:e2e`. Either write the first specs and add the CI step, or remove
  the config until then.
- **Zero unit tests for most function subsystems**: only `scheduling/engine/`
  is tested. Auth claims (`syncMyClaims`, `onStaffWritten`), observation
  finalization, email delivery, calendar, and transcription have none — these
  are the highest-value targets given findings 3, 8, and the idempotency
  concerns above.
- **`apps/pdf-renderer` is invisible to CI**: no build, typecheck, or test step
  in `.github/workflows/ci.yml` and no root script targets. Add
  `pnpm --filter @ops/pdf-renderer build` (and typecheck) to CI.
- **Rules-test gaps** (`tests/rules/`): untested paths include
  `transcriptionJobs` get/list split (`firestore.rules:320-325`),
  `dashboardQuickMaterials` (`:339-342`), the `mail` deny (`:331-333`), the
  observation acknowledgement branch (`:288-294`), and "observer cannot delete
  a Finalized observation" (`:299`).
- **Coverage configured but never published**: vitest configs emit
  `text`/`html`/`lcov` but CI doesn't upload artifacts or report trends.

### Frontend quality

- **Index-as-key on a mutable list**
  (`apps/web/src/admin/buildings/BuildingSchedulePage.tsx:414-415, 468`):
  overrides support remove-from-middle, so React reuses DOM/input state across
  the wrong rows after a deletion. Key on a generated stable id.
- **Duplicated Tiptap toolbar**: `components/ui/tiptap-editor.tsx` and
  `observations/ScriptEditor.tsx` contain near-verbatim copies of
  `ToolbarButton`/`Divider`/`insertOrEditLink`. Extract a shared module.
- **`window.prompt()` for link insertion and booking cancellation**
  (`tiptap-editor.tsx:238`, `ScriptEditor.tsx:492`, `BookingPage.tsx:395`):
  blocking, unstyled, and no URL validation (a `javascript:` href can be set as
  a link). Replace with the existing `Dialog` + `Input` pattern and validate
  the protocol.
- **Duplicate listeners for always-mounted collections**: `AppSidebar.tsx:261-268`
  subscribes to `roles`/`rubrics`/`modules` for the app's lifetime while many
  pages independently re-subscribe to the same collections. The hooks share
  snapshots via TanStack Query but not the underlying `onSnapshot`. Lift these
  slow-changing collections into a context near the app root (the
  `ActiveObservationTypesContext` pattern).

### Ops & build

- **Destructive one-shot scripts have no guardrails**:
  `scripts/delete-observation.mjs` (especially), `check-staff.mjs`,
  `seed-admin-staff.mjs` lack `--confirm`/`--dry-run` flags. The import script
  (`scripts/import/import.ts`) does this well — copy its pattern.
- **Mixed npm/pnpm in the functions deploy path**: `package.json:30` and the
  deploy workflows run `npm install` inside `apps/functions/lib` while the rest
  of the repo is pnpm. It works (the generated `lib/package.json` pins runtime
  deps) but is a version-skew risk worth documenting or unifying.

---

## P3 — Low

- **Gemini API key passed as a `?key=` query param** instead of the
  `x-goog-api-key` header (`geminiTagScript.ts:213`,
  `onTranscriptionJobCreated.ts:171,255,280,320`,
  `pruneOrphanGeminiFiles.ts:101`) — avoids the key ever landing in a log or
  proxy trace.
- **`toDate()` reimplemented 4+ times with slightly different accepted inputs**
  (`calendar/lib/googleCalendar.ts:192-208`, `scheduling/engine/blocking.ts:14-20`,
  `scheduling/engine/schedulingEmail.ts:13-21`,
  `scheduling/onBuildingScheduleWritten.ts:97-102`) — consolidate into
  `@ops/shared`.
- **Unused dependency**: `apps/pdf-renderer/package.json:26` lists
  `firebase-admin`, which nothing imports — dead weight in the Docker image.
- **Dead rules helper**: `isCreating()` (`firestore.rules:78-80`) is never
  referenced.
- **pnpm overrides lack provenance comments** (`package.json:76-90`) — note the
  advisory each pin addresses so stale overrides can be retired.
- **`maxInstances` unset on heavy callables** (`finalizeObservation`,
  `geminiTagScript`, `onTranscriptionJobCreated`) — worth a cost/quota-safety
  pass at larger scale.
- **Easy memoization wins**: `AppSidebar.tsx:271-299` derived nav arrays and
  `DashboardView.tsx:77-89` task partitions recompute on every render; cheap
  today, free to fix.
- **Peer Evaluators read full staff PII** (`firestore.rules:92-93`) — this is
  documented intent, but if least-privilege matters, split filter-facing fields
  into a narrower collection.
- **Redundant `npm install --production`** in deploy workflows duplicates what
  `tsup.config.ts`'s onSuccess hook already produces; and deploy workflows
  could gate rules deploy behind an explicit `pnpm test:rules` run.

---

## Done notably well

- **Routing and code-splitting**: every route is `React.lazy`-loaded via a
  single registry with hover/focus prefetching; heavy deps (Tiptap, dnd-kit)
  never reach the initial bundle.
- **`useFirestoreCollection`/`useFirestoreDoc` hooks**: stabilized constraint
  keys, correct listener cleanup at every call site checked, and thoughtful
  TanStack Query integration.
- **Defense-in-depth auth**: domain checks re-applied in every rule, custom
  claims derived server-side from the `staff` doc with no self-write path —
  users cannot self-escalate.
- **Booking concurrency**: all slot/preference mutations run in Firestore
  transactions with client writes denied on the ledgers — double-booking is
  structurally prevented.
- **Transcription pipeline**: idempotent job creation, cleanup in `finally`,
  and a scheduled orphan-sweep as defense in depth.
- **Careful date/timezone handling** throughout (local-noon anchoring to dodge
  DST, explicit `America/Chicago` formatting).
- **Ops hygiene**: dry-run + `--confirm` gates on the importer, a
  loopback-only dev auth server, aligned Node 22 pinning across `.nvmrc`, CI,
  and the functions runtime, strict TypeScript everywhere, and correct hosting
  cache headers.

## Suggested order of attack

1. **Now**: add the five missing composite indexes (config-only, unblocks real
   users); lock down `admin-uploads` reads.
2. **This week**: transactional finalize claim; HTML-escape email variables;
   `limit()` + pagination on the observations list.
3. **Next**: surface write errors in the UI; lazy-load `googleapis`; tighten
   the rules `hasOnly`/identity constraints; parallelize invite emails.
4. **Ongoing**: first e2e spec + CI step, unit tests for auth/finalize/email
   functions, KMS encryption for calendar tokens, script env-var cleanup.
