# Admin Console Audit — 2026-07-29

A three-axis audit of the entire admin console, run as a multi-agent workflow over the merged `main`
at commit `ae71236`.

**Axes audited**

- **A — Wiring.** Is every control in the admin console actually connected end-to-end: control →
  handler → write → persistence → a real consumer that changes product behavior?
- **B — Coverage.** Is everything staff-facing controllable/configurable from the admin console, or
  does a routine district change require a code deploy?
- **C — Usability.** Is the console genuinely easy and professional for a non-developer school
  administrator?

**Method.** Eight parallel area passes (five admin areas on axes A+C, three staff-facing surfaces on
axis B), then four adversarial verifier agents instructed to _refute_ every blocking/high claim by
re-reading the code, then orchestrator dedupe and ranking. 96 raw findings → **54 unique defects**.

**Verification status.** Verifiers returned 32 CONFIRMED, 3 PARTIAL, 0 REFUTED across 35 blocking/high
claims, and corrected 6 severities in both directions (so they were not rubber-stamping). Even so,
**zero refutations across 35 claims warrants a spot-check before acting on any single item** — this
project has a documented history of confident-but-false premises. Items marked `UNVERIFIED` below were
medium/nit severity and did **not** get a second pass; treat their claims as least certain.

**Scope limit.** This was a **code-reading audit**. No agent ran the application. Visual polish,
real interaction feel, and anything only observable in a browser are **not** covered. Axis C findings
here are structural (missing feedback, missing confirmation, developer vocabulary in the UI), not
aesthetic.

---

## How to use this document

Every item below is a **self-contained brief**: it names the files, states the failure scenario, and
specifies the fix, so it can be implemented without this conversation's context. This is the format
the `mass-plan-implementation` skill expects.

Items are grouped into tiers by impact. Within a tier, items are independent of each other unless a
`Depends on:` line says otherwise. Several tiers are deliberately _thematic_ — Tier 3 in particular is
one repeated pattern across six files and is best shipped as a small number of PRs, not six.

**Protected files** (orchestrator-owned, implementers must not touch): `firestore.rules`,
`firestore.indexes.json`, `storage.rules`, `firebase.json`, `.github/workflows/**`.

---

## Themes

Fixing the theme clears the group. These are worth more than the individual findings.

| #      | Theme                                                  | Items                                     | Root cause                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | Authorization re-derived differently at each call site | AC-01, AC-06, AC-08, AC-09                | There is no single source of truth for "is this caller an admin". `callerAccess.ts` was introduced for the email callables but never adopted elsewhere, and the claim-minting functions ignore `isActive` entirely.                   |
| **T2** | Inline/quick-action writes have no error handling      | AC-17 … AC-22                             | The full-form Save flows do this correctly (try/catch + banner + saved-at). The per-row editors bind inputs **directly to the live Firestore snapshot** with no local state, so a rejected write silently reverts the admin's typing. |
| **T3** | Controls that write fields nothing reads               | AC-06, AC-11, AC-12, AC-13, AC-14         | Five admin controls are decorative. Each implies a capability the system does not have.                                                                                                                                               |
| **T4** | The rubric editor can corrupt the instrument           | AC-02, AC-03, AC-27, AC-37                | The evaluation instrument — the thing the product exists to run — has the least defended editor in the console.                                                                                                                       |
| **T5** | District-specific values hardcoded across the stack    | AC-07, AC-32 … AC-36, AC-40, AC-41, AC-45 | Anything a district changes per year or per rebrand. Highest-risk category for an Aug/Sept 2026 cutover.                                                                                                                              |
| **T6** | "Deactivate" does not mean what the admin is told      | AC-04, AC-05, AC-29, AC-53, AC-54         | Deactivation semantics differ per collection and none match the UI copy.                                                                                                                                                              |

---

## Tier 1 — Cutover blockers

Must be fixed before a district uses this in production.

### AC-01 — Archiving a staff member never revokes their access

**Severity:** blocking · **Axis:** A · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/functions/src/auth/onStaffWritten.ts:44-56`, `apps/functions/src/auth/syncMyClaims.ts:78-83`

**Problem.** Both functions compute the `isAdmin` / `hasSpecialAccess` custom claims from `role` and
`hasAdminAccess` only. Neither reads `isActive`.

**Failure scenario.** A peer evaluator or admin leaves the district. An admin clicks **Archive staff
member** (`StaffPage.tsx:399-405`, which patches only `{ isActive: false }`) or uses the StaffDialog
Archive + Save. `role` and `hasAdminAccess` are untouched, so `onStaffWritten` re-mints the **same**
claims. Every Firestore rule keys off those claims. The departed user retains full admin/PE access
indefinitely, including on a fresh sign-in, because `syncMyClaims` has the identical omission.

**Fix.** Fold `isActive` into the claims computation in **both** files:
`const isAdmin = after.isActive !== false && (isAdminRole(role) || hasAdminAccess)`, and the
equivalent for `hasSpecialAccess`. Note `isActive` may be **absent** on real docs (raw Admin SDK reads
bypass Zod defaults), hence `!== false` rather than `=== true`. Consider also force-revoking refresh
tokens on archive, since claims otherwise only take effect on next token refresh.

**Related prior work.** `TODO.md` carries _"Triage the 18 DUPLICATE refactors from dev-paul —
`computeClaims.ts` carries a genuinely new `elevatedAccessRevoked` revoke-on-demotion behavior worth a
deliberate look."_ That deferred item is addressing this exact defect. Read
`computeClaims.ts` at tag `dev-paul-snapshot-2026-07-21` before implementing.

**Verify.** Regression test: archive a staff member with an admin role → assert `setCustomUserClaims`
is called with `isAdmin: false`. Same for a `hasAdminAccess`-only admin, and for `hasSpecialAccess` on
a peer evaluator.

---

### AC-02 — Deleting a middle rubric component then adding one produces duplicate component IDs

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/rubrics/RubricEditorPage.tsx:86-118`

**Problem.** `addComponent()` computes the next ID from array **length**:
`String.fromCharCode(97 + domain.components.length)`.

**Failure scenario.** Domain 1 holds `1a, 1b, 1c`. The admin deletes `1b` (an ordinary edit), leaving
`[1a, 1c]`, length 2. They click **Add component**: `fromCharCode(97+2)` = `'c'` → `newId = '1c'`,
colliding with the existing `1c`. The domain now holds two components with the same ID. From that
point `updateComponent` and `removeComponent` match by ID and apply to **both** — editing one edits
the other, deleting one deletes both. Observation scores keyed by component ID are ambiguous.

**Fix.** Compute the next ID as the smallest letter **not already present** in
`domain.components.map(c => c.id)`, rather than from length. Reject the add outright if the computed
ID already exists.

**Verify.** Unit test the ID generator: `[1a, 1c]` → next is `1b`; `[1a, 1b, 1c]` → next is `1d`.

