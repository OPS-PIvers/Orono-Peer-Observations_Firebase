# Feature Maturity Audit — July 2026

An audit of the monorepo for features that are **implemented but underdeveloped** —
partially built, MVP-quality, missing capabilities users would reasonably expect, or
workflow dead-ends. This is deliberately complementary to `docs/CODEBASE_AUDIT.md`
(July 2026), which covered correctness, security, and cost; no findings are repeated
from that report.

**Method:** the audit was run as a multi-agent workflow — a design-intent map and
unfinished-work sweep, then seven parallel domain auditors (observation workflow,
scheduling, admin console, end-user UX, backend services, data/config lifecycle,
quality/platform), each finding independently re-verified by a skeptical review agent
that attempted to refute it against the actual source before inclusion. 35 raw findings
were produced; 1 was refuted and dropped (draft-observation deletion, which exists),
and 3 duplicate reports of the audit-log gap were merged. All file/line citations below
were verified against the code.

Findings are ordered by impact, highest first. "Effort" is a rough t-shirt size for the
remediation, not a promise.

## High impact

_Gaps that silently break an advertised capability, risk data loss, or block a core recurring workflow._

### 1. PDF export for Work Product / Instructional Round observations

**Impact: high · Effort: medium · Area: backend-services**

**Current state.** finalizeObservation.ts unconditionally calls renderObservationPdf for every observation type (apps/functions/src/observations/finalizeObservation.ts:161-171). The renderer template (apps/pdf-renderer/src/template.ts) only ever emits rubric `componentSections` (lines 49-122), `scriptDoc` (124-129), and `transcripts` (131-146). The `workProductAnswers` field — a real, first-class part of the Observation schema (packages/shared/src/schema/observation.ts:95, 159) used to store Work Product Q&A responses (see apps/web/src/observations/WorkProductAnswerForm.tsx / WorkProductResponseViewer.tsx) — is never read or rendered anywhere in template.ts.

**Gap.** Finalizing a Work Product observation (and likely much of an Instructional Round observation, which also relies on non-rubric response data) produces a PDF whose main section falls back to the empty-state message "No components are assigned for this role/year combination" (template.ts:177) — the entire substantive content the observation was built to capture is silently missing from the archived, staff-facing PDF.

**Why it matters.** PDF export is the permanent, sharable record of an observation (uploaded to Drive and shared with the observed staff member). For 2 of the 3 observation types, that permanent record is effectively blank where it matters most, and nobody is warned — the render succeeds and finalization completes normally.

Key files: `apps/pdf-renderer/src/template.ts`, `apps/functions/src/observations/finalizeObservation.ts`, `apps/functions/src/lib/pdfRenderer.ts`, `packages/shared/src/schema/observation.ts`

### 2. Audio transcription never flows into the observation script

**Impact: high · Effort: medium · Area: observations**

**Current state.** AudioRecorder.tsx's own header copy claims transcription "lands in the script when ready" (apps/web/src/observations/AudioRecorder.tsx:216), and onTranscriptionJobCreated writes the finished text only to `observation.transcripts.{fileId}` (apps/functions/src/transcription/onTranscriptionJobCreated.ts:115-118). The transcript is rendered solely as a plain read-only `<details>` block inside the audio popover (apps/web/src/observations/AudioRecorder.tsx:383-390) — nothing in ScriptEditor, ScriptDrawer, or any callable ever copies/inserts that text into `scriptDoc`. geminiTagScript (apps/functions/src/observations/geminiTagScript.ts:50-183) only tags whatever the observer already typed by hand into the script; it has no awareness of `transcripts` at all.

**Gap.** There is no 'insert transcript into script' action, no button, no auto-populate — the observer must manually read a collapsed transcript panel and retype/copy the wording themselves if they want it tagged as rubric evidence. The two most Gemini-forward features in the app (transcription and auto-tag) don't compose into the single workflow the UI copy advertises.

**Why it matters.** This is the pipeline the app is clearly designed to sell — record audio during a walkthrough, transcribe it, then auto-tag it against rubric components. Without a bridge step, transcription is an isolated read-only artifact that adds Gemini cost/latency but delivers none of its intended downstream value (auto-tag can't see it, PDF export doesn't quote it).

Key files: `apps/web/src/observations/AudioRecorder.tsx`, `apps/functions/src/transcription/onTranscriptionJobCreated.ts`, `apps/functions/src/observations/geminiTagScript.ts`, `apps/web/src/observations/ScriptEditor.tsx`

### 3. Finalized observations can never be corrected or reopened

**Impact: high · Effort: medium · Area: observations**

**Current state.** ObservationEditorPage hard-locks the whole page once `status === 'Finalized'`: `isReadOnly = observation?.status === OBSERVATION_STATUS.finalized` (apps/web/src/observations/ObservationEditorPage.tsx:267) and `canEdit = !isReadOnly && isObserver` (line 269), applied unconditionally to every field including for admins. finalizeObservation.ts has no counterpart 'unfinalize'/'reopen' callable, and firestore.rules' admin branch (`allow update: if isAdmin() || ...`) is never exercised by any UI.

**Gap.** There is no supported way — in-app, for anyone including admins — to fix a typo, wrong proficiency rating, or bad note after finalizing, even though the rules layer was clearly written to allow admin writes post-finalization.

**Why it matters.** By the time an observation is finalized, the PDF has already been generated and Drive-shared with the observed staff member (finalizeObservation.ts:192-198, :229-255) — a mistake discovered afterward (e.g., wrong date, wrong rating) requires manual Firestore edits and a brand-new PDF/re-share done outside the product, which is exactly the kind of operation a peer-observation admin tool should support natively.

Key files: `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/functions/src/observations/finalizeObservation.ts`

### 4. Observation editor autosave — failure recovery and unload protection

**Impact: high · Effort: small · Area: quality-platform**

**Current state.** apps/web/src/observations/ObservationEditorPage.tsx:245-261 implements an 800ms-debounced autosave (AUTOSAVE_DEBOUNCE_MS, line 59) that flushes drafts to Firestore. On a write failure it sets state to 'error' and shows a static label via SaveStatusIndicator in apps/web/src/observations/GlobalToolsBar.tsx:32-34 ('Save failed: {error}') with no retry button and no automatic retry — the next flush only happens if the user types again and re-triggers scheduleSave (ObservationEditorPage.tsx:287-397 call sites). Unmount-triggered flush (lines 253-261) only covers React-level unmounts, not full page close/refresh/tab-close/navigation-away — there is no `beforeunload`/`visibilitychange` listener anywhere in apps/web/src that warns about or flushes unsaved edits before the browser discards the page.

**Gap.** A transient save failure (permission hiccup, network blip, expired auth token) leaves the user's most recent edits sitting only in local component state with a passive error message and no way to force-retry; if they stop typing and close the tab, that content is lost silently. There is also no confirmation/warning when navigating away or closing the tab while a save is pending or failed.

**Why it matters.** This is the primary long-form data-entry surface in the app (observation notes, scores, pre/post-observation notes). A silent, unrecoverable loss of in-progress observation notes — the exact scenario autosave exists to prevent — can still happen on any transient error or tab close during the debounce window.

Key files: `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/observations/GlobalToolsBar.tsx`

### 5. Observation window management (post-creation editing)

**Impact: high · Effort: medium · Area: scheduling**

**Current state.** createObservationWindow (apps/functions/src/scheduling/createObservationWindow.ts:39-295) is the only way to set up a window: invitees, dates, weekdays, buildings and signup fields are all locked in at creation. The only other window-level callable is cancelObservationWindow (apps/functions/src/scheduling/cancelObservationWindow.ts:27-91), which just marks the whole window cancelled and blocks its unbooked slots. A repo-wide search for edit/update/add-invitee/resend-invite callables (`editObservationWindow`, `updateObservationWindow`, `addInvitee`, `resendInvite`) returns nothing. The PE-facing list page (apps/web/src/observations/MyObservationWindowsPage.tsx:212-247) offers only three actions per window: 'Assign times', 'Copy invite links', and 'Cancel' — no 'Edit'. The 'Copy invite links' button (MyObservationWindowsPage.tsx:83-97) builds a clipboard-pasteable list of every invitee's booking URL — a manual workaround that only exists because there is no per-invitee resend-email action.

**Gap.** There is no way to fix a typo'd invitee, add a late-arriving staff member, extend the date range, or resend a single lost invite without cancelling the entire window (which force-cancels/blocks every unbooked slot and emails everyone) and recreating it from scratch with all invitees re-entered.

**Why it matters.** Any small correction after opening a window — one missed teacher, one wrong building, a mistyped email — forces a peer evaluator to blow up and redo scheduling for the whole group, generating confusing duplicate/cancelled windows in front of staff and losing progress on preferences/bookings already collected.

Key files: `apps/functions/src/scheduling/createObservationWindow.ts`, `apps/functions/src/scheduling/cancelObservationWindow.ts`, `apps/web/src/observations/MyObservationWindowsPage.tsx`

### 6. Staff roster management (bulk import/export)

**Impact: high · Effort: medium · Area: admin-console**

**Current state.** StaffPage.tsx has search/filter (StaffFilterBar), sort, select-mode with BulkEditDialog.tsx (bulkMerge/bulkMergePerRow for year/role/building/module/status), and a one-at-a-time StaffDialog for create/edit. There is no CSV/spreadsheet import or export anywhere in the admin UI (verified via repo-wide search for 'csv'/'import'/'export' in apps/web/src/admin — only false-positive JS import statements). The only bulk-load path is scripts/import/import.ts, a one-time developer CLI (requires gcloud auth or a service-account key, `--target=prod --confirm`) explicitly documented as a 'Phase 2' migration from the legacy Google Sheet, not a repeatable admin workflow.

**Gap.** A school admin has no self-serve way to bulk-onboard or refresh a staff roster (e.g. at the start of a school year, ~100s of staff) short of clicking 'Add staff' individually or asking a developer to re-run the migration script. There's also no CSV export for offloading the current roster to a spreadsheet for reporting/HR reconciliation.

**Why it matters.** Yearly roster turnover (new hires, building reassignments, role changes for dozens/hundreds of staff) is a predictable, recurring admin task in a K-12 deployment; forcing it through one-by-one dialogs turns a 10-minute spreadsheet upload into an hours-long manual chore, and any error-prone hand-entry risks mis-assigned roles/years that drive rubric assignment and observation cycles.

Key files: `apps/web/src/admin/staff/StaffPage.tsx`, `apps/web/src/admin/staff/StaffDialog.tsx`, `apps/web/src/admin/staff/BulkEditDialog.tsx`, `scripts/import/import.ts`

## Medium impact

_Real friction in supported workflows: missing lifecycle operations, one-way integrations, and UX dead-ends with manual workarounds._

### 7. Annual staff year/cycle rollover

**Impact: medium · Effort: medium · Area: data-and-config**

**Current state.** Staff.year (packages/shared/src/schema/staff.ts:22-40) encodes a 6-step continuing/probationary cycle (1-3 continuing, 4-6 probationary) that is supposed to advance every school year, and summativeYear (staff.ts:43) tracks whether the current cycle year is a summative-review year. The only tool that touches this in bulk is BulkEditDialog's 'year' action (apps/web/src/admin/staff/BulkEditDialog.tsx:116-122, 249-269), which force-sets every selected staff member to one identical target year via bulkMerge. There is no function or script anywhere in apps/functions/src or scripts/ that computes 'current year + 1' per staff member (grep for rollover/promote/advanceYear/incrementYear across apps and scripts returns nothing).