---

### AC-03 — The rubric component color "Reset" control always crashes Save

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/rubrics/RubricGridEditor.tsx:236-238,404-416`, `RubricEditorPage.tsx` (`updateComponent`)

**Problem.** `onReset` calls `onPatch({ color: undefined })`. `updateComponent` spreads
`{ ...c, ...patch }`, which sets an **own property** `color` whose value is `undefined` (the key
exists). Firestore rejects `undefined` values, so the subsequent Save throws.

**Failure scenario.** An admin picks a custom component color, changes their mind, clicks **Reset**,
then clicks **Save rubric**. The save fails. The admin cannot revert to the automatic color at all,
and the error gives no hint that the Reset click is the cause.

**Fix.** Delete the key rather than assigning `undefined` — have `updateComponent` strip keys whose
patch value is `undefined`, or use Firestore's `deleteField()` sentinel. Prefer stripping, since this
doc is written whole rather than patched.

**Verify.** Regression test: reset a component's color, save, assert the write succeeds and the
persisted component has no `color` key.

---

### AC-04 — Deactivating a Work Product / Instructional Round question hides already-recorded answers

**Severity:** blocking · **Axis:** A · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/observations/QuestionAnswerViewer.tsx:36-40`, `QuestionAnswerForm.tsx`, `apps/web/src/admin/work-product/WorkProductPage.tsx:130`

**Problem.** `QuestionAnswerViewer` queries `workProductQuestions` filtered to `isActive == true`, then
renders only those. Answers to deactivated questions are dropped from the view.

**Failure scenario.** The Work Product admin page's own subtitle reads _"deactivate to hide a question
without deleting its history."_ An admin deactivates a question several teachers already answered. The
recorded answers vanish from the observation view — **including on already-Finalized observations**,
which are supposed to be immutable records. The data is still in Firestore, but the permanent
evaluation record now displays incompletely, directly contradicting the promise the admin was given.

**Fix.** In `QuestionAnswerViewer` (and `QuestionAnswerForm` for the in-progress case), fetch **all**
questions of the relevant type without the `isActive` filter, then render the union of
`{active questions}` ∪ `{any question, active or not, that has a non-empty answer on this
observation}`. Optionally mark the deactivated-but-answered ones as retired.

**Verify.** Regression test: finalize an observation with an answer, deactivate that question, assert
the answer still renders.

---

### AC-05 — Creating a Role/Building/Module with a colliding ID silently overwrites an archived one

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/roles/RolesPage.tsx:355-368`, and the equivalent create paths in `BuildingsPage.tsx` and `ModulesPage.tsx`

**Problem.** Create mode calls `setDoc` on a slug-derived document ID with no existence check.

**Failure scenario.** An admin created and later archived a role "Media Specialist"
(`roleId: media-specialist`). Because these pages default to the **Active** status filter
(`statusFilter.ts` `DEFAULT_STATUS_FILTER = 'active'`), the archived role is **invisible** in the
default list. Months later another admin clicks **Add role**, types "Media Specialist" (auto-slugified
to the same ID), sets different colors and settings, and saves. The archived doc is silently
overwritten — its configuration is gone, and any staff still referencing that ID now resolve to
different settings than before, with no warning at any point.

**Fix.** Before the create-mode `setDoc`, check the collection for an existing doc with that ID
**regardless of the active filter**, and block the save with "A role with this ID already exists"
— or branch explicitly to an "overwrite this archived entry?" confirm. Apply to all three pages.

**Verify.** Regression test per page: creating over an archived ID is rejected.

---

### AC-06 — Role "Special access" checkbox has zero effect on permissions

**Severity:** blocking · **Axis:** A · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/roles/RolesPage.tsx:396-400,471-480`, `apps/functions/src/auth/syncMyClaims.ts:81`, `apps/functions/src/auth/onStaffWritten.ts:56`, `packages/shared/src/roles.ts:60-66`

**Problem.** The dialog offers **"Special access (can use filter UI / view all observations)"** and
persists `role.isSpecialAccess`. But the actual claim is computed as `isSpecialRole(role) || isAdmin`,
and `isSpecialRole()` hardcodes exactly three slugs (`administrator`, `peer-evaluator`,
`full-access`) with a code comment noting it cannot fetch the roles collection. The field the admin
edits is never read.

**Failure scenario.** An admin creates a "Department Chair" role, checks Special access, and assigns
staff to it — reasonably believing they have granted view-all-observations rights, because the dialog
copy says roles "drive who sees the filter UI (special access)". Nothing happens. Conversely, an admin
who _unchecks_ it on `peer-evaluator` believes they have revoked access that is in fact still granted.
This is a permissions control that silently lies in both directions.

**Fix.** Pick one, deliberately — this is a product decision:

- **(a)** Make `onStaffWritten`/`syncMyClaims` look up the role doc's `isSpecialAccess` field instead
  of the hardcoded allowlist. Correct but adds a Firestore read to claim minting.
- **(b)** Make the checkbox read-only/display-only for the three built-in roles and remove it for
  custom roles, since it cannot apply to them under the current claims model.

**Verify.** Whichever branch: a test asserting the UI and the claim computation agree.

---

### AC-07 — Two hardcoded school-year boundaries disagree for a full month every year

**Severity:** high · **Axis:** B · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/dashboard/StaffDashboardPage.tsx:70-74`, `apps/web/src/utils/staffFormatting.ts` (`schoolYearOf`), `apps/web/src/routes/ProfilePage.tsx:727`

**Problem.** `currentSchoolYearLabel()` rolls over in **August** (`month >= 7`). `schoolYearOf()` rolls
over in **July** (`getMonth() >= 6`, commented as "the legal annual changeover for Minnesota public
schools"). Both are shown to the same user.

**Failure scenario.** Every July, a teacher's dashboard hero reads "Formative cycle · 2025 — 2026"
while an observation finalized that same week files under the **2026–2027** bucket on their Profile
page. Two screens in one app disagree about what school year it is, for a full month, every year.

**Fix.** Introduce one shared helper and have both call sites use it. The July definition carries the
documented legal rationale, so prefer it. Consider an admin-configurable cutover month in AppSettings
(see AC-41), but the immediate fix is agreement.

**Verify.** Unit test both call sites against a July date and assert they agree.

---

## Tier 2 — Broken admin actions and dead controls

### AC-08 — `backfillScriptTagColors` denies every `hasAdminAccess`-only admin

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/functions/src/observations/backfillScriptTagColors.ts:39-42`

**Problem.** Checks only `isAdminRole(request.auth.token['role'])`, ignoring `hasAdminAccess`.