**Gap.** Advancing the whole staff roster at the start of a school year requires grouping staff by their _current_ year value and running the bulk dialog once per group (year1->2, year2->3, year3(tenured)->stays/summative logic, P1->P2->P3->tenure), and manually deciding summativeYear per person — there is no 'promote everyone one year' action, no year-6-to-tenure transition helper, and no server-side logic that ties summativeYear to the new cycle position. This is exactly the kind of once-a-year, high-stakes, error-prone bulk operation (100+ staff) that this app should own instead of leaving to ad hoc admin judgment.

**Why it matters.** This is a K-12 evaluation-cycle app; getting a teacher's year/summative status wrong changes which rubric components apply (via roleYearMappings) and whether they get a formal summative review that year — a compliance-relevant mistake. Every September the admin (Paul) has to reconstruct the correct rollover logic by hand with a generic bulk-set tool.

Key files: `packages/shared/src/schema/staff.ts`, `packages/shared/src/cycle.ts`, `apps/web/src/admin/staff/BulkEditDialog.tsx`

### 8. Rubric editing has no versioning or historical snapshot

**Impact: medium · Effort: medium · Area: admin-console**

**Current state.** RubricEditorPage.tsx save() (lines 163-187) overwrites the live rubric doc's `domains` array in place via `setDoc({...}, {merge:true})` with no version bump, changelog, or 'save as new version' option. Component removal has a confirm step but no undo/history. finalizeObservation.ts reads the rubric live at finalize time (lines 136-143: `db.doc(rubrics/{role.rubricId}).get()`) and bakes it into the generated PDF, but the observation document itself does not store that rubric snapshot. The in-app read view (apps/web/src/observations/ObservationEditorPage.tsx:107, `rubrics.find((rb) => rb.id === role.rubricId)`) always resolves against the current live rubrics collection.

**Gap.** Once an admin edits a rubric's component wording (proficiency levels, look-fors) — e.g. to fix a typo or align to a new evaluation year — every previously finalized observation that used that rubric silently re-renders with the new text in the live app, while the already-generated PDF (created at finalize time) keeps the old wording. There is no way to view 'what the rubric said when this observation was scored' from the app, no diff/history of rubric edits, and no 'clone rubric to start next year's version' workflow.

**Why it matters.** Rubric text is the evaluation criteria staff are actually judged against; letting it drift silently under already-finalized, legally/HR-relevant records (and diverging from the archived PDF of record) undermines the integrity of the historical record and could contradict what was represented to a staff member during their evaluation.

Key files: `apps/web/src/admin/rubrics/RubricEditorPage.tsx`, `apps/functions/src/observations/finalizeObservation.ts`, `apps/web/src/observations/ObservationEditorPage.tsx`

### 9. Google Calendar integration — conflict detection

**Impact: medium · Effort: large · Area: backend-services**

**Current state.** The scheduling engine's only conflict source is `peBusyIntervals`, an internal ledger populated exclusively by the app's own bookings (apps/functions/src/scheduling/bookObservationSlot.ts:261, assignObservationFromPreference.ts:128) and always initialized empty on window creation (apps/functions/src/scheduling/createObservationWindow.ts:155). `apps/functions/src/calendar/lib/googleCalendar.ts` only ever writes events out (`createObservationEvent`, `insertEvent`) — there is no freebusy/events.list call anywhere in the codebase (grep for `freebusy` returns nothing).

**Gap.** Despite the README describing "Google Calendar integration for scheduling conflicts," the integration is write-only: it pushes confirmed observations onto each party's calendar but never reads a PE's or teacher's actual Google Calendar to detect real-world conflicts (personal appointments, other meetings, PTO). A PE can be booked into a slot that collides with an external meeting on their real calendar; the system only prevents double-booking against observations it created itself.

**Why it matters.** Scheduling is the core value proposition of the booking system, and the one calendar signal that would materially reduce double-booked PEs (their actual availability) is absent, so admins/PEs still have to manually cross-check personal calendars before confirming slots.

Key files: `apps/functions/src/calendar/lib/googleCalendar.ts`, `apps/functions/src/scheduling/engine/blocking.ts`, `apps/functions/src/scheduling/createObservationWindow.ts`, `packages/shared/src/schema/observationWindow.ts`

### 10. Google Calendar sync depth

**Impact: medium · Effort: small · Area: scheduling**

**Current state.** onObservationBooked (apps/functions/src/calendar/onObservationBooked.ts:33-128) creates calendar events exactly once per observation, guarded so it never re-fires once gcalEventIds is populated (eventIdsEmpty check, line 50). googleCalendar.ts exports updateObservationEvent (apps/functions/src/calendar/lib/googleCalendar.ts:344-363) for patching an existing event, but a repo-wide grep shows it is never imported or called anywhere — it is dead code. deleteObservationEvent is called only from cancelBooking.ts.

**Gap.** Once a calendar event is created, it is never kept in sync: editing the observation's name/type/description, or moving/rescheduling it (if that capability is added), does nothing to the already-created calendar entries on either party's calendar — the write-only `updateObservationEvent` helper that would do this is unused.

**Why it matters.** Staff and observers rely on their Google Calendar as the source of truth for where to be; a stale event (wrong title, wrong description, or wrong time after any later edit) silently misleads them with no code path to correct it short of cancel/recreate.

Key files: `apps/functions/src/calendar/lib/googleCalendar.ts`, `apps/functions/src/calendar/onObservationBooked.ts`

### 11. Audit log has no filtering, search, or export

**Impact: medium · Effort: small · Area: data-and-config**

**Current state.** AuditLogPage.tsx (apps/web/src/admin/audit-log/AuditLogPage.tsx:24-154) renders a single Firestore query ordered by timestamp desc with limit(50) and a 'Load 50 more' button (lines 36-44, 144-150) as the only navigation. The auditLog schema (packages/shared/src/schema/auditLog.ts:40-49) has userEmail, action (a fixed enum of 19 action types), and target fields that are purpose-built for filtering, but none of them are exposed as query controls in the UI — there is no filter-by-user, filter-by-action, filter-by-target, or date-range control anywhere in the file.

**Gap.** To answer a routine admin question like 'what did this staff member's account do' or 'who touched observation X' or 'show me only staff_deactivated events', the admin must click 'Load 50 more' repeatedly through the entire log, since the schema's most useful fields (userEmail, action, target) have zero corresponding UI filters despite being exactly what an audit trail is for. There is also no way to export/download entries for offline review or records requests.

**Why it matters.** An audit trail nobody can practically search is far less useful for its intended purpose (incident investigation, access review) than the collection design implies; this gap grows worse as `pruneAuditLog` keeps up to a year of entries.

_Independently flagged by three separate domain auditors (admin console, backend services, data/config) — a strong signal of how visible this gap is._

Key files: `apps/web/src/admin/audit-log/AuditLogPage.tsx`, `packages/shared/src/schema/auditLog.ts`

### 12. Booking cancellation / rescheduling

**Impact: medium · Effort: medium · Area: scheduling**

**Current state.** There is no reschedule callable or UI anywhere in the repo (grep for 'reschedul\*' across apps/ and packages/ returns zero matches). The only path to change a time is cancelBooking (apps/functions/src/scheduling/cancelBooking.ts:35-226), which deletes the Draft observation outright (lines 137-167) and tears down any Google Calendar events, followed by a completely fresh visit to BookingPage.tsx where the staff member re-answers all signup detail fields (SignupDetailFields, answers state at BookingPage.tsx:107-110) and picks a new slot from scratch (renderDirect, BookingPage.tsx:158-254).

**Gap.** Moving a booking to a different time is a two-step, state-losing operation (cancel, then re-book as if new) rather than a single reschedule action that preserves the invitee's prior signup answers and just re-picks a slot.

**Why it matters.** Reschedule is one of the most common real-world scheduling actions (conflicts come up); forcing users through cancel-then-rebook re-entry of detail answers, plus a fresh confirmation/cancellation email pair, is a poor experience for a workflow the app is centered on.

Key files: `apps/functions/src/scheduling/cancelBooking.ts`, `apps/web/src/scheduling/BookingPage.tsx`

### 13. Day-preference slot assignment ('matching engine')

**Impact: medium · Effort: medium · Area: scheduling**

**Current state.** Despite living in an `engine/` directory (bookingRules.ts, timeWindows.ts, blocking.ts), assignment from day preferences is entirely manual and one row at a time. assignObservationFromPreference.ts:38-40 documents this explicitly: 'The PE books on behalf of the staff member... The UI loops this callable for bulk assignment (one slot per call).' The AssignPreferencesPage.tsx:180-236 renders a per-staff dropdown of that person's own available slots plus an individual 'Assign' button; there is no 'auto-assign all' or optimizer that considers all pending preferences together.

**Gap.** No bulk/auto-assign capability — a PE with 30+ staff on day-preference mode must open a dropdown and click Assign 30+ times, one at a time, with no algorithm suggesting an optimal or conflict-free global schedule across all pending preferences.

**Why it matters.** Day-preference mode exists specifically to reduce staff scheduling burden by letting a PE batch-assign times later, but the batch step itself is fully manual, so the mode saves invitees time at the cost of the PE's — undermining the feature's stated purpose for any building-wide observation cycle.

Key files: `apps/functions/src/scheduling/assignObservationFromPreference.ts`, `apps/web/src/scheduling/AssignPreferencesPage.tsx`

### 14. Audio transcription progress/failure tracking

**Impact: medium · Effort: small · Area: quality-platform**

**Current state.** packages/shared/src/schema/transcriptionJob.ts:1-39 defines a full /transcriptionJobs/{jobId} job-status model (Pending/Running/Completed/Failed, error message, timestamps) and its own doc comment says explicitly: 'Client uses `onSnapshot` on the job doc to surface progress in the UI.' The backend (apps/functions/src/transcription/requestTranscription.ts, onTranscriptionJobCreated.ts) creates and updates these job docs. But the only consumer, apps/web/src/observations/AudioRecorder.tsx:51-99, never reads the transcriptionJobs collection at all (confirmed by repo-wide grep — zero references in apps/web/src). It instead keeps a local, in-memory `transcribing: Set<string>` state (line 58) that is set optimistically on button click (line 73) and cleared only when a transcript happens to appear on the observation doc (lines 88-99).

**Gap.** There is no way for the UI to learn that a job failed on the backend (status:'Failed', error message never surfaced) — the spinner/'Transcribing…' label just never resolves, with no timeout or failure state shown. A page reload during an in-flight job silently loses the 'transcribing' indicator and reverts to a plain 'Transcribe' button, inviting the user to re-click and enqueue a duplicate Gemini job. The richer, purpose-built job-status schema that was clearly designed for this (per its own doc comment) is unused.

**Why it matters.** Peer evaluators recording and transcribing observation audio have no reliable feedback on whether a transcription succeeded, is stuck, or failed — they either wait indefinitely on a spinner that will never update, or refresh and unknowingly kick off duplicate paid Gemini jobs against the same recording.

Key files: `apps/web/src/observations/AudioRecorder.tsx`, `packages/shared/src/schema/transcriptionJob.ts`, `apps/functions/src/transcription/requestTranscription.ts`, `apps/functions/src/transcription/onTranscriptionJobCreated.ts`

### 15. Email delivery visibility / failure handling

**Impact: medium · Effort: medium · Area: backend-services**

**Current state.** sendEmail() writes a doc to `/mail` for the Trigger Email extension to pick up, then immediately writes an `AUDIT_ACTIONS.emailSent` audit-log entry in the same call (apps/functions/src/lib/emailUtils.ts:98-118) — before the extension has actually attempted SMTP delivery. Nothing in the codebase (grepped functions and web for `delivery`) ever reads back the `delivery.state`/`delivery.error` fields the Trigger Email extension writes onto the `/mail` doc after it sends.