**Failure scenario.** `hasAdminAccess` is a first-class admin path — `App.tsx`'s `requireAdmin` gate
and `syncMyClaims` both compute `isAdmin = isAdminRole(role) || hasAdminAccess`. Such an admin reaches
`/admin/settings` fine, clicks **Run script-tag color backfill**, confirms, and gets a raw
`permission-denied` "Admins only" rendered verbatim. 100% failure for a supported admin class. Its
sibling maintenance action on the same page (`migrateRolesToSlugs.ts:42`) handles this correctly.

**Fix.** Route through `callerMeetsAccessLevel(db, { email, tokenRole, level: 'admin' })` from
`apps/functions/src/lib/callerAccess.ts`.

**Verify.** Test: `hasAdminAccess`-only caller is allowed; plain non-admin rejected.

---

### AC-09 — Transcription "Re-queue" always fails for an admin re-queuing someone else's job

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/functions/src/transcription/requestTranscription.ts:70-73`, `apps/web/src/admin/transcription/TranscriptionJobsPage.tsx:118-126`

**Problem.** `requestTranscription` hard-requires `obs.observerEmail === userEmail` with no admin
bypass. The admin page exists precisely to triage **other people's** failed jobs.

**Failure scenario.** A principal opens `/admin/transcription-jobs`, sees a Failed job from a peer
evaluator, clicks **Re-queue**, and gets `permission-denied: Not your observation`. The button is
useless for its stated purpose in every case except the admin's own jobs.

**Fix.** Add the same admin bypass `regenerateObservationPdf.ts` already uses: compute
`isAdmin = isAdminRole(role) || hasAdminAccess` and enforce the `observerEmail` check only when
`!isAdmin`. Prefer routing through `callerMeetsAccessLevel` for consistency with T1.

**Verify.** Test: admin re-queues another observer's job successfully; non-admin non-observer rejected.

---

### AC-10 — Transcription table never reconciles after a successful re-queue

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/transcription/TranscriptionJobsPage.tsx:118-126`
**Depends on:** AC-09 (this is only reachable once re-queue can succeed)

**Problem.** `handleRequeue` sets local `requeueState[jobId] = 'done'` but never re-fetches or patches
the `jobs` array.

**Failure scenario.** After a successful re-queue the row still shows **Failed** with its error text,
while a **Queued** label appears next to the button — a row simultaneously claiming both states. The
admin cannot tell whether the retry worked without a full page reload.

**Fix.** On success, either optimistically patch that job to `Pending` and clear its error, or re-run
`load()`.

**Also (same file, `error` branch):** the catch discards the error message and only sets a generic
`'error'` state, so the admin sees a red button and no explanation. Capture and surface the message,
as every other handler on this page and its siblings do.

---

### AC-11 — Email template "Recipient" selector is cosmetic for 14 of 17 trigger types

**Severity:** blocking · **Axis:** A · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx:762-786`, `apps/functions/src/observations/finalizeObservation.ts:319`, `apps/functions/src/scheduling/createObservationWindow.ts:258-259`

**Problem.** Only three trigger types honor `template.recipient` (the switch in
`scheduledEmailReminders.ts`). The other 14 send paths hardcode their recipient.

**Failure scenario.** An admin opens **Observation Finalized**, changes Recipient from "To: Staff" to
"To: Both" so the peer evaluator also gets a copy, and saves. The save succeeds and the badge updates.
Every subsequent finalization email still goes only to `obs.observedEmail`. The admin has no way to
discover the setting is ignored.

**Fix.** Either wire every send path to honor `template.recipient` (extend the
`scheduledEmailReminders.ts` switch pattern), **or** extend `FIXED_RECIPIENT_TRIGGER_TYPES` /
`FIXED_RECIPIENT_DESCRIPTION` to cover every trigger whose code path ignores the field, so the
selector renders disabled with the real fixed recipient explained. The second is far cheaper and
removes the lie; the first is the real feature.

**Verify.** A test asserting that for every trigger type, either the send path reads
`template.recipient` or the trigger is listed in `FIXED_RECIPIENT_TRIGGER_TYPES`. This makes the
invariant permanent.

---

### AC-12 — "Send Test…" is offered on every template but only works for `manual`

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx:844-847`, `apps/functions/src/email/sendManualEmail.ts:60-62`

**Problem.** `sendManualEmail` throws `invalid-argument: Only manual templates can be sent this way`
for any non-`manual` trigger type. The button is shown on all 17 templates.

**Failure scenario.** An admin editing "Scheduling: Window Invite" clicks **Send Test…**, types their
address, clicks Send Test, and gets the raw callable error. 16 of 17 templates fail 100% of the time,
and only _after_ the admin has filled in the dialog — for the one feature whose entire purpose is
"let me check what this looks like before it goes out."

**Fix.** Hide or disable **Send Test…** for non-`manual` templates with a short explanation. Better,
if cheap: extend the callable to render any template against sample variable data and send that to the
requesting admin only.

**Verify.** Test asserting the button is not rendered for a system template.

---

### AC-13 — "Schedule active" checkbox on a building schedule is dead

**Severity:** blocking · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/buildings/BuildingSchedulePage.tsx:874-882`, `apps/functions/src/scheduling/slotGeneration.ts:126-127`

**Problem.** `BuildingSchedule.isActive` is written but read nowhere. Only `effectiveFrom`/
`effectiveTo` gate slot generation.

**Failure scenario.** An admin needs to pause bookings for a building (closing mid-year, construction,
a schedule being reworked). They uncheck **Schedule active** and save. Slots keep generating and
remain bookable, exactly as before. Nothing on screen indicates the checkbox did nothing.

**Fix.** Either wire `isActive` into slot generation (skip generation/booking for a building whose live
schedule has `isActive: false`) or remove the checkbox. Wiring it is the better answer — the
capability is genuinely useful and the label already promises it.

**Verify.** Test: slot generation produces zero slots for an inactive schedule.

---

### AC-14 — "Observation saves per minute" rate limit is enforced nowhere

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/settings/SettingsPage.tsx:309-330`, `apps/functions/src/lib/rateLimit.ts:22-27`

**Problem.** `RATE_LIMIT_KEYS` defines `audioUpload`, `transcription`, `pdfRegen` — nothing for
observation saves. No save path calls `checkRateLimit` with any related key.

**Failure scenario.** An admin worried about a runaway autosave loop lowers the value from 60 to 5 and
saves, seeing "Saved at …". Nothing changes. The console has advertised a safety control that does not
exist — worse than not offering it, because the admin now believes they are protected.

**Fix.** Either wire a real `observationSave` key into the observation persistence path, or remove the
field from Settings **and** the schema until enforcement exists. Given observation saves are direct
client `setDoc` writes (not a callable), enforcing this properly means routing saves through a
callable — a real M/L change. Removing the field is the honest S fix.

---