**Gap.** There is no mechanism anywhere (scheduled function, admin UI, or dashboard) that surfaces bounces, blocks, or send failures after the fact. A bounced or spam-blocked email is recorded permanently in the audit log as 'email_sent' with no way for an admin to discover it wasn't actually delivered, and no retry/backoff exists for transient SMTP failures.

**Why it matters.** Reminder and lifecycle emails (booking confirmations, finalization notices, staff invites) are relied on to drive workflow; silent delivery failures mean staff simply never find out an observation was scheduled or finalized, with no admin-visible signal that anything went wrong.

Key files: `apps/functions/src/lib/emailUtils.ts`

### 16. Building bell-schedule change impact on already-booked observations

**Impact: medium · Effort: small · Area: scheduling**

**Current state.** onBuildingScheduleWritten (apps/functions/src/scheduling/onBuildingScheduleWritten.ts:49-242) reconciles slots when a building's schedule is edited, and explicitly never touches booked slots (comments at lines 151-159 and 200-206). When a booked slot's period time changed or the period was removed entirely, it only pushes an entry into `bookedWarnings` and, at the end, writes a single auditLog document (lines 228-241) with `action: 'observationWindow.scheduleChangeWarning'`. No email, no in-app notification, and no dedicated admin screen surfaces these flagged bookings — the only trace is a raw audit-log entry.

**Gap.** When an admin edits a building's bell schedule in a way that invalidates an already-booked observation time (period moved or removed), neither the PE nor the observed staff member is told their scheduled observation may now be at the wrong time — the system just logs it and moves on.

**Why it matters.** Bell schedules change (early releases, snow-day makeups, semester schedule swaps); silently leaving a booked observation's start/end time stale with only a buried audit-log breadcrumb risks people showing up at the wrong time with nobody proactively told.

Key files: `apps/functions/src/scheduling/onBuildingScheduleWritten.ts`

### 17. Building bell-schedule multi-year lifecycle

**Impact: medium · Effort: medium · Area: data-and-config**

**Current state.** buildingSchedule (packages/shared/src/schema/buildingSchedule.ts:59-79) is a single document per building (doc id = buildingId) holding one weeklyPattern, one dayTypes array, one overrides (holiday/no-school) array, and a single effectiveFrom/effectiveTo academic-year window (buildingSchedule.ts:71-73). BuildingSchedulePage.tsx edits this one doc in place (apps/web/src/admin/buildings/BuildingSchedulePage.tsx:38-125).

**Gap.** Because there is only one schedule doc per building, there is no way to prepare next year's bell schedule and holiday calendar while the current year's is still live and being used to generate bookable slots, and no 'clone this year's schedule forward' action — each new school year the admin must edit the live doc in place, delete last year's overrides array entries one by one, and re-enter the new year's holidays, with no historical copy retained for old buildingSchedule states tied to previously finalized observations.

**Why it matters.** Schools plan bell schedules and holiday calendars months ahead of the switchover; not being able to stage next year's schedule without disrupting the current one forces error-prone last-minute edits, and there's no audit trail of what a building's schedule was in a past year if that ever needs to be reconstructed (e.g. for a records request).

Key files: `packages/shared/src/schema/buildingSchedule.ts`, `apps/web/src/admin/buildings/BuildingSchedulePage.tsx`

### 18. Data export / backup tooling

**Impact: medium · Effort: medium · Area: data-and-config**

**Current state.** scripts/import/ contains only a one-directional, one-shot GAS-sheet-to-Firestore cutover importer (scripts/import/import.ts:1-22, scripts/import/README.md). It explicitly refuses to re-run against prod without --force-overwrite (import.ts:80-94) and is framed entirely as a single migration event ('Production cutover ... at cutover'). Grepping the whole repo (scripts/, apps/functions/src, apps/web/src) for csv/export/backup tooling turns up nothing beyond an unrelated mimeType string.

**Gap.** There is no script, callable, or admin-UI action anywhere in the codebase to export current Firestore data (staff roster, observations, rubrics, audit log) back out to CSV/Sheets/JSON for backup, district reporting, or year-end archival. Combined with the lack of a rollover story above, this means the only supported multi-year data lifecycle operation is 'import once at cutover' — nothing exists to snapshot or hand off data afterward.

**Why it matters.** A school district evaluation system needs periodic exportable records for compliance/audit and for feeding other district systems (e.g., HR, state reporting); today the only way to get data out is direct Firestore console access or writing a one-off script, which is a real gap for a non-technical building administrator.

Key files: `scripts/import/import.ts`, `scripts/import/README.md`

### 19. Evidence file attachments are add-only, with no delete/replace

**Impact: medium · Effort: small · Area: observations**

**Current state.** uploadEvidenceFile (apps/functions/src/observations/uploadEvidenceFile.ts:62-187) only appends via `FieldValue.arrayUnion(fileRef)` (line 172); there is no companion delete/remove callable anywhere in apps/functions/src/observations. RubricRow's EvidencePanel/EvidenceChip only render a '+ Add file' button and a 'View ↗' Drive link (apps/web/src/components/rubric/RubricRow.tsx:675-731) — no delete/remove control exists in either desktop (RubricRow) or mobile (MobileComponentBody, same file lines 949-964) evidence UI.

**Gap.** Once a file is attached to a rubric component there is no way — for the observer, the observed staff, or an admin — to remove it from the UI, even while the observation is still a Draft. Grep confirms no `deleteEvidence`/`removeEvidence`/`arrayRemove` for evidenceLinks anywhere in the codebase.

**Why it matters.** Mis-clicks (wrong file, wrong component, uploaded during testing) are permanent and pile into the finalized PDF's evidence trail with no in-app recourse; staff must ask an admin to intervene directly in Drive/Firestore, which most schools' admins can't do safely.

Key files: `apps/functions/src/observations/uploadEvidenceFile.ts`, `apps/web/src/components/rubric/RubricRow.tsx`

### 20. Work Product / Instructional Round answer forms are bare-bones and duplicated

**Impact: medium · Effort: medium · Area: observations**

**Current state.** WorkProductAnswerForm.tsx and InstructionalRoundAnswerForm.tsx are near-identical (both ~150 lines, same debounce/save logic) and both render answers as a plain `<textarea>` (apps/web/src/observations/WorkProductAnswerForm.tsx:137-143; apps/web/src/observations/InstructionalRoundAnswerForm.tsx:138-144) with no formatting, no lists/links, and no per-question evidence attachment — unlike every other note-taking surface in the app (ScriptEditor, MeetingNotesSection Panel, RubricRow NotesPanel), which all use the full Tiptap editor plus, for rubric components, a dedicated Evidence panel.

**Gap.** Staff answering Work Product / Instructional Round questions get a strictly weaker authoring experience than PEs writing scripts or component notes, and can't attach a supporting document/photo to a specific answer the way evidence works elsewhere in the same observation.

**Why it matters.** Work Product and Instructional Round are first-class observation types (selectable at creation, apps/web/src/observations/CreateObservationDialog.tsx:120-122) but their staff-facing UX reads as an MVP stub next to the polished rubric/script tooling, and the duplication means every future improvement (rich text, attachments, autosave fix) has to be made twice.

Key files: `apps/web/src/observations/WorkProductAnswerForm.tsx`, `apps/web/src/observations/InstructionalRoundAnswerForm.tsx`

### 21. Observation search only filters the already-loaded page, not the full history

**Impact: medium · Effort: medium · Area: observations**

**Current state.** ObservationsListPage subscribes with a bounded `limit(pageSize)` query (apps/web/src/observations/ObservationsListPage.tsx:74-83, PAGE_SIZE=50 at line 34) and then applies the free-text `search` box as a client-side `.filter()` over just that fetched batch (lines 102-113) — matching on observedName/observedEmail/observerEmail/observationName substrings only within whatever's currently loaded.

**Gap.** The search box's placeholder ('Search by observed name, email, or observation name') implies it searches everything, but an observation outside the most-recently-modified `pageSize` window (older, less-touched records) will show as 'No observations match those filters' rather than being found — the user has to guess to keep clicking 'Load more' to widen the window before the search can see it.

**Why it matters.** As the district accumulates observations year over year, this gets worse (by design, since the whole point of the pagination was to bound reads) — an admin trying to locate a specific staff member's past observation for compliance/audit purposes gets a false negative instead of a clear 'load more to search further' signal.

Key files: `apps/web/src/observations/ObservationsListPage.tsx`

### 22. Destructive-delete confirmation across admin CRUD pages

**Impact: medium · Effort: small · Area: quality-platform**

**Current state.** Some admin list pages guard deletes with a confirmation dialog naming the item and its consequences (apps/web/src/admin/modules/ModulesPage.tsx:63,124,190-200 uses a Dialog with 'Permanently delete <name>?'; apps/web/src/admin/email-templates/EmailTemplatesPage.tsx:343,519 uses a deleteTarget-gated dialog). Others perform an immediate, unconfirmed deleteDoc() straight from the row's click handler: apps/web/src/admin/work-product/WorkProductPage.tsx:72-74 (`destroy(id)` called directly from the X button at line 167, no confirm) and apps/web/src/admin/signup-fields/SignupFieldsPage.tsx:85-86,162 (same pattern). RoleYearMappingsPage.tsx:186 uses a bare `window.confirm(...)` for a different action (discarding unsaved changes), showing the app already has a confirmation dialog convention for at least some flows but doesn't apply it uniformly to hard deletes.

**Gap.** No consistent confirmation/undo pattern for destructive actions — two of the audited admin CRUD pages let a single misclick permanently delete a question-bank entry or a signup field with zero recourse, while sibling pages (Modules, Email Templates) protect the same class of action with a confirm dialog.

**Why it matters.** Admins editing the work-product question bank or signup fields (data referenced across many past/future observations and forms) can lose it with a single accidental click, with no undo — an inconsistency in UX safety net that users will not anticipate given the app's own precedent elsewhere.

Key files: `apps/web/src/admin/work-product/WorkProductPage.tsx`, `apps/web/src/admin/signup-fields/SignupFieldsPage.tsx`, `apps/web/src/admin/modules/ModulesPage.tsx`

### 23. Inconsistent reordering across ordered-list admin config surfaces

**Impact: medium · Effort: small · Area: admin-console**

**Current state.** Dashboard editors have full reordering: QuickMaterialsEditor.tsx and CycleStepsEditor.tsx both wire up @dnd-kit DndContext/SortableContext/arrayMove with a SortableItem/GripHandle component, and ModuleBuilderPage.tsx implements up/down moveSection() (lines 67-79) for module sections. By contrast, two structurally identical ordered-list editors have no reorder control at all: WorkProductPage.tsx (question list, lines 149-197) only supports delete/edit-in-place, with an explicit note at line 199-201 that drag-and-drop is deferred to 'Phase 7 polish' and 'add questions in the order you want them displayed'; SignupFieldsPage.tsx assigns `order: sorted.length` only at creation time (line 64) and exposes no move-up/move-down/drag affordance to change an existing field's position afterward.

**Gap.** An admin who wants to move a work-product question or a sign-up field earlier/later in the list must delete and re-add every field after the target position (losing any existing config on each) — there is no reorder UI, unlike three sibling editors in the very same admin console that already solved this with drag-and-drop or arrow buttons.

**Why it matters.** This is a workflow dead-end for two live-editable, staff-facing forms (work-product survey and booking sign-up fields): any correction to display order after the fact requires destructive rebuild-from-scratch rather than a drag, which is jarring given the pattern already exists elsewhere in the same codebase and could be reused directly.