### AC-15 — Two templates can be active for the same trigger; the server picks arbitrarily

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/functions/src/lib/emailUtils.ts:49-62`, `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx` (`createTemplate`, `toggleActive`)

**Problem.** Nothing in the UI, the callables, or `firestore.rules` prevents two `isActive: true`
templates sharing a `triggerType`. `loadActiveTemplate()` takes whichever the query returns first.

**Failure scenario.** An admin creates a variant of "Observation Finalized" to try new wording and
activates it without deactivating the original. Two active templates now exist for that trigger. Which
one staff receive depends on Firestore's document ordering — it may differ between sends and will look
like a random intermittent bug.

**Fix.** Before activating (both `toggleActive` and `createTemplate`), query for an existing active
template with the same `triggerType` and either block with an explanatory error, or atomically
deactivate the previous one in the same write. The atomic swap is friendlier.

**Verify.** Test: activating a second template for a trigger deactivates the first (or is rejected).

---

### AC-16 — A system template's trigger can be silently reassigned, killing that event's email

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx:746-761,848`

**Problem.** `isSystem` guards only the **Delete** button. The Trigger `<select>` is fully editable for
every template.

**Failure scenario.** An admin opens the "Observation Finalized" system template to fix a typo and
changes the Trigger dropdown — by accident or experimentally — then saves. `loadActiveTemplate()` now
finds zero active templates for `observation.finalized`, and finalization emails stop entirely. No
warning is shown, no error occurs, and nothing surfaces that a trigger has zero active templates.

**Fix.** Guard `triggerType` edits on `isSystem` templates the same way Delete is guarded. Separately,
warn whenever a save would leave any trigger with zero active templates.

---

## Tier 3 — Missing error handling on inline/quick-action writes

**One pattern, six files.** The full-form Save flows on these same pages do this correctly (try/catch,
inline error banner, saved-at confirmation). The per-row controls do not — and critically, most bind
their inputs **directly to the live Firestore snapshot** with no local draft state, so a rejected
write silently reverts what the admin typed with no message at all.

**Realistic trigger:** a principal leaves the tab open for hours and their ID token expires, or a
laptop drops off school wifi mid-edit.

**Recommended shape:** ship as 2–3 PRs, not six. Extract the pattern once (a small
`useGuardedWrite`-style helper or a shared inline-error affordance), then apply it.

| ID        | File                                                           | Controls affected                                                                                                                                                                                             | Sev    |
| --------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **AC-17** | `admin/work-product/WorkProductPage.tsx:86-101,212-246`        | Inline question text (writes **per keystroke**, bound to live doc), type select, Active toggle, and `confirmDelete()` — a failed delete leaves the dialog open forever because `setDeleting(null)` never runs | high   |
| **AC-18** | `admin/signup-fields/SignupFieldsPage.tsx:100-112`             | Label input (bound to live snapshot, no local state), type, Required/Active checkboxes, options editor, `confirmDelete()`                                                                                     | high   |
| **AC-19** | `admin/email-templates/EmailTemplatesPage.tsx:343-349,434-438` | Row **Active** toggle and `deleteTemplate()` — both `void`-ed at the call site, so rejections are unhandled promise rejections only                                                                           | high   |
| **AC-20** | `admin/modules/ModuleBuilderPage.tsx:47-53`                    | **Every write on the page.** `patchModule` is `void setDoc(...)` with no `.catch`, no loading state, no success/failure indicator: staff-page toggle, sidebar icon, section add/reorder/delete/retitle        | high   |
| **AC-21** | `admin/modules/ModulesPage.tsx:138-142`                        | Row-menu Delete — same stuck-dialog failure as AC-17                                                                                                                                                          | high   |
| **AC-22** | `admin/role-year-mappings/RoleYearMappingsPage.tsx:178-185`    | Year pill color swatches — selected state is derived from the read-back doc, so a failed write is **indistinguishable from not having clicked**                                                               | medium |

**Fix for all.** Wrap in try/catch, surface via the inline error pattern already used on each page
(`saveError` / `itemError`). For the two per-keystroke inputs (AC-17, AC-18), additionally give the
field **local component state with an onBlur or debounced commit** — writing on every keystroke to a
live-bound input is the root of the silent-revert behavior.

**Verify.** Per item: a test asserting a rejected write surfaces a visible error and does not leave a
dialog stuck.

---

## Tier 4 — Data integrity and validation

### AC-23 — Module resource "Link URL" has no validation, producing broken staff-facing links

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/modules/ModuleSectionEditor.tsx:201-210`, `packages/shared/src/schema/moduleItem.ts:34-35`

**Problem.** `moduleItem.ts` declares `linkUrl: z.url().optional()`, but `patchItem` is a direct client
`setDoc` — **the Zod schema never runs on this write path**, and `firestore.rules` only checks
`isAdmin()`. No validation occurs anywhere.

**Failure scenario.** An admin types `orono.k12.mn.us/handbook` (no scheme) into Link URL. It saves
cleanly. Staff clicking it on the module page get a broken relative-URL navigation. The admin has no
signal anything is wrong.

**Fix.** Validate/normalize client-side before writing — reject schemeless values or auto-prepend
`https://`, surfacing errors through the existing `itemError` banner. Render a live preview link in the
editor so a broken URL is visible immediately.

---

### AC-24 — No validation that Effective From precedes Effective To

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/buildings/BuildingSchedulePage.tsx:240`, `apps/functions/src/scheduling/slotGeneration.ts:126-127`

**Problem.** `save()` calls `validatePeriodBounds()` (per-period start/end times) but never checks
`effectiveFrom <= effectiveTo`.

**Failure scenario.** An admin transposes the two date pickers. The write succeeds. Every candidate
date now fails the range check in slot generation, so the building **silently generates zero bookable
slots** — discovered only when staff report they cannot book anywhere in that building.

**Fix.** Add the comparison to `save()`'s validation with a clear inline message.

---

### AC-25 — "Add staff" doesn't enforce the district email domain that CSV import and sign-in both require

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/staff/StaffDialog.tsx:191-194`, `apps/web/src/admin/staff/staffCsv.ts` (`ALLOWED_EMAIL_DOMAIN`), `apps/functions/src/auth/syncMyClaims.ts:66-71`

**Problem.** `StaffDialog.save()` checks only `!email.trim() || !email.includes('@')`.

**Failure scenario.** An admin adding a new hire pastes a personal or wrong-domain address. The record
saves, `onStaffWritten` fires an invite email to it, and that person can **never** sign in — Google SSO
and `syncMyClaims` both reject non-`@orono.k12.mn.us` accounts. The record sits permanently in the
"Invited but never signed in" card with nothing indicating the real cause.

**Fix.** Reuse `ALLOWED_EMAIL_DOMAIN` (already imported in `staffCsv.ts`) in `StaffDialog.save()`, so
manual add/edit rejects off-domain addresses exactly as CSV import does.

---

### AC-26 — Saving a live bell schedule silently triggers booking reconciliation