Key files: `apps/web/src/admin/work-product/WorkProductPage.tsx`, `apps/web/src/admin/signup-fields/SignupFieldsPage.tsx`, `apps/web/src/admin/dashboard/QuickMaterialsEditor.tsx`, `apps/web/src/admin/dashboard/CycleStepsEditor.tsx`, `apps/web/src/admin/dashboard/SortableItem.tsx`

### 24. Peer Evaluator card identity (Staff Dashboard)

**Impact: medium · Effort: small · Area: end-user-experience**

**Current state.** StaffDashboardPage.tsx:293-300 builds the `peerEvaluator` object shown in the dashboard sidebar card by taking whatever draft/finalized observation exists and doing `peSource.observerEmail.split('@')[0]` for the display name, with `role: 'Peer Evaluator'` hardcoded literally regardless of the observer's actual role. There is no lookup against the `staff` collection (which the page already queries elsewhere, e.g. `administrators` pattern in ProfilePage.tsx:167-170) to resolve the observer's real name/photo/role.

**Gap.** Any observer whose email local-part isn't a friendly name (e.g. `jsmith2`, `pe.building3`) shows garbled text as their 'name' on every staff member's dashboard. The role label is also wrong whenever the observer is actually an Administrator or Full-Access user conducting the observation rather than a 'Peer Evaluator'.

**Why it matters.** This card is the one place staff go to know who is evaluating them and how to reach them — showing a fabricated name/title undermines trust in a feature that's otherwise fully wired (EvaluatorCard has working mailto CTA, avatar initials, etc.).

Key files: `apps/web/src/dashboard/StaffDashboardPage.tsx`

### 25. Self-scheduling booking checkpoint has no deadline/urgency signal

**Impact: medium · Effort: medium · Area: end-user-experience**

**Current state.** StaffDashboardPage.tsx:154-175 already loads `myWindows` (ObservationWindow docs, which carry `startDate`/`endDate` bounds, packages/shared/src/schema/observationWindow.ts:69-70) and derives `openBooking`/`hasBookedSlot`. But `deriveCheckpoints.ts`'s `resolveButton` 'booking' case (lines 85-90) only produces a link (`/book/{windowId}?token=...`), and `DATE_SOURCE_FN` (dashboardEvents.ts:109-117) only pulls dates off the `Observation` object — there is no window-based date source, so the booking task's `dateLabel` always falls back to the generic 'Awaiting date' / 'In progress' placeholder (deriveCheckpoints.ts:103-107) no matter how close the window's `endDate` is.

**Gap.** A teacher with an open self-scheduling window sees a plain 'Book your observation' card with no indication of when the window closes, even though the backend already runs `expireObservationWindows` and `scheduledEmailReminders` around that exact deadline — the urgency exists operationally but was never wired into the on-page checkpoint the staff member is actually looking at.

**Why it matters.** Booking windows can expire (status transitions to 'expired'); missing the deadline forces re-creating the window and re-inviting, and the only warning a teacher gets today is an email, not anything on the page they use daily to track their cycle.

Key files: `apps/web/src/dashboard/StaffDashboardPage.tsx`, `apps/web/src/dashboard/deriveCheckpoints.ts`, `apps/web/src/dashboard/dashboardEvents.ts`

## Low impact

_Polish and consistency items. These were reported by domain auditors but not independently re-verified._

### 26. Bulk operations and search confined to the Staff page only

**Impact: low · Effort: small · Area: admin-console**

**Current state.** AdminDataView (apps/web/src/admin/\_shared/AdminDataView.tsx) supports a generic `selection` prop (checkboxes, select-all, row toggling) and StaffPage.tsx is the only consumer that wires it up (select-mode toggle + BulkEditBar/BulkEditDialog, lines 84-86, 250-254). ModulesPage.tsx, BuildingsPage.tsx, RolesPage.tsx, and RubricsListPage.tsx all use the same AdminDataView component with sortable columns but never pass `selection`, `rowActions` beyond a single-row dropdown, or any text-search box — each row can only be edited/deleted one at a time via its own dialog.

**Gap.** Multi-select bulk actions (e.g. bulk-deactivate a set of buildings during a school closure/consolidation, bulk-toggle module `isActive`, or bulk-reassign a rubric across roles) and free-text search/filter exist as reusable primitives (already built for Staff) but are not extended to any of the other CRUD admin surfaces that use the identical AdminDataView component.

**Why it matters.** The infrastructure for search and multi-select bulk edit already exists and is proven on the Staff page, so its absence elsewhere reads as an unfinished rollout rather than a deliberate design choice — leaving admins of larger districts (more buildings/modules/roles) to repeat the same one-by-one dialog edit for every row when a batch change is needed.

Key files: `apps/web/src/admin/_shared/AdminDataView.tsx`, `apps/web/src/admin/modules/ModulesPage.tsx`, `apps/web/src/admin/buildings/BuildingsPage.tsx`, `apps/web/src/admin/roles/RolesPage.tsx`, `apps/web/src/admin/rubrics/RubricsListPage.tsx`

### 27. Dashboard 'Cycle close' date

**Impact: low · Effort: small · Area: end-user-experience**

**Current state.** `cycleCloseLabel="May 15"` is hardcoded as a literal string prop at StaffDashboardPage.tsx:308 and again independently in admin/dashboard/DashboardPreview.tsx:46, even though it flows through a fully typed, admin-configurable prop (`DashboardViewProps.cycleCloseLabel`, DashboardView.tsx:46,343) alongside sibling values like `cycleYearLabel` that ARE computed dynamically (`currentSchoolYearLabel()`, StaffDashboardPage.tsx:70-75).

**Gap.** Every other piece of dashboard chrome (hero sections, quick materials, step config, section toggles) is driven through the admin dashboard editor / Firestore config, but the single hard year-end deadline shown to every staff member is a compile-time constant that can't be changed without a code deploy, and doesn't roll forward automatically like the school-year label does.

**Why it matters.** Once May 15 passes each year the hero card keeps showing a stale/past date to staff with no admin control to fix it, in a system that otherwise prides itself on admin-configurable dashboard content.

Key files: `apps/web/src/dashboard/StaffDashboardPage.tsx`, `apps/web/src/admin/dashboard/DashboardPreview.tsx`

### 28. Permanently-locked sidebar nav entries for unavailable observation types

**Impact: low · Effort: small · Area: end-user-experience**

**Current state.** buildNavItems' staff branch (AppSidebar.tsx:170-192) renders 'Work Product' and 'Instructional Round' with `locked: true` whenever `flags.hasWorkProduct`/`hasInstructionalRound` is false. NavEntry's locked branch (AppSidebar.tsx:566-583) renders a `pointer-events-none` div with the label plus a bare '(not started)' suffix — no tooltip explaining why, no link to request one, nothing actionable.

**Gap.** For any staff member whose role/year combination never triggers a Work Product or Instructional Round observation, these two nav rows sit permanently greyed-out with a misleading '(not started)' label (implying the user could start it, which they cannot — only a peer evaluator creates observations) and no path forward.

**Why it matters.** Dead, unexplained nav chrome that a staff member sees on every page for the entire year is a workflow dead-end and clutters the primary navigation for the majority of staff who will never unlock it.

Key files: `apps/web/src/components/AppSidebar.tsx`

### 29. Module page has no module-level completion indicator

**Impact: low · Effort: small · Area: end-user-experience**

**Current state.** ModulePage.tsx tracks per-item done state via `doneItemIds` (line 43) and renders individual Done/Undo toggles per material (moduleSections.tsx MaterialsSection, lines 89-141), but never aggregates a module-wide 'N of M complete' count or progress bar — even though the exact same pattern (a ring/percentage of checkpoints done) is already built and used one click away on the Staff Dashboard (DashboardView.tsx ProgressRing, lines 251-277).

**Gap.** A module with 10 materials across several sections gives the user no sense of how far through they are or whether anything remains, only a scroll-and-scan of individual badges.

**Why it matters.** Modules are the primary self-paced learning content in the app; without a completion summary, staff have no quick way to tell 'am I done with this module' short of manually reading every item, undermining the module feature's usefulness for larger modules.

Key files: `apps/web/src/modules/ModulePage.tsx`, `apps/web/src/modules/moduleSections.tsx`

### 30. Email preferences / unsubscribe

**Impact: low · Effort: medium · Area: backend-services**

**Current state.** renderEmailShell (packages/shared/src/email/renderEmailShell.ts) builds the shared branded shell with only a header logo and a footer sign-in link (lines 43-94) — no unsubscribe or preferences link. sendEmail (apps/functions/src/lib/emailUtils.ts) has no concept of a recipient opt-out list or per-category preference and always sends to whatever address the caller supplies.

**Gap.** There is no staff-facing way to opt out of any email category (scheduled reminders, manual PE-sent emails, lifecycle notices) short of asking an admin to deactivate their template or account; no preference document, no unsubscribe token/link, no suppression list is checked before send.

**Why it matters.** As template count and trigger types grow (13 trigger types already defined in EMAIL_TRIGGER_TYPES, packages/shared/src/schema/emailTemplate.ts:9-24), staff have no self-service control over notification volume, and there's no compliance-style suppression mechanism if someone repeatedly asks not to be emailed.

Key files: `packages/shared/src/email/renderEmailShell.ts`, `apps/functions/src/lib/emailUtils.ts`, `packages/shared/src/schema/emailTemplate.ts`

### 31. PDF renderer — fixed single-column template with no customization

**Impact: low · Effort: medium · Area: backend-services**

**Current state.** renderObservationHtml (apps/pdf-renderer/src/template.ts:38-187) hardcodes the entire document structure, section order, and brand styling (styles() at line 224, inline OPS color variables) with no template variants, no per-observation-type layout, and no admin-configurable branding beyond what's baked into the CSS constants.

**Gap.** Unlike the email system, which has an admin-editable template layer (EmailTemplate docs, variables, trigger types), the PDF output has zero configurability: no way for an admin to reorder sections, hide the transcript section, adjust branding colors to match appSettings.branding, or produce a shorter/summary variant for a specific audience — every observation, regardless of type, gets the identical rubric-shaped layout described above.

**Why it matters.** Admins can already customize app branding (logoUrl, appName) via appSettings for the web app and emails, but that same branding config is never threaded into the PDF renderer, producing inconsistent branding between the emailed notice and the archived PDF, and leaving no lever to adapt the export as observation types evolve.

Key files: `apps/pdf-renderer/src/template.ts`, `apps/functions/src/lib/pdfRenderer.ts`

### 32. Network/offline awareness

**Impact: low · Effort: medium · Area: quality-platform**

**Current state.** A repo-wide search (`navigator.onLine`, `offline`, `isOnline`) shows the concept appears only in apps/web/src/scheduling/connectCalendar.ts and apps/web/src/observations/GlobalToolsBar.tsx — neither is a real connectivity monitor for the app at large. There is no app-wide online/offline indicator, no queued-write/retry-when-back-online behavior, and no distinct offline messaging anywhere else, including the autosave path in ObservationEditorPage.tsx which surfaces a network drop identically to any other Firestore error ('Save failed: <generic client error>').

**Gap.** Users on flaky school-network Wi-Fi (a realistic condition for classroom-adjacent observation work) get no distinction between 'you're offline, we'll retry' and 'something is broken' — both look like a dead-end error string with no visible retry affordance beyond continuing to type.

**Why it matters.** Observers filling out long-form notes during or right after a classroom visit are a prime case for spotty connectivity; without offline detection/queuing, a dropped connection reads as an unexplained save failure rather than a transient, expected condition the app can recover from automatically.

Key files: `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/observations/GlobalToolsBar.tsx`