**Severity:** high · **Axis:** C · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/buildings/BuildingSchedulePage.tsx:240-272,899-901`, `apps/functions/src/scheduling/onBuildingScheduleWritten.ts`

**Problem.** When not editing a draft, `save()` writes straight to the live
`buildingSchedules/{buildingId}` doc — firing the same `onBuildingScheduleWritten` reconciliation that
**Activate draft** fires. Only the Activate path has a disclosure dialog; plain **Save schedule** has
no confirmation at all.

**Failure scenario.** An admin fixes a five-minute typo in a period's end time mid-year and clicks Save.
Every open or partially-booked observation window in that building is immediately reconciled and
affected staff are emailed — an outcome the Activate dialog explicitly warns about and this path does
not mention. The most common editing path is the undisclosed one.

**Fix.** Show the same disclosure (or a lighter one-line notice) before saving a live schedule edit
whenever open/partially-booked windows depend on it, or route all live-doc edits through the Activate
dialog's disclosure.

---

### AC-27 — Editing a live rubric changes what evaluators see mid-observation, with no warning

**Severity:** blocking · **Axis:** A · **Effort:** L · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/rubrics/RubricEditorPage.tsx:163-187`, `apps/web/src/observations/ObservationEditorPage.tsx:149-172`, `packages/shared/src/schema/observation.ts:86-99`

**Problem.** `rubricSnapshot` is populated **only** when `observation.status === finalized` (and is
cleared on reopen). Every Draft observation reads the live `/rubrics/{id}` doc directly.

**Failure scenario.** A peer evaluator is actively scoring against component 2b's descriptors. An
admin, unaware anyone has it open, rewords that descriptor — or deletes the component — and clicks
**Save rubric**. There is no confirmation, no count, no message of any kind on the whole-rubric save
path. The evaluator's next reload shows different criteria mid-evaluation. The per-component delete
flow _does_ warn (`RubricGridEditor.tsx:336-351`); the whole-rubric save does not.

**Fix (staged).**

1. **S, do first:** before saving, query for non-finalized observations referencing this rubric and
   show a count warning — "N in-progress observations are using this rubric; saving changes what
   evaluators see immediately."
2. **L, the real fix:** add a genuine draft/published rubric state so edits can be staged and published
   deliberately, and/or snapshot the rubric at observation **start** rather than at finalize.

Ship (1) now; (2) deserves its own design pass.

---

### AC-28 — Sign-up detail field labels never reach the observation editor

**Severity:** high · **Axis:** B · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/observations/SignupDetailsCard.tsx:61-63`, `apps/web/src/scheduling/SignupDetailsDisplay.tsx`, `apps/web/src/admin/signup-fields/SignupFieldsPage.tsx:79`

**Problem.** `fieldId` is auto-generated as `f-${Date.now()}`. `SignupDetailsCard` renders
`answer.fieldId.replace(/-/g, ' ')` instead of looking up the field's `label`.

**Failure scenario.** An admin adds a field labelled "Which room number?". The booking form shows it
correctly (`SignupDetailFields.tsx:100` renders `field.label`). The PE later opens that observation and
the Booking Details card shows **"f 1774812345678"**. The admin-authored label reaches staff at booking
time but not the evaluator reading it later.

**Fix.** Either denormalize the resolved label onto `signupFieldAnswer` at write time (booking and
day-preference assignment paths), or pass the live `/signupFields` collection (or a `fieldId → label`
map) into `SignupDetailsCard`/`SignupDetailsDisplay` and resolve as `SignupDetailFields.tsx` already
does. Denormalizing is more robust — it survives the field later being deleted.

---

### AC-29 — Deactivating a module leaves its participation chip on staff dashboards

**Severity:** high · **Axis:** A · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/modules/ModulesPage.tsx:387`, `apps/web/src/components/layout/AppSidebar.tsx:290`, `apps/web/src/dashboard/StaffDashboardPage.tsx`

**Problem.** `AppSidebar` filters on `m.isActive`; the dashboard's module-chip derivation does not.

**Failure scenario.** An admin bulk-deactivates the "Mentor" module at year end, expecting it to stop
showing (the page subtitle promises "participation tracks shown as color chips on staff dashboards").
The sidebar entry disappears but the chip remains on every staff dashboard — now pointing at a module
with no page to open.

**Fix.** Apply the same `isActive` filter in the dashboard chip derivation.

---

### AC-30 / AC-31 — Two scheduling settings are enforced client-side only

**Severity:** medium · **Axis:** A · **Effort:** S each · **Confidence:** UNVERIFIED

- **AC-30** — `apps/functions/src/scheduling/bookObservationSlot.ts:354`. Required sign-up fields are
  gated in the UI (`SignupDetailFields.tsx:41-49`) but the callable that persists the booking never
  re-validates, so a direct callable invocation or a stale client can persist a booking missing
  required answers.
- **AC-31** — `apps/functions/src/scheduling/createObservationWindow.ts:154`. `allowedBookingModes`
  restricts the client's mode picker, but the callable writes whatever `bookingMode` it is sent. A PE
  on a stale tab can create a window in a mode the admin disabled.

**Fix.** Re-validate both server-side against the settings doc. These are trust-the-client gaps rather
than active bugs — no malicious actor is assumed, but the admin's setting is not actually binding.

---

## Tier 5 — Coverage gaps (things a district must change without a deploy)

This is the highest-risk tier for the Aug/Sept 2026 cutover: every item is something that changes per
district, per rebrand, or per school year.

### AC-32 — Branding primary color never reaches outbound email

**Severity:** high · **Axis:** B · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `packages/shared/src/email/renderEmailShell.ts:27-36`, `apps/web/src/admin/email-templates/CtaButton.ts`

**Problem.** The email shell hardcodes `BLUE = '#2d3f89'` for the header border, headings, links,
footer background, and CTA buttons.

**Failure scenario.** A district rebrands, sets a maroon primary color, and confirms it in the nav, the
Branding preview, and the finalized-observation PDF — all of which honor it. Every email the system
sends, including the one announcing that same finalized observation, still renders in stock OPS blue.

**Fix.** Thread the branding primary color into `renderEmailShell` and the CTA button builder. Note
these run **server-side** in `apps/functions`, so the color must be read from the settings/branding doc
at send time, not from a CSS variable.

---

### AC-33 — Branding never reaches the sign-in screen

**Severity:** high · **Axis:** B · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/auth/SignInScreen.tsx:70-81`

**Problem.** Hardcodes `<img src="/brand/primary-logo.png">` and a literal heading, despite the App
name field's own help text claiming it appears on "the top nav, **sign-in screen**, and email subject
lines."

**Failure scenario.** An admin uploads a district logo and sets the app name, then signs out to check
the first impression a new teacher gets — and sees the stock branding. The admin console explicitly
promised this surface.

**Fix.** Read branding on the sign-in screen. Note it renders **pre-auth**, so it cannot depend on an
authenticated Firestore read — source it from a public settings doc or build-time config, whichever the
rules already permit.

---

### AC-34 — Blocked-access screens hardcode a vague support contact

**Severity:** high · **Axis:** B · **Effort:** S · **Confidence:** CONFIRMED
**Files:** `apps/web/src/auth/SignInScreen.tsx:108-111`, `apps/web/src/routes/Unauthorized.tsx`

**Problem.** Both screens say only "contact a peer evaluator administrator" — no name, email, or link,
and no admin field anywhere to set one. A `securityAdminEmail` setting exists but is not used here.

**Failure scenario.** A newly hired teacher is blocked at sign-in and is told to contact an
unidentified person. They have no way to know who. The admin cannot fix this without a code change.

**Fix.** Surface the existing `securityAdminEmail` setting (or add a dedicated support-contact field)
on both screens. Same pre-auth constraint as AC-33.

---

### AC-35 — Finalized-observation PDF footer hardcodes the district name

**Severity:** medium · **Axis:** B · **Effort:** S · **Confidence:** UNVERIFIED
**Files:** `apps/pdf-renderer/src/template.ts:257`

Every PDF — the permanent record a staff member keeps — ends with "Orono Public Schools · {appName} ·
Generated {date}". The app-name segment honors Branding; the district name does not. **Fix:** source it
from branding/settings alongside `appName`.

---

### AC-36 — Rubric proficiency-scale labels are hardcoded

**Severity:** medium _(downgraded from high by verifier)_ · **Axis:** B · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/components/rubric/RubricGrid.tsx:18-23`

An admin can rewrite every domain name, component title, descriptor paragraph, and look-for — but not
the four column headers (Developing / Basic / Proficient / Distinguished). Renaming a tier (e.g. "Basic"
→ "Emerging") is a common revision when a district updates a Danielson-style framework.

**Fix.** Move the four labels onto the rubric document with the current values as defaults, and expose
them in `RubricEditorPage`. Check every consumer of the scale (PDF renderer, `MyRubricPage`, finalized
snapshots) — this value is rendered in more than one app.

---

### AC-37 — A rubric cannot be created from scratch, and a domain can never be removed

**Severity:** high · **Axis:** B · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/rubrics/RubricsListPage.tsx:104-111`, `apps/web/src/admin/rubrics/RubricGridEditor.tsx` (no per-domain delete), `RubricEditorPage.tsx:120-129`

**Problem.** The only creation affordances are **Duplicate** (requires an existing similar rubric) and
**Add role** — which navigates to `/admin/roles` and creates a Role doc pointing at a `rubricId` that
**is never created** (`RolesPage.tsx:342-375` writes no companion rubric doc). Separately, `Add domain`
exists with no corresponding remove control anywhere in the 420-line editor.

**Failure scenario.** A principal sets up a new "Instructional Coach" role for next year. They click
Add role, fill it in, return to Rubrics — and nothing new appears. Staff in that role see "No rubric is
set up for the role X." Separately, a stray double-click on **Add domain** adds an empty domain that
cannot be removed without a developer.

**Fix.** Add a **New rubric** action on `RubricsListPage` that creates a minimal valid rubric directly,
and add a per-domain delete with a confirm mirroring the existing component-delete flow. Optionally
have role creation offer to scaffold a matching rubric when none exists.

---

### AC-38 — The audit log never writes most of the actions it declares

**Severity:** high · **Axis:** A · **Effort:** M · **Confidence:** **PARTIAL** — two auditors counted
15/26 and 18/27; the exact number needs recounting during implementation, the pattern is confirmed
**Files:** `packages/shared/src/schema/auditLog.ts:15-43`, `apps/web/src/admin/audit-log/AuditLogPage.tsx:318`

**Problem.** The page describes itself as an "append-only record of privileged actions (sign-ins,
observation lifecycle, admin edits)". Most declared `AUDIT_ACTIONS` are written by nothing —
including `settings_updated`, the `staff_*` family, `role_changed`, `rubric_updated`, `sign_out`,
`sign_in_rejected`, and the transcription lifecycle. Settings and Dashboard saves are **direct client
`setDoc` writes with no audit path at all**.

**Failure scenario.** An admin investigating "who changed the security admin email last month" filters
to `settings_updated` and gets zero rows — forever. The filter dropdown advertises coverage the system
does not have, so an empty result reads as "it didn't happen" rather than "we don't record that."

**Fix.** Decide per action, then do one of:

- **(a)** Add `writeAuditLog` calls at the relevant server paths. For Settings and Dashboard this
  requires routing those saves through a callable, since client `setDoc` cannot write a trustworthy
  audit entry — a real M/L change.
- **(b)** Prune `AUDIT_ACTIONS` to what is actually written, so the filter stops advertising coverage
  that doesn't exist.

Do **(b)** immediately regardless; it is cheap and stops the log from misleading. Then do (a) for the
actions that genuinely matter for a school district's records.

**Related:** `TODO.md` already carries the narrower `rate_limit_tripped` backfill item. Fold it in.

---

### AC-39 — `observationFinalized` audit action is dead; finalize writes an undeclared string

**Severity:** medium · **Axis:** A · **Effort:** S · **Confidence:** UNVERIFIED
**Files:** `apps/functions/src/observations/finalizeObservation.ts:302`

Writes `action: 'observation.finalize'` (dot-separated, ad hoc) instead of
`AUDIT_ACTIONS.observationFinalized` (`'observation_finalized'`). Filtering by the enum-backed dropdown
option returns zero rows even though finalizations **are** being logged, under a different string.

**Fix.** Write the schema constant, or update the constant to match reality and remove it from
`FUNCTION_AUDIT_ACTIONS`. Do this with AC-38.

---

### AC-40 — Year-tier terminology is hardcoded in three places that disagree with each other

**Severity:** medium · **Axis:** B · **Effort:** M · **Confidence:** UNVERIFIED
**Files:** `apps/web/src/dashboard/StaffDashboardPage.tsx:65-68` (`yearTierLabelFor`), `apps/web/src/utils/staffFormatting.ts` (`yearStatusLabel`, `yearLabel`)

The same `staff.year` number renders as **"Probationary Y1"** on the dashboard, **"Tenured Year 2" /
"Probationary 1"** on the Profile badge, and **"P1"/"Y1"** elsewhere. None is admin-editable, and the
three don't agree. Probationary/tenured terminology is contract language that varies by district and
bargaining unit.

**Fix.** Consolidate to one helper, then consider exposing the labels in settings.

---

### AC-41 — School-year label has no admin override

**Severity:** medium · **Axis:** B · **Effort:** S · **Confidence:** UNVERIFIED
**Files:** `apps/web/src/dashboard/StaffDashboardPage.tsx:70-75`
**Depends on:** AC-07 (fix the disagreement first, then make the agreed helper configurable)

The displayed academic year is derived purely from the system clock with a hardcoded cutover month. No
field in AppSettings, DashboardConfig, or any admin page overrides it. **Fix:** add a cutover-month (or
explicit year-label) setting once AC-07 has unified the two implementations.

---

### AC-42 … AC-47 — Remaining coverage gaps

| ID        | Gap                                                                                                                                            | File                                                                                              | Sev    | Note                                                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-42** | Observation types are a fixed 3-element enum with no admin page to add/rename/retire one                                                       | `packages/shared/src/constants.ts:97-103`                                                         | medium | **Judgment call.** Each type is architecturally bespoke (own answer-form component, own question wiring), so this may be a legitimate engineering boundary rather than a district-tunable list. Flagged for your decision, not recommended as-is. Effort L.                       |
| **AC-43** | Evidence upload size limit (20 MB) hardcoded on client **and** server                                                                          | `components/rubric/RubricRow.tsx:100-101`, `functions/src/observations/uploadEvidenceFile.ts:106` | medium | Both must change together.                                                                                                                                                                                                                                                        |
| **AC-44** | Dashboard urgency thresholds hardcoded: `DEADLINE_URGENCY_DAYS=3`, `SOON_WINDOW_DAYS=7`                                                        | `dashboard/deriveCheckpoints.ts:152`, `dashboard/deriveModuleTasks.ts:4`                          | medium | Add optional fields to `DashboardConfig`, editable on the Layout tab, defaulting to today's values.                                                                                                                                                                               |
| **AC-45** | Calendar-conflict warning copy shown to staff is a hardcoded string                                                                            | `scheduling/BookingPage.tsx:68-69`                                                                | medium | The _policy_ that triggers it is admin-tunable; the wording is not.                                                                                                                                                                                                               |
| **AC-46** | "Your peer evaluator" card hardcodes the literal label `'Peer Evaluator'`                                                                      | `dashboard/StaffDashboardPage.tsx:309`                                                            | medium | Roles are explicitly renameable. Every other label in this same file resolves via `roleDisplayName` (line 262-265). **Fix:** `roles?.find(r => r.roleId === SPECIAL_ROLES.peerEvaluator)?.displayName ?? 'Peer Evaluator'`, reusing the `roles` data the component already loads. |
| **AC-47** | Profile's "My Administrator" list matches only `role === 'administrator'`, missing the other two admin paths (`full-access`, `hasAdminAccess`) | `routes/ProfilePage.tsx:473-477`                                                                  | medium | Firestore cannot OR across fields in one query, so this needs an extra query or client-side merge. **If the narrow scoping is deliberate** (site admins only, excluding district-office accounts), just document it — but it currently contradicts `AuthProvider.tsx:54-55`.      |

---

## Tier 6 — Usability and polish

Axis C was the healthiest of the three: the layout and information architecture are sound. The
recurring structural flaw is **save-state ambiguity**, not confusing design.

### AC-48 — No unsaved-changes guard, despite one already existing in the codebase

**Severity:** high · **Axis:** C · **Effort:** M · **Confidence:** CONFIRMED
**Files:** `apps/web/src/admin/rubrics/RubricEditorPage.tsx:198-206`, `apps/web/src/admin/settings/SettingsPage.tsx:436-438`, `apps/web/src/admin/dashboard/DashboardSettingsPage.tsx`, plus the existing `useUnsavedChangesGuard` / `UnsavedChangesGuardContext`

**Problem.** `useUnsavedChangesGuard` exists and is **wired up nowhere**. Three admin pages track dirty
state (and even render an "unsaved changes" pill) but nothing blocks navigation.

**Failure scenario.** An admin spends ten minutes rewriting rubric descriptors — the subtitle correctly
reads "… unsaved changes" — then clicks the "All rubrics" back button or a sidebar link. Every edit is
discarded instantly, with no prompt. Same on Settings and the Dashboard builder.

**Fix.** Wire the existing hook into `AppSidebar` as originally designed and adopt it on all three
pages. If that infrastructure is being abandoned, delete it and give each page at minimum a
discard-confirm. Also: `SettingsPage`'s Save button is always enabled (`disabled={saving}` only) — it
should be disabled when clean, matching `DashboardSettingsPage`.

---

### AC-49 … AC-62 — Remaining polish

| ID        | Issue                                                                                                                                                                                                                                                                                                                                                                       | File                                                                | Sev    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| **AC-49** | Audit Log shows raw machine strings (`observation.finalize`, `calendar.eventCreateFailed`, `rate_limit_tripped`) in both the table and the filter dropdown, on a page aimed at non-technical admins. **Fix:** a label map mirroring the `*_LABELS` pattern in `copyStrings.ts`.                                                                                             | `admin/audit-log/AuditLogPage.tsx:285-296,69-74`                    | medium |
| **AC-50** | Sidebar icon picker lists raw lucide slugs (`shapes`, `book-open`, `graduation-cap`) as plain text with no glyph and no preview. **Fix:** render each option with its actual icon, matching the color-swatch picker pattern already used for role/building/module color.                                                                                                    | `admin/modules/ModuleBuilderPage.tsx:115-129`                       | medium |
| **AC-51** | Bulk-edit's destructive toggles (deactivate staff, revoke admin access) apply immediately from a single dialog with no confirm step and no count warning — inconsistent with Rollover and Message-group on the _same page_, both of which do this well.                                                                                                                     | `admin/staff/BulkEditDialog.tsx:238-411`                            | medium |
| **AC-52** | StaffDialog's **Archive** button only flips local form state and requires a second Save, while the identically-labeled row-menu action writes immediately. An admin who used the row action first will reasonably assume the dialog button already took effect, hit Cancel, and never archive the person.                                                                   | `admin/staff/StaffDialog.tsx:477-487` vs `StaffPage.tsx:399-405`    | medium |
| **AC-53** | Deactivating a Role or Building states no count of currently-assigned staff, even though it immediately removes the option from assignment dropdowns and flags every holder with an "⚠ (unmapped)" pill. Delete _does_ disclose this; Deactivate does not.                                                                                                                  | `admin/roles/RolesPage.tsx:471-489`                                 | medium |
| **AC-54** | Deleting a module leaves a dangling reference on staff docs with **no "unmapped" chip**, unlike `RolePill` and `BuildingsPill` which both detect and flag this. **Fix:** add the same fallback branch to `ModuleAccessPill`.                                                                                                                                                | `admin/staff/StaffInlineEditors.tsx:168-223`                        | medium |
| **AC-55** | "Rubric ID" on the Role editor is bare free text — no picker, no existence check. A typo saves fine and surfaces far downstream as "No rubric is set up for the role X" on the teacher's My Rubric page.                                                                                                                                                                    | `admin/roles/RolesPage.tsx:428`                                     | medium |
| **AC-56** | Role/Year Mappings mixes two save semantics on one screen: the matrix requires an explicit Save, the pill-color swatches write instantly on click. An admin who learned "nothing saves until I click Save" from the top of the page will be wrong about the bottom.                                                                                                         | `admin/role-year-mappings/RoleYearMappingsPage.tsx:178-185,260-295` | medium |
| **AC-57** | Scheduling Settings subtitle claims PE window overrides stay "within the bounds you set here". They don't — the settings are pre-fill defaults only, and `CreateObservationWindowDialog` lets a PE exceed every one. **Fix:** correct the copy (or enforce the bounds, which is the larger change and overlaps AC-31).                                                      | `admin/scheduling/SchedulingSettingsPage.tsx:116`                   | medium |
| **AC-58** | The transcription failure banner tells admins to "check the Gemini model and API key in Settings", but the API key is a deployment secret with no field in the console. **Fix:** reword to reference only what is admin-configurable.                                                                                                                                       | `admin/transcription/TranscriptionJobsPage.tsx:221-233`             | medium |
| **AC-59** | Cycle Steps and Quick Materials reordering is **drag-only** — `useSensors` registers `PointerSensor` with no `KeyboardSensor`, and there is no up/down fallback, so keyboard and screen-reader admins cannot reorder at all. **Fix:** add `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })` (dnd-kit ships this) or add explicit move buttons. | `admin/dashboard/CycleStepsEditor.tsx:73`                           | medium |
| **AC-60** | Module resource items can only be links, but `moduleItem.ts` defines `fileUrl` and `functions/src/modules/uploadModuleFile.ts` is a **fully implemented callable** with a size cap — an entire built backend feature with no admin UI. **Fix:** add the upload control, or remove the dead field and callable.                                                              | `admin/modules/ModuleSectionEditor.tsx:201-210`                     | medium |
| **AC-61** | Branding help text says the primary color applies "on next page load"; it is actually live (`useFirestoreDoc` uses `onSnapshot` and `BrandingProvider` re-applies CSS vars on change). Admins refresh, or tell staff to, for no reason.                                                                                                                                     | `admin/branding/BrandingPage.tsx:111-113`                           | nit    |
| **AC-62** | The rubric-duplicate dialog's validation says the ID "must be lower-kebab-case" — unexplained programmer vocabulary for a school administrator.                                                                                                                                                                                                                             | `admin/rubrics/RubricsListPage.tsx:213`                             | nit    |

---

## What is genuinely sound

Recorded so future work doesn't re-audit it.

- **Staff rollover** (`RolloverDialog` + `applyStaffRollover.ts`) is a model implementation: full
  current→next preview, per-row opt-out, summative override, "nothing is written until you confirm",
  **server-side stale-row detection** (re-reads each doc and skips any whose year drifted since the
  preview loaded), and an audit entry with the full change list.
- **CSV import** (`StaffImportDialog` / `staffCsv.ts`) previews create/update/unchanged/error per row,
  blocks the whole import while any row errors, and correctly excludes `emailPreferences` so an import
  can never clobber a staff member's own opt-outs.
- **Message a group** (`MessageGroupDialog`) has an explicit compose→confirm step, de-dupes recipients,
  enforces a recipient cap, and has a tested fallback for the template-deleted-mid-confirm race.
- **`bulkWrite.ts`** correctly chunks at Firestore's 500-write batch limit and reports progress.
- **The finalized-observation rubric snapshot** genuinely freezes domains and descriptors at finalize
  time, so historical PDFs don't shift under later rubric edits. (The gap is Draft observations — AC-27.)
- **Building-schedule draft lifecycle** (prepare-next-year / activate / discard) is real, its batched
  writes are correct, and the Activate dialog's claims about booking reconciliation are **accurate** —
  verified against `onBuildingScheduleWritten.ts`. (The gap is the _undisclosed_ live-save path — AC-26.)
- **Firestore rules** for `/rubrics`, `/roleYearMappings`, and `/workProductQuestions` all gate writes
  on `isAdmin()` consistently with the route guard — no permission-mismatch bug in this area.
- **Role-year mappings** genuinely drive `/my-rubric` and `finalizeObservation`'s snapshot — not a
  decorative matrix.
- **Dashboard configuration** is unusually well covered: sections, per-checkpoint titles/descriptions/
  CTA labels/chip styles/show-done logic, cycle-close date, and quick materials all flow through
  `/admin/dashboard`. Module content (sections, materials, resources, `autoEnable`, color, icon) is
  fully editable via `/admin/modules`.
- **Email suppression/preferences** and **template history/versioning** are real, server-honored, and
  defended against races and oversized documents.
- **`callerAccess.ts`** is careful and well documented — it is simply not yet adopted by the three
  callables in AC-08/AC-09 or by the claim-minting functions in AC-01.

---

## Suggested implementation slices

Sized for the `mass-plan-implementation` skill. Each slice is internally parallelizable; slices are
ordered by risk, not dependency (only AC-10 and AC-41 have stated dependencies).

| Slice                           | Items                                                                 | Why together                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **S1 — Authorization**          | AC-01, AC-06, AC-08, AC-09                                            | One theme (T1), one helper, security-critical. AC-01 first; read `computeClaims.ts` from the dev-paul tag before starting. |
| **S2 — Rubric editor**          | AC-02, AC-03, AC-27 (part 1 only), AC-37                              | One file cluster, blocking data-integrity, high conflict risk if split across agents.                                      |
| **S3 — Dead controls**          | AC-11, AC-12, AC-13, AC-14, AC-15, AC-16                              | All "the control lies"; each is independently small.                                                                       |
| **S4 — Error handling**         | AC-17 … AC-22                                                         | One pattern, six files. Extract the shared affordance in the first PR.                                                     |
| **S5 — Validation**             | AC-05, AC-23, AC-24, AC-25, AC-30, AC-31                              | All "reject bad input before it persists".                                                                                 |
| **S6 — District values**        | AC-07, AC-32, AC-33, AC-34, AC-35, AC-41, AC-46                       | The cutover-risk group. AC-33/AC-34 share the pre-auth constraint.                                                         |
| **S7 — Deactivation semantics** | AC-04, AC-29, AC-53, AC-54                                            | One theme (T6).                                                                                                            |
| **S8 — Audit log**              | AC-38, AC-39, AC-49, plus the existing `rate_limit_tripped` TODO item | Decide prune-vs-implement once, then apply.                                                                                |
| **S9 — Polish**                 | AC-48, AC-50 … AC-62                                                  | Independent, low-risk, good parallel fan-out.                                                                              |

**Not recommended without a decision from you:** AC-42 (observation types) and the full version of
AC-27 (rubric draft/publish states) — both are architectural and deserve their own design pass.
