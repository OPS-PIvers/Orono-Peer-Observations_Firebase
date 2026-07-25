# Feature Roadmap — Orono Peer Observations

_88 feature briefs, generated 2026-07-24 by a multi-agent discovery pass over the codebase (6 domain explore→ideate pairs plus a cross-cutting critic)._

_**8 shipped 2026-07-25** — see [Shipped](#shipped) below. 80 remain open._

## How to use this document

This is a **menu of opportunities, not a commitment.** Nothing here is scheduled, sequenced, or approved — it exists so that when there is capacity, the next thing to build can be chosen from a grounded list rather than invented on the spot.

Every brief was written against the actual code: file paths, hook names, schema fields, and callables were read before the idea was proposed. Implementation notes name real files. That said, **the notes are a starting point, not a verified plan** — a brief that says a callable exists or a rule permits a write should be re-checked before work begins, since the code moves and the agents read it at one moment in time.

Each brief is self-contained by design: description, why it fits, concrete implementation pointers, files, and dependencies. One can be handed to an implementer (human or agent) without this document for context.

**Division of labor with [`TODO.md`](TODO.md):** that file stays the backlog for bugs, ops work, and committed follow-ups. This file is features and product opportunities only. Ideas already present in `TODO.md` at generation time were explicitly excluded, as were pure bug fixes and refactors.

**Sizes.** `tweak` = under an hour, one file · `small` = an afternoon · `medium` = a few days · `large` = a week-plus, likely schema changes · `suite` = a multi-feature product area.

**Value** is the proposing agent's judgment of user impact, not a priority ranking. Read it as a hint, not a verdict.

> **A note on protected files.** Several briefs require changes to `firestore.rules`, `firestore.indexes.json`, `storage.rules`, or `firebase.json`. Those are owner-sign-off files. Where a brief needs one, its implementation notes say so — treat that as a gate, not a checkbox.

## At a glance

| Domain                                         | Briefs |  tweak |  small | medium |  large | suite | High-value |
| ---------------------------------------------- | -----: | -----: | -----: | -----: | -----: | ----: | ---------: |
| [Observation lifecycle & rubric scoring](#obs) |     14 |      2 |      5 |      5 |      1 |     1 |          5 |
| [Scheduling, booking & calendar](#sched)       |     13 |      3 |      5 |      4 |      1 |     0 |          4 |
| [Audio, transcription & AI tagging](#ai)       |     14 |      2 |      5 |      6 |      1 |     0 |          2 |
| [Admin console](#admin)                        |     13 |      2 |      4 |      4 |      3 |     0 |          1 |
| [Staff experience](#staff)                     |     13 |      3 |      4 |      5 |      0 |     1 |          2 |
| [Communications & platform](#plat)             |     12 |      3 |      2 |      6 |      1 |     0 |          4 |
| [Cross-cutting (critic pass)](#xcut)           |      9 |      0 |      1 |      4 |      3 |     1 |          4 |
| **Total**                                      | **88** | **15** | **26** | **34** | **10** | **3** |     **22** |

<a id="shipped"></a>

## Shipped

Counts in the table above are as-generated and are **not** decremented as items ship — this section is the record of what has left the menu.

**2026-07-25 — tier 1 + tier 2 sweep (8 items).** Every `small`+`high` brief and every `tweak`+`medium` brief, implemented in parallel worktrees, each reviewed by 2–3 adversarial reviewers before merge.

| ID         | Feature                                               | Size  | PR                                                                            |
| ---------- | ----------------------------------------------------- | ----- | ----------------------------------------------------------------------------- |
| `OBS-03`   | Wire up the existing 'Regenerate PDF' button          | small | [#66](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/66) |
| `OBS-04`   | Finalize-readiness checklist                          | small | [#71](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/71) |
| `SCHED-02` | Clone/duplicate an observation window                 | small | [#65](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/65) |
| `STAFF-04` | "Add to Calendar" (.ics) download                     | small | [#67](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/67) |
| `OBS-01`   | Acknowledge a finalized observation from the editor   | tweak | [#72](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/72) |
| `AI-01`    | Playback speed control on recordings                  | tweak | [#69](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/69) |
| `ADMIN-01` | Active/Inactive status filter for Roles and Buildings | tweak | [#70](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/70) |
| `STAFF-01` | App-wide offline indicator                            | tweak | [#68](https://github.com/OPS-PIvers/Orono-Peer-Observations_Firebase/pull/68) |

**Notes for anyone picking up an adjacent brief:**

- `STAFF-04` shipped `apps/web/src/lib/ics.ts` as a reusable RFC 5545 builder, exactly as `SCHED-07` anticipated — that brief should consume it rather than write its own. A timed VEVENT is emitted **only** when the observation has a real booked slot (`scheduledStartAt`); everything else is all-day. An earlier attempt keyed this off "does the date have a non-midnight time component" and had to be reverted: `CreateObservationDialog` writes `observationDate: new Date()` at creation, so that heuristic fabricated precise-looking appointments at the record-creation instant.
- `STAFF-04` also moved `downloadTextFile` out of `admin/staff/staffCsv.ts` into `apps/web/src/lib/download.ts`. Use that.
- `ADMIN-01` extracted `FilterChip`, `StatusFilterChip`, and `statusFilter` into `apps/web/src/admin/_shared/`, and `StaffPage` now consumes them. Any new admin list page should reuse those instead of duplicating the idiom. Note that `AdminSearchInput` collapses if placed as a flex-row sibling — keep search on its own row, as `StaffFilterBar` does.
- `STAFF-01` made the app-wide strip the single source of truth for "you are offline"; `GlobalToolsBar` now shows only save/retry state. Don't reintroduce a second offline assertion on any screen.
- `OBS-03` left one gap open: `regenerateObservationPdf` is still not rate-limited. Tracked in [`TODO.md`](TODO.md) under "Ready code work".

## Index

| ID         | Feature                                                                                                                                                                                       | Size   | Value  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ |
| `OBS-01`   | [Acknowledge a finalized observation from the editor itself](#obs-01--acknowledge-a-finalized-observation-from-the-editor-itself)                                                             | tweak  | medium |
| `OBS-02`   | [Inline image thumbnails for evidence files](#obs-02--inline-image-thumbnails-for-evidence-files)                                                                                             | tweak  | low    |
| `OBS-03`   | [Wire up the existing 'Regenerate PDF' button](#obs-03--wire-up-the-existing-regenerate-pdf-button)                                                                                           | small  | high   |
| `OBS-04`   | [Finalize-readiness checklist](#obs-04--finalize-readiness-checklist)                                                                                                                         | small  | high   |
| `OBS-05`   | [Draft-list triage: sort by staleness + days-open badge](#obs-05--draft-list-triage-sort-by-staleness--days-open-badge)                                                                       | small  | medium |
| `OBS-06`   | [CSV export of the filtered observations list](#obs-06--csv-export-of-the-filtered-observations-list)                                                                                         | small  | medium |
| `OBS-07`   | [Send a follow-up note from a finalized observation](#obs-07--send-a-follow-up-note-from-a-finalized-observation)                                                                             | small  | medium |
| `OBS-08`   | [Overdue-finalize reminder email](#obs-08--overdue-finalize-reminder-email)                                                                                                                   | medium | high   |
| `OBS-09`   | [Pre-finalize full read-only preview](#obs-09--pre-finalize-full-read-only-preview)                                                                                                           | medium | medium |
| `OBS-10`   | [Growth-focus flag on rubric components](#obs-10--growth-focus-flag-on-rubric-components)                                                                                                     | medium | medium |
| `OBS-11`   | [Required Work Product / Instructional Round questions](#obs-11--required-work-product--instructional-round-questions)                                                                        | medium | medium |
| `OBS-12`   | ["Observe again" quick-create](#obs-12--observe-again-quick-create)                                                                                                                           | medium | medium |
| `OBS-13`   | [District-wide observation-cycle compliance tracker](#obs-13--district-wide-observation-cycle-compliance-tracker)                                                                             | large  | high   |
| `OBS-14`   | [Evaluation Insights suite (growth trends + rater consistency)](#obs-14--evaluation-insights-suite-growth-trends--rater-consistency)                                                          | suite  | high   |
| `SCHED-01` | [Status/pending-invite filter on the windows table](#sched-01--statuspending-invite-filter-on-the-windows-table)                                                                              | tweak  | low    |
| `SCHED-10` | [Slot grid quick-jump to next available slot](#sched-10--slot-grid-quick-jump-to-next-available-slot)                                                                                         | tweak  | low    |
| `SCHED-11` | [Window progress/urgency indicator on the windows table](#sched-11--window-progressurgency-indicator-on-the-windows-table)                                                                    | tweak  | low    |
| `SCHED-02` | [Clone/duplicate an observation window](#sched-02--cloneduplicate-an-observation-window)                                                                                                      | small  | high   |
| `SCHED-03` | [Bulk-resend outstanding window invites](#sched-03--bulk-resend-outstanding-window-invites)                                                                                                   | small  | medium |
| `SCHED-07` | [.ics calendar download fallback on booking confirmation](#sched-07--ics-calendar-download-fallback-on-booking-confirmation)                                                                  | small  | medium |
| `SCHED-08` | [CSV export of a window's roster and bookings](#sched-08--csv-export-of-a-windows-roster-and-bookings)                                                                                        | small  | medium |
| `SCHED-09` | [Bulk date-override paste/import for building schedules](#sched-09--bulk-date-override-pasteimport-for-building-schedules)                                                                    | small  | medium |
| `SCHED-04` | [Manual slot override in the auto-assign review dialog](#sched-04--manual-slot-override-in-the-auto-assign-review-dialog)                                                                     | medium | high   |
| `SCHED-05` | [Cross-window double-booking warning for invitees](#sched-05--cross-window-double-booking-warning-for-invitees)                                                                               | medium | high   |
| `SCHED-06` | [Waitlist / notify-me for full day-preference days](#sched-06--waitlist--notify-me-for-full-day-preference-days)                                                                              | medium | medium |
| `SCHED-12` | [Admin scheduling health dashboard](#sched-12--admin-scheduling-health-dashboard)                                                                                                             | medium | medium |
| `SCHED-13` | [Recurring observation windows](#sched-13--recurring-observation-windows)                                                                                                                     | large  | high   |
| `AI-01`    | [Playback speed control on recordings](#ai-01--playback-speed-control-on-recordings)                                                                                                          | tweak  | medium |
| `AI-02`    | [Copy transcript to clipboard](#ai-02--copy-transcript-to-clipboard)                                                                                                                          | tweak  | low    |
| `AI-03`    | [Download transcript as .txt](#ai-03--download-transcript-as-txt)                                                                                                                             | small  | medium |
| `AI-04`    | [Pause/resume recording](#ai-04--pauseresume-recording)                                                                                                                                       | small  | medium |
| `AI-05`    | [Bulk re-queue failed transcription jobs](#ai-05--bulk-re-queue-failed-transcription-jobs)                                                                                                    | small  | medium |
| `AI-10`    | [Search and 'My jobs' quick filter on Transcription Jobs admin page](#ai-10--search-and-my-jobs-quick-filter-on-transcription-jobs-admin-page)                                                | small  | low    |
| `AI-14`    | [Customizable rubric-framework name in the auto-tag prompt](#ai-14--customizable-rubric-framework-name-in-the-auto-tag-prompt)                                                                | small  | low    |
| `AI-06`    | [Live quota indicator for audio uploads and transcription requests](#ai-06--live-quota-indicator-for-audio-uploads-and-transcription-requests)                                                | medium | medium |
| `AI-07`    | [Auto-tag review before applying to script](#ai-07--auto-tag-review-before-applying-to-script)                                                                                                | medium | high   |
| `AI-08`    | [Transcription job quality flag (short-transcript / silence detection)](#ai-08--transcription-job-quality-flag-short-transcript--silence-detection)                                           | medium | medium |
| `AI-09`    | [Scope auto-tag to a text selection](#ai-09--scope-auto-tag-to-a-text-selection)                                                                                                              | medium | medium |
| `AI-11`    | [Drive quota status widget on the admin Settings page](#ai-11--drive-quota-status-widget-on-the-admin-settings-page)                                                                          | medium | medium |
| `AI-12`    | [Transcript version history per recording](#ai-12--transcript-version-history-per-recording)                                                                                                  | medium | medium |
| `AI-13`    | [Talk-time / speaker-balance analysis from transcripts](#ai-13--talk-time--speaker-balance-analysis-from-transcripts)                                                                         | large  | high   |
| `ADMIN-01` | [Active/Inactive status filter for Roles and Buildings pages](#admin-01--activeinactive-status-filter-for-roles-and-buildings-pages)                                                          | tweak  | medium |
| `ADMIN-02` | ["Last updated" sortable column on Roles, Buildings, Modules, Rubrics tables](#admin-02--last-updated-sortable-column-on-roles-buildings-modules-rubrics-tables)                              | tweak  | low    |
| `ADMIN-03` | [URL-synced admin filters + Audit Log deep links](#admin-03--url-synced-admin-filters--audit-log-deep-links)                                                                                  | small  | medium |
| `ADMIN-04` | [Scheduled + severity-leveled global banner](#admin-04--scheduled--severity-leveled-global-banner)                                                                                            | small  | medium |
| `ADMIN-05` | [Rollover concurrency lock](#admin-05--rollover-concurrency-lock)                                                                                                                             | small  | medium |
| `ADMIN-08` | [Rubric JSON export/import for backup and cross-environment portability](#admin-08--rubric-json-exportimport-for-backup-and-cross-environment-portability)                                    | small  | medium |
| `ADMIN-06` | [Live period preview for period-picker signup fields](#admin-06--live-period-preview-for-period-picker-signup-fields)                                                                         | medium | medium |
| `ADMIN-07` | [Admin-configurable email trigger → preference-category mapping](#admin-07--admin-configurable-email-trigger--preference-category-mapping)                                                    | medium | medium |
| `ADMIN-09` | [Legacy building-name resolver for staff records](#admin-09--legacy-building-name-resolver-for-staff-records)                                                                                 | medium | medium |
| `ADMIN-10` | [Inactive-staff purge tool with reference-safety checks](#admin-10--inactive-staff-purge-tool-with-reference-safety-checks)                                                                   | medium | medium |
| `ADMIN-11` | [Compound module auto-enable rules](#admin-11--compound-module-auto-enable-rules)                                                                                                             | large  | medium |
| `ADMIN-12` | [Admin command palette (cross-entity Cmd+K search)](#admin-12--admin-command-palette-cross-entity-cmdk-search)                                                                                | large  | high   |
| `ADMIN-13` | [Weekly "What Changed" admin digest email](#admin-13--weekly-what-changed-admin-digest-email)                                                                                                 | large  | medium |
| `STAFF-01` | [App-wide offline indicator](#staff-01--app-wide-offline-indicator)                                                                                                                           | tweak  | medium |
| `STAFF-02` | [Copy-email quick action in Staff Directory and Staff Person page](#staff-02--copy-email-quick-action-in-staff-directory-and-staff-person-page)                                               | tweak  | low    |
| `STAFF-03` | ["New" badge on recently-added modules](#staff-03--new-badge-on-recently-added-modules)                                                                                                       | tweak  | low    |
| `STAFF-04` | ["Add to Calendar" (.ics) download for pre-obs/post-obs meetings and the observation itself](#staff-04--add-to-calendar-ics-download-for-pre-obspost-obs-meetings-and-the-observation-itself) | small  | high   |
| `STAFF-05` | [Staff Directory: building filter + sortable columns](#staff-05--staff-directory-building-filter--sortable-columns)                                                                           | small  | medium |
| `STAFF-06` | [PWA manifest + "Add to Home Screen" for iPad](#staff-06--pwa-manifest--add-to-home-screen-for-ipad)                                                                                          | small  | medium |
| `STAFF-12` | [Export "My Observations" as CSV](#staff-12--export-my-observations-as-csv)                                                                                                                   | small  | low    |
| `STAFF-07` | ["My Modules" overview page](#staff-07--my-modules-overview-page)                                                                                                                             | medium | medium |
| `STAFF-08` | ["My Growth" — personal rubric-rating trend view on Profile](#staff-08--my-growth--personal-rubric-rating-trend-view-on-profile)                                                              | medium | high   |
| `STAFF-09` | ["My Building" colleague lookup for regular staff](#staff-09--my-building-colleague-lookup-for-regular-staff)                                                                                 | medium | medium |
| `STAFF-10` | [Browser reminders for closing signup windows](#staff-10--browser-reminders-for-closing-signup-windows)                                                                                       | medium | medium |
| `STAFF-11` | [Global quick-jump command palette (⌘K)](#staff-11--global-quick-jump-command-palette-k)                                                                                                      | medium | medium |
| `STAFF-13` | [PD Module completion suite: certificates + reflection checks](#staff-13--pd-module-completion-suite-certificates--reflection-checks)                                                         | suite  | medium |
| `PLAT-01`  | [Severity-colored audit log actions](#plat-01--severity-colored-audit-log-actions)                                                                                                            | tweak  | low    |
| `PLAT-02`  | [Copy audit details JSON to clipboard](#plat-02--copy-audit-details-json-to-clipboard)                                                                                                        | tweak  | low    |
| `PLAT-03`  | [Reset branding to OPS defaults button](#plat-03--reset-branding-to-ops-defaults-button)                                                                                                      | tweak  | low    |
| `PLAT-04`  | [Surface remaining rate-limit quota to end users](#plat-04--surface-remaining-rate-limit-quota-to-end-users)                                                                                  | small  | medium |
| `PLAT-05`  | [Honor the outbound email address setting + add reply-to](#plat-05--honor-the-outbound-email-address-setting--add-reply-to)                                                                   | small  | medium |
| `PLAT-06`  | [Email template version history with one-click revert](#plat-06--email-template-version-history-with-one-click-revert)                                                                        | medium | high   |
| `PLAT-07`  | [Admin rate-limit monitor page](#plat-07--admin-rate-limit-monitor-page)                                                                                                                      | medium | medium |
| `PLAT-08`  | [Broadcast a manual email to a filtered staff group](#plat-08--broadcast-a-manual-email-to-a-filtered-staff-group)                                                                            | medium | high   |
| `PLAT-09`  | [Enforce the configured session duration](#plat-09--enforce-the-configured-session-duration)                                                                                                  | medium | medium |
| `PLAT-10`  | [Admin dashboard card for staff who haven't signed in yet](#plat-10--admin-dashboard-card-for-staff-who-havent-signed-in-yet)                                                                 | medium | high   |
| `PLAT-11`  | [Drive quota usage history and trend chart](#plat-11--drive-quota-usage-history-and-trend-chart)                                                                                              | medium | medium |
| `PLAT-12`  | [In-app notification center](#plat-12--in-app-notification-center)                                                                                                                            | large  | high   |
| `XCUT-04`  | [Pre-/post-observation meeting reminder emails](#xcut-04--pre-post-observation-meeting-reminder-emails)                                                                                       | small  | medium |
| `XCUT-05`  | [Bulk reassign an evaluator's in-flight draft observations](#xcut-05--bulk-reassign-an-evaluators-in-flight-draft-observations)                                                               | medium | medium |
| `XCUT-07`  | [Keyboard-navigable, screen-reader-labeled rubric scoring grid](#xcut-07--keyboard-navigable-screen-reader-labeled-rubric-scoring-grid)                                                       | medium | medium |
| `XCUT-08`  | [Admin data-subject bundle export for a single staff member](#xcut-08--admin-data-subject-bundle-export-for-a-single-staff-member)                                                            | medium | medium |
| `XCUT-09`  | [Finalized-observation retention & purge policy](#xcut-09--finalized-observation-retention--purge-policy)                                                                                     | medium | medium |
| `XCUT-01`  | [Peer-evaluator caseload assignment + access boundary](#xcut-01--peer-evaluator-caseload-assignment--access-boundary)                                                                         | large  | high   |
| `XCUT-02`  | [Calibration / double-scoring sessions for evaluator agreement](#xcut-02--calibration--double-scoring-sessions-for-evaluator-agreement)                                                       | large  | high   |
| `XCUT-06`  | [Offline-durable observation drafting for spotty iPad wifi](#xcut-06--offline-durable-observation-drafting-for-spotty-ipad-wifi)                                                              | large  | high   |
| `XCUT-03`  | [Coaching-cycle / growth-plan suite linking observations over time](#xcut-03--coaching-cycle--growth-plan-suite-linking-observations-over-time)                                               | suite  | high   |

---

<a id="obs"></a>

## Observation lifecycle & rubric scoring

### OBS-01 — Acknowledge a finalized observation from the editor itself

> ✅ **Shipped 2026-07-25** — PR #72. `firestore.rules` was not modified; the security review confirmed the existing rule already permitted the write.

**tweak** · value: **medium**

When an observed staff member opens their own finalized observation at /observations/:id, the read-only banner currently just says 'finalized and read-only' with no way to acknowledge it — they have to know to go back to My Observations to click Acknowledge. Add the same acknowledge action directly into ObservationEditorPage's finalized banner.

**Why this fits.** The write path already exists and is already used elsewhere (MyObservationsPage.tsx), so this closes a real UX gap with zero new backend risk — pure additive UI wiring to an already-permitted Firestore write.

**Implementation.** firestore.rules already allows this exact write (verified): the observed staff member may update only ['acknowledgedAt','acknowledgedBy','lastModifiedAt'] on their own Finalized observation, with acknowledgedBy required to equal request.auth.token.email. Mirror the mutation in apps/web/src/routes/MyObservationsPage.tsx (updateDoc with serverTimestamp()) inside apps/web/src/observations/ObservationEditorPage.tsx, in the `isReadOnly` banner block (~line 792-802). Gate visibility on `observation.observedEmail === user?.email?.toLowerCase() && !observation.acknowledgedAt`. Show an 'Acknowledged on {date}' state once set (Observation.acknowledgedAt/acknowledgedBy already in packages/shared/src/schema/observation.ts).

**Files.** `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/routes/MyObservationsPage.tsx`, `firestore.rules`

### OBS-02 — Inline image thumbnails for evidence files

**tweak** · value: **low**

Evidence chips in the rubric row currently show only a truncated filename and a 'View ↗' link to Drive, even for image evidence (screenshots of student work, whiteboard photos). Render a small thumbnail preview for image MIME types directly in the chip.

**Why this fits.** Evidence is often a photo of student work — a thumbnail lets an observer/reviewer recognize the right file at a glance instead of opening Drive for every image, which matters more on iPad where opening new tabs is disruptive.

**Implementation.** In apps/web/src/components/rubric/RubricRow.tsx's `EvidenceChip` (~line 768), check `fileRef.mimeType.startsWith('image/')` and render `<img src={`https://drive.google.com/thumbnail?id=${fileRef.driveFileId}`} className="h-8 w-8 rounded object-cover" />`before the filename (Drive's public thumbnail endpoint works for files shared with the Drive folder's viewers, which the observed staff already are once finalized; during Draft the endpoint may need the requester to be signed into a Google session with folder access — verify against a real image upload since the SA-owned file's`thumbnail?id=` link honors the same ACL as the file itself). DriveFileRef type is in packages/shared (driveFileRef in common.ts).

**Files.** `apps/web/src/components/rubric/RubricRow.tsx`

### OBS-03 — Wire up the existing 'Regenerate PDF' button

> ✅ **Shipped 2026-07-25** — PR #66. Shipped with a confirmation dialog. Follow-up open: the callable is still not rate-limited (see `TODO.md`).

**small** · value: **high**

The `regenerateObservationPdf` callable (re-renders and re-uploads the PDF for a Finalized observation, replacing the old file in-place) is fully implemented and exported server-side but has zero callers anywhere in apps/web — there is no button that invokes it. Add a 'Regenerate PDF' action to the finalized observation view for the observer/admin.

**Why this fits.** This is the highest-leverage item in the whole list: the backend (audit logging, Drive replace-in-place, re-share, error handling) is already built and presumably tested — the only missing piece is a UI trigger. Solves a known real scenario: an admin reopens a finalized observation, fixes a typo, but doesn't need a full re-finalize — or a PDF render silently failed and needs a manual retry.

**Implementation.** Add a callable binding `httpsCallable<{observationId:string}, {pdfDriveFileId:string; driveFolderId:string; pdfWebViewLink:string}>(functions, 'regenerateObservationPdf')` in apps/web/src/observations/ObservationEditorPage.tsx alongside the existing `finalizeObservationFn`/`reopenObservationFn` pattern (~line 61-69). Show the button in `EditorToolbar` when `isReadOnly && (isObserver || isAdminUser)` — reuse the same button styling as the existing Reopen action. On success, show the same `FinalizedBanner`-style success state with the fresh `pdfWebViewLink`. The callable enforces observer-or-admin + Finalized-only server-side (apps/functions/src/observations/regenerateObservationPdf.ts), so client-side gating is UX only, not the security boundary.

**Files.** `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/functions/src/observations/regenerateObservationPdf.ts`

### OBS-04 — Finalize-readiness checklist

> ✅ **Shipped 2026-07-25** — PR #71. Non-blocking warning, as specified: Finalize stays enabled regardless of unscored components.

**small** · value: **high**

The Finalize confirmation dialog currently only lists observed name, type, and audio count — it doesn't warn if the observer is about to lock in an observation with unscored components. Add a lightweight checklist: 'X of Y components scored', flagging any assigned component with no proficiency selected, before the observer commits to an irreversible finalize.

**Why this fits.** Finalization is permanent (draft becomes read-only, no more edits) — catching an accidentally-skipped component before that lock, rather than after, avoids needing an admin-only Reopen just to fix an oversight.

**Implementation.** In apps/web/src/observations/ObservationEditorPage.tsx's `FinalizeDialog` (~line 1083), compute `activeComponents.filter(ac => !draft.observationData[ac.component.id]?.proficiency)` (activeComponents is already derived in the parent, ~line 172) and pass the unscored list in as a prop. Render a non-blocking amber notice listing the unscored component ids/titles ('1a, 2c have no rating selected — finalizing will freeze them as unscored'). Keep the Finalize button enabled regardless (some components are legitimately not observed in a given lesson) — this is a warning, not a hard gate, consistent with the app's existing philosophy of trusting the PE's judgment.

**Files.** `apps/web/src/observations/ObservationEditorPage.tsx`

### OBS-05 — Draft-list triage: sort by staleness + days-open badge

**small** · value: **medium**

ObservationsListPage is hard-sorted by lastModifiedAt desc with no way to surface the oldest untouched drafts. Add a sort toggle ('Recently updated' / 'Oldest first') and a days-open badge on Draft rows so PEs/admins can triage which observations have been sitting the longest before the cutover deadline.

**Why this fits.** With Aug/Sept 2026 district-wide cutover looming and an entire district's worth of PEs onboarding, an admin needs to spot abandoned drafts before they become a compliance problem — this is pure client-side sort/derived-display work over data already being fetched.

**Implementation.** In apps/web/src/observations/ObservationsListPage.tsx, add a second `orderBy` option: when 'Oldest first' is selected, swap `orderBy('lastModifiedAt', 'desc')` for `orderBy('createdAt', 'asc')` in the `constraints` useMemo (~line 90) filtered to `status === Draft`, and add `sortMode` to the hook's keyParts array so it resubscribes. Reuse the existing `formatRelative()` helper (~line 450) for a 'Opened Nd ago' badge on Draft rows in the table body (~line 382).

**Files.** `apps/web/src/observations/ObservationsListPage.tsx`

### OBS-06 — CSV export of the filtered observations list

**small** · value: **medium**

Add an 'Export CSV' button to ObservationsListPage that downloads the currently filtered/loaded rows (status, observer, observed, type, dates) as a CSV, for admins who want to work with the data in a spreadsheet without waiting on the Master Log Sheet sync setup.

**Why this fits.** The Google Sheet mirror (onObservationWritten.ts's `syncRow`) only runs when an admin has configured `MASTER_LOG_SHEET_ID` — many districts (including this one, pre-cutover) may never set that up. A one-click CSV export needs no server config and works immediately for ad hoc reporting.

**Implementation.** Client-side only: in apps/web/src/observations/ObservationsListPage.tsx, add a button next to the search bar that builds CSV rows from `combined` (the already-loaded+filtered array, ~line 221) using the same fields as `HEADER_ROW`/`buildRow` in apps/functions/src/observations/onObservationWritten.ts for column-naming consistency, then triggers a `Blob`+`URL.createObjectURL` download — no new dependency needed (no `csv-stringify` etc., just manual quoting/escaping). Only exports rows currently loaded in the page (respects PAGE_SIZE/'Load more'), so label the button 'Export loaded rows' or nudge the user to 'Load more' first if `observations.length === pageSize`.

**Files.** `apps/web/src/observations/ObservationsListPage.tsx`, `apps/functions/src/observations/onObservationWritten.ts`

**See also.** `SCHED-08`, `STAFF-12`, `XCUT-08`

### OBS-07 — Send a follow-up note from a finalized observation

**small** · value: **medium**

After finalizing, add a 'Send a note' action on the FinalizedBanner / finalized read-only view that lets the observer compose and send a short one-off email to the observed staff member (e.g. 'Let's talk about 2c next week') — reusing the existing manual-email pipeline instead of the PE having to leave the app to send a district email.

**Why this fits.** The manual email pipeline (sendManualEmail callable, EMAIL_TRIGGER_TYPES `'manual'`) already exists and is already used from apps/web/src/routes/StaffPersonPage.tsx for exactly this kind of one-off message — this just adds a second, observation-scoped entry point that pre-fills recipient and subject context.

**Implementation.** Reuse the `sendManualEmailFn` httpsCallable binding pattern from apps/web/src/routes/StaffPersonPage.tsx (~line 42-45) and whatever compose-dialog component it renders (grep for its Dialog usage in that file). Add a 'Send a note' button to `FinalizedBanner` in apps/web/src/observations/ObservationEditorPage.tsx (~line 1249), pre-filling `to: observation.observedEmail` and a subject like `Re: ${observation.observationName || observation.type + ' observation'}`. Respects the recipient's `manualMessages` email preference category (packages/shared/src/schema/emailTemplate.ts EMAIL_TRIGGER_CATEGORY) automatically since it goes through the same callable.

**Files.** `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/routes/StaffPersonPage.tsx`, `apps/functions/src/email/sendManualEmail.ts`

### OBS-08 — Overdue-finalize reminder email

**medium** · value: **high**

scheduledEmailReminders.ts already sends 'pre-observation' reminders (N days before the observation date) and 'incomplete WP/IR' reminders (N days after creation with no answers) — but nothing reminds the \*observer\* (PE) that an observation's date has come and gone and it's still sitting in Draft, unfinalized. Add a third daily reminder block: for any Draft observation whose observationDate is N+ days in the past, email the observer a nudge to finish and finalize it.

**Why this fits.** This is the actual gap in the existing reminder system: the other two reminders target the observed staff member's participation, not the PE's follow-through on finalizing — and an unfinalized observation from weeks ago is exactly the kind of thing that surfaces as a district-wide compliance problem right before the Aug/Sept cutover deadline.

**Implementation.** Add a new trigger type `'scheduled.reminderOverdueFinalize'` to EMAIL_TRIGGER_TYPES in packages/shared/src/schema/emailTemplate.ts (map it into EMAIL_TRIGGER_CATEGORY as 'reminders' so staff email preferences still apply — though note the recipient here is the observer, not observed staff, so double check whether email preference should gate on the \*observer's\* staff doc rather than the observed one; sendTemplatedEmail's suppression logic needs to look up the right person). Add a third block to apps/functions/src/email/scheduledEmailReminders.ts mirroring the existing '2. Incomplete WP/IR reminders' block (~line 158-212): query `.where('status','==','Draft').where('observationDate','<=', Timestamp.fromDate(cutoff))` using the existing `chicagoMidnight()` helper, `sendEmail` to `obs.observerEmail`, `mailDocId: `overdue-${docSnap.id}``for idempotency. Add the matching system EmailTemplate seed (see how`'scheduled.reminderIncomplete'`templates get seeded/exposed in apps/web/src/admin/email-templates/EmailTemplatesPage.tsx) so admins can tune`scheduledDays` and copy without a deploy, same as the existing two.

**Files.** `apps/functions/src/email/scheduledEmailReminders.ts`, `packages/shared/src/schema/emailTemplate.ts`, `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx`

### OBS-09 — Pre-finalize full read-only preview

**medium** · value: **medium**

The FinalizeDialog only shows three summary lines before an irreversible lock. Add a genuine 'Preview' step — a full-screen or large-dialog read-only render of the entire rubric grid exactly as it currently stands (all proficiency selections, notes, look-fors, evidence chips) so the observer can scan the complete record one last time before finalizing, without having to scroll the live editor.

**Why this fits.** Finalization can't be undone by the observer (only an admin can Reopen) — a dedicated 'read it exactly as it'll be locked' preview is a meaningfully different UX from scrolling the editable form and catches mistakes (wrong proficiency clicked, empty notes) that are easy to miss while still in edit mode.

**Implementation.** RubricGrid already supports a read-only rendering of live draft state: pass `mode.kind === 'edit'` with `readOnly: true` and the current `draft.observationData`/`draft.componentNotes`/`observation.evidenceLinks` (exactly the props already built in ObservationEditorPage.tsx ~line 854-871) into a second `<RubricGrid>` instance inside a full-screen Dialog/Sheet, triggered by a 'Preview' button next to Finalize in `EditorToolbar`. No new component logic needed in RubricGrid/RubricRow — they already branch on `mode.readOnly`. Give the preview its own `storageScope` (e.g. `preview-${observation.id}`) so its collapsed/expanded look-fors state doesn't fight the live editor's sessionStorage-backed state (see RubricGrid's storageScope doc comment).

**Files.** `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/components/rubric/RubricGrid.tsx`, `apps/web/src/components/rubric/RubricRow.tsx`

### OBS-10 — Growth-focus flag on rubric components

**medium** · value: **medium**

Let the observer mark 1-2 components as the 'growth focus' for this observation (a star/flag toggle next to the proficiency ratings), and surface those flagged components prominently in a small summary card at the top of the finalized view and in the PDF — so the single most actionable takeaway from a 20-component rubric doesn't get lost.

**Why this fits.** A full Danielson-style rubric can have 20+ components; peer-observation research consistently shows feedback lands better when narrowed to 1-2 focus areas rather than a wall of ratings — this gives the observer a lightweight way to do that within the existing scoring flow instead of relying on prose in the meeting notes.

**Implementation.** Add `flaggedForGrowth: z.boolean().default(false)` to `observationComponentEntry` in packages/shared/src/schema/observation.ts (backward compatible — Zod default; note per repo docs raw Firestore reads bypass `.default()`, so treat missing as `false` client-side, same pattern already used for `useGeminiFeatures`). Add a star toggle button next to the component id/title in apps/web/src/components/rubric/RubricRow.tsx's header cell (~line 254-278), wired through `mode.onProficiency`-sibling callback (add `onToggleGrowthFlag` to the `RubricGridMode` 'edit' variant in RubricGrid.tsx, threaded the same way `onToggleLookFor` already is). Add a summary card above the RubricGrid in ObservationEditorPage.tsx listing flagged components' ids/titles when `isReadOnly`. For the PDF, thread the flag through `renderObservationPdf`'s payload (apps/pdf-renderer/src/template.ts) and render a small 'Growth focus' callout — since `rubricSnapshot` freezes rubric \*content\* but `observationData` (including the new flag) is stored separately and unaffected by snapshotting.

**Files.** `packages/shared/src/schema/observation.ts`, `apps/web/src/components/rubric/RubricRow.tsx`, `apps/web/src/components/rubric/RubricGrid.tsx`, `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/pdf-renderer/src/template.ts`

### OBS-11 — Required Work Product / Instructional Round questions

**medium** · value: **medium**

The workProductQuestion schema has no concept of 'required' — an observer can finalize a Work Product or Instructional Round observation with every question left blank. Add an admin-settable `required` flag per question, and warn (or optionally block) finalization when required questions are unanswered.

**Why this fits.** Work Product/Instructional Round observations already have an 'incomplete' reminder email that nags the observed staff after N days of zero answers (scheduledEmailReminders.ts) — but there's no concept of a specific question being mandatory vs. optional, and no gate at finalize time, so a PE can still finalize an entirely empty questionnaire.

**Implementation.** Add `required: z.boolean().default(false)` to `workProductQuestion` in packages/shared/src/schema/workProductQuestion.ts. Add the toggle to the admin question editor in apps/web/src/admin/work-product/WorkProductPage.tsx (same file that manages `isActive`/`order` today). In apps/web/src/observations/ObservationEditorPage.tsx's `FinalizeDialog`, when `observation.type` is Work Product/Instructional Round, cross-reference `workProductAnswerHasText()` (already exported from packages/shared/src/schema/observation.ts, already used server-side in finalizeObservation.ts and scheduledEmailReminders.ts) against the required question ids and show the same non-blocking amber warning pattern as the finalize-readiness checklist idea above (or make it blocking — a product decision to confirm with the district, since standard observations stay warning-only for consistency).

**Files.** `packages/shared/src/schema/workProductQuestion.ts`, `apps/web/src/admin/work-product/WorkProductPage.tsx`, `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/functions/src/observations/finalizeObservation.ts`

### OBS-12 — "Observe again" quick-create

**medium** · value: **medium**

Add an 'Observe again' action on a finalized observation (and on the observations list row) that opens CreateObservationDialog pre-filled with the same staff member and type — for the common case of a PE doing a second observation of the same teacher, or observing the same class across multiple periods in one day.

**Why this fits.** Today, starting a repeat observation means going back to NewObservationPage and re-searching/re-filtering for the same staff member from scratch every time — a one-click shortcut from a context where the staff member is already on screen removes that friction for the app's most repeated action.

**Implementation.** CreateObservationDialog already accepts a `staff: Staff` prop and only needs `{email, name, role, year, buildings}` (apps/web/src/observations/CreateObservationDialog.tsx ~line 30-42) — Observation already denormalizes all of that onto itself, so build a minimal `Staff`-shaped object directly from the current `observation` (`{email: observation.observedEmail, name: observation.observedName, role: observation.observedRole, year: observation.observedYear, buildings: observation.observedBuildings, ...}`) rather than re-fetching the /staff doc. Add the button next to FinalizedBanner in ObservationEditorPage.tsx and as a row action in ObservationsListPage.tsx. Respects the same `useNewObservationsDisabled()` gate the dialog already checks internally.

**Files.** `apps/web/src/observations/CreateObservationDialog.tsx`, `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/observations/ObservationsListPage.tsx`

### OBS-13 — District-wide observation-cycle compliance tracker

**large** · value: **high**

A new admin page cross-referencing every active staff member's evaluation-cycle status (packages/shared/src/cycle.ts: low/high/probationary, derived from `staff.year`) against how many observations have actually been finalized for them this school year, surfacing who is on track vs. behind before the evaluation deadline — the compliance question every peer-observation program administrator ultimately needs answered.

**Why this fits.** The domain already models the entire evaluation-cycle state machine (cycle.ts: displayYear, cycleStatus, rolloverCycle) purely as data — nothing in the UI currently answers 'which staff still need an observation this cycle.' For a district-wide rollout this is the single most valuable admin-facing view: it turns the tool from a per-observation form into an actual program-management dashboard.

**Implementation.** New admin route (register in apps/web/src/lazyRoutes.ts, admin-gated like other apps/web/src/admin/\* pages). Data model: join /staff (COLLECTIONS.staff, gives `role`/`year`/`isActive`/`buildings`) with a per-staff count of Finalized /observations this school year (`where('observedEmail','==', s.email).where('status','==','Finalized').where('finalizedAt','>=', schoolYearStart)`) — for a few hundred staff this is feasible as N bounded queries client-side (mirrors the pattern already used in ObservationsListPage's `searchOlderRecords`), or better, precompute via a scheduled/triggered Cloud Function that maintains a denormalized `/staff/{email}.observationsThisCycle` counter on `onObservationWritten` (apps/functions/src/observations/onObservationWritten.ts already listens to every observation write and could increment/decrement a counter cheaply). Use `cycleStatus()`/`displayYear()` from packages/shared/src/cycle.ts to label each row (Low/High/Probationary cycle) and to derive an admin-configured 'required observations per cycle status' setting (new field on AppSettings, packages/shared/src/schema — needs its own settings-page UI). Explicitly flag: any new composite Firestore index this needs (e.g. observedEmail+status+finalizedAt, which may already exist per MyObservationsPage's doc comment — verify against firestore.indexes.json) requires \*\*owner sign-off\*\* since that file is protected.

**Files.** `apps/web/src/lazyRoutes.ts`, `packages/shared/src/cycle.ts`, `apps/functions/src/observations/onObservationWritten.ts`, `packages/shared/src/schema/appSettings.ts`, `firestore.indexes.json`

**Depends on.** Likely needs a new Firestore composite index (owner sign-off required for firestore.indexes.json) unless the existing observedEmail+status+finalizedAt index already covers the query shape used.

### OBS-14 — Evaluation Insights suite (growth trends + rater consistency)

**suite** · value: **high**

A cohesive admin reporting module built on top of the frozen `rubricSnapshot` every finalized observation already carries: (1) a growth-over-time view for any individual staff member showing how their proficiency level moved across successive finalized observations, component by component; (2) a rater-consistency report surfacing whether a given PE's distribution of proficiency ratings (developing/basic/proficient/distinguished) is a statistical outlier compared to the district average — a quality-assurance signal for the evaluation program itself, not just for individual teachers.

**Why this fits.** Every finalized observation already permanently freezes its rubricSnapshot + observationData specifically so historical comparisons stay valid even after rubric edits — that design decision (documented in observation.ts's comments) all but signals that comparison/trend tooling was anticipated but never built. This is the largest single opportunity in the domain: it's the only idea that turns 'one observation at a time' data into a program-level asset for admins evaluating the evaluation process itself.

**Implementation.** Two sub-views sharing one new admin route tree (apps/web/src/admin/insights/ or similar, registered in lazyRoutes.ts): (a) Growth view — given an observedEmail, fetch all Finalized observations ordered by finalizedAt, align each observation's `rubricSnapshot.domains[].components[]` by componentId, and render a per-component timeline of PROFICIENCY_LEVELS index (developing=0..distinguished=3) — reuse `PROFICIENCY_LEVELS`/`PROFICIENCY_LABELS` from apps/web/src/components/rubric/RubricGrid.tsx for consistent ordering/labels. (b) Rater view — for each observerEmail, aggregate the proficiency distribution across all their Finalized `observationData` entries and compare to the district-wide distribution; this needs either a bounded client-side scan (fine at a few-hundred-staff scale, mirroring ObservationsListPage's existing multi-query pattern) or, better, an incrementally-maintained aggregate doc updated from `onObservationWritten.ts` on each finalize (cheaper reads at query time, more moving parts to build/test). Both sub-views are read-only reporting over existing collections — no new writes, so no rules changes — but any new composite index (e.g. querying all Finalized docs by observerEmail+finalizedAt across the whole collection) needs \*\*owner sign-off\*\* for firestore.indexes.json. Ship the growth view first (smaller, no aggregation needed) as a slice of this suite before tackling rater analytics.

**Files.** `apps/web/src/lazyRoutes.ts`, `apps/web/src/components/rubric/RubricGrid.tsx`, `packages/shared/src/schema/observation.ts`, `apps/functions/src/observations/onObservationWritten.ts`, `firestore.indexes.json`

**Depends on.** Likely needs new Firestore composite indexes (owner sign-off required); rater-analytics half may need a new aggregation write path in onObservationWritten.ts. Recommend scoping the growth-comparison half as an independently shippable first slice.

---

<a id="sched"></a>

## Scheduling, booking & calendar

### SCHED-01 — Status/pending-invite filter on the windows table

**tweak** · value: **low**

Add a status filter dropdown (All / Open / Partially booked / Fully booked / Cancelled / Expired) above the table in MyObservationWindowsPage, plus a small 'X of Y invited' fraction already computable from `invitees` so a PE managing many windows can find the ones needing attention without scrolling the whole list.

**Why this fits.** MyObservationWindowsPage.tsx currently renders every window the caller owns (or, for admins, every window) with no filtering — as the number of past/expired windows grows this becomes a long scroll. Purely additive client-side state, zero schema or callable changes.

**Implementation.** Edit apps/web/src/observations/MyObservationWindowsPage.tsx: add a `useState<ObservationWindow['status'] | 'all'>` filter, derive `visible` (already memoized) with an extra `.filter(w => status === 'all' || w.status === status)`, render a native `<select>` styled like the existing `SELECT_CLASS` pattern used in AssignPreferencesPage.tsx. STATUS_LABELS already exists in this file for option text. No backend change.

**Files.** `apps/web/src/observations/MyObservationWindowsPage.tsx`

### SCHED-10 — Slot grid quick-jump to next available slot

**tweak** · value: **low**

In SlotGrid, add a small 'Jump to next available' button (or auto-scroll on mount) that scrolls the booking page to the first date group containing an available slot, since a multi-week window can render many day groups before the invitee reaches an open one — especially relevant on iPad where scrolling a long grid is more friction than on desktop.

**Why this fits.** SlotGrid.tsx already groups and sorts slots by date/time but has no navigation aid; for a several-week window with early dates fully booked, invitees must scroll past multiple exhausted days. iPad Safari is called out as a first-class target, and scroll-heavy UIs are exactly where small navigation affordances pay off there.

**Implementation.** In apps/web/src/scheduling/SlotGrid.tsx, compute `firstAvailableDate = byDate.find(g => g.slots.some(s => s.status === 'available'))?.date` and add a ref + `scrollIntoView({ behavior: 'smooth', block: 'start' })` on a button next to the heading, or a `useEffect` that scrolls to that day group on mount if it isn't the first group. Purely presentational, no state/schema changes.

**Files.** `apps/web/src/scheduling/SlotGrid.tsx`

### SCHED-11 — Window progress/urgency indicator on the windows table

**tweak** · value: **low**

Add a small progress bar or 'closes in N days' badge to each row of MyObservationWindowsPage — computed from `booked/total` invitees and `endDate` minus today — so a PE scanning many open windows can see at a glance which ones are stalling (low booked fraction, few days left) without opening each one.

**Why this fits.** The table already shows 'booked / total' as plain text and the date range as plain text; both numbers needed for urgency are already loaded, this only changes the rendering of data already on screen.

**Implementation.** In apps/web/src/observations/MyObservationWindowsPage.tsx's row-render, compute `daysLeft` from `w.endDate` vs. today's Chicago date the same way expireObservationWindows.ts computes it server-side (`new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())`), and render either a small `<progress>`/div-bar for `booked/total`, or a colored badge (reuse `statusBadgeClass`-style Tailwind classes already in this file) reading e.g. '3 days left' in red under a threshold. No backend change.

**Files.** `apps/web/src/observations/MyObservationWindowsPage.tsx`

### SCHED-02 — Clone/duplicate an observation window

> ✅ **Shipped 2026-07-25** — PR #65. Uses the `CopyPlus` icon, since `Copy` was already taken by the adjacent "Copy invite links" action.

**small** · value: **high**

Add a 'Duplicate' action next to Edit/Cancel on each window row in MyObservationWindowsPage that opens CreateObservationWindowDialog pre-filled with the source window's mode, weekdays, time bounds, travel buffer, per-day cap, signup fields, default observation type/name, calendar event title/description, and gcalSendUpdates — leaving dates and invitees blank for the PE to set fresh. Saves a PE from re-entering identical settings every time they open a similar window (e.g. 'Fall round' repeated per quarter).

**Why this fits.** Explicitly named gap in the facts: no bulk window operations or clone-a-window-template. createObservationWindow already accepts a full self-contained input object, so cloning is a pure client-side pre-fill — no backend change required.

**Implementation.** Add an optional `seedFrom?: ObservationWindow` prop to CreateObservationWindowDialog (apps/web/src/observations/CreateObservationWindowDialog.tsx); in the `useEffect` that resets state on open, prefer `seedFrom.<field>` over `settings.default<Field>` when present, leaving startDate/endDate/selected(invitees) empty regardless. In MyObservationWindowsPage.tsx add a 'Duplicate' Button (Copy icon already imported) that stores the source window and opens the dialog with `seedFrom` set.

**Files.** `apps/web/src/observations/CreateObservationWindowDialog.tsx`, `apps/web/src/observations/MyObservationWindowsPage.tsx`

### SCHED-03 — Bulk-resend outstanding window invites

**small** · value: **medium**

Add a 'Resend all outstanding' action on a window's detail/edit view that resends the invite email to every un-booked invitee in one click instead of one at a time, reusing the same template and dedup-safe mail-doc-id pattern as the existing single resend.

**Why this fits.** Gap explicitly noted: 'No batch resend of window invites (only per-invitee resend available)'. The existing resendWindowInvite callable already does the safe per-invitee work (fresh mailDocId, inviteSentAt stamp) — this only needs a batching wrapper.

**Implementation.** Add a new callable apps/functions/src/scheduling/resendAllWindowInvites.ts mirroring resendWindowInvite.ts's auth/permission checks (isAdminRole or window.observerEmail === caller), looping `window.invitees.filter(inv => inv.bookedSlotId == null)` and calling the same sendTemplatedEmail + stampResentInvitee logic (extract the per-invitee send into a shared helper both files call, e.g. `sendWindowInviteToInvitee` in resendWindowInvite.ts), writing invitees back once at the end via `FieldValue` batch update rather than N sequential document updates. Add `resendAllWindowInvitesInput`/register the function export in apps/functions/src/index.ts. Add a 'Resend all outstanding' Button in EditObservationWindowDialog.tsx calling the new httpsCallable. New callable needs rate-limit + audit-log entries matching the sibling scheduling callables (see apps/functions/src/lib/rateLimit.ts pattern already used elsewhere).

**Files.** `apps/functions/src/scheduling/resendWindowInvite.ts`, `apps/functions/src/scheduling/resendAllWindowInvites.ts (new)`, `apps/web/src/observations/EditObservationWindowDialog.tsx`, `packages/shared/src/schema/observationWindow.ts`

### SCHED-07 — .ics calendar download fallback on booking confirmation

**small** · value: **medium**

On the booking confirmation screen (and in confirmation/assignment emails), offer a plain 'Add to calendar (.ics file)' link so a staff member who hasn't connected Google Calendar still gets a calendar entry for their observation, rather than relying entirely on the best-effort Google Calendar sync.

**Why this fits.** Google Calendar sync (onObservationBooked / createObservationEvent in apps/functions/src/calendar/lib/googleCalendar.ts) only fires when a party has connected their calendar; unconnected staff currently get nothing calendar-side beyond the confirmation email. An .ics file is a static, dependency-free fallback that needs no OAuth, no new third-party service, and reuses data already on the observation doc.

**Implementation.** Add a small pure function (e.g. packages/shared/src/ics.ts) that builds a minimal VCALENDAR/VEVENT string from `{ summary, description, startUTC, endUTC, uid }` — the same fields `buildObservationEventContent` in apps/functions/src/calendar/lib/googleCalendar.ts already computes, so that function's summary/description logic can be reused/exported instead of duplicated. Surface it two ways: (1) client-side, generate the .ics as a `data:text/calendar` blob URL and offer a download button on the booking-confirmation state of BookingPage.tsx and on SignupDetailsDisplay.tsx (no server round-trip needed since the slot/window data is already loaded); (2) optionally attach the .ics as a base64 MIME attachment on the `scheduling.bookingConfirmation` email by extending sendTemplatedEmail's call in bookObservationSlot.ts's createDraftObservationForBooking — check apps/functions/src/lib/emailUtils.ts's sendEmail signature for attachment support before committing to that path; if it doesn't support attachments, ship the client-side download link only for this size.

**Files.** `packages/shared/src/ics.ts (new)`, `apps/web/src/scheduling/BookingPage.tsx`, `apps/web/src/scheduling/SignupDetailsDisplay.tsx`

**See also.** `STAFF-04`

### SCHED-08 — CSV export of a window's roster and bookings

**small** · value: **medium**

Add an 'Export CSV' button on MyObservationWindowsPage (per window) and/or AssignPreferencesPage that downloads a CSV of every invitee's name, email, building, invite-sent status, and booked date/time (or preference/assignment status for day-preference mode) — useful for PEs reporting to admins outside the app.

**Why this fits.** No reporting/export capability exists for scheduling data today; admins currently would have to read Firestore or the UI table by hand. All the data (`invitees`, `slots`, `preferences`) is already loaded client-side by these pages via useFirestoreCollection/useFirestoreDoc, so this is a pure client-side transform + download, no new backend endpoint.

**Implementation.** Add a small `toCsv(rows: Record<string,string>[]): string` utility (or reuse one if apps/web/src/lib already has a CSV helper — check apps/web/src/lib for an existing export utility before writing a new one) and a `downloadCsv(filename, content)` helper using a Blob + temporary `<a>` click, the same pattern MyObservationWindowsPage.tsx already uses for `navigator.clipboard.writeText` (copy-links button). Wire an 'Export CSV' Button into MyObservationWindowsPage.tsx (per-row) building rows from `w.invitees` joined against booked-slot lookups, and into AssignPreferencesPage.tsx building rows from `sortedPrefs` joined against `slots`.

**Files.** `apps/web/src/observations/MyObservationWindowsPage.tsx`, `apps/web/src/scheduling/AssignPreferencesPage.tsx`, `apps/web/src/lib/csv.ts (new, if none exists)`

**See also.** `OBS-06`, `STAFF-12`

### SCHED-09 — Bulk date-override paste/import for building schedules

**small** · value: **medium**

On BuildingSchedulePage, add a 'Paste dates' bulk-add option next to the one-row-at-a-time override editor so an admin can paste a list of holiday/no-school dates (e.g. from a district calendar export) and add them all as no-school overrides in one action, instead of clicking 'Add override' once per date.

**Why this fits.** BuildingSchedulePage.tsx's override editor (OverrideEntry rows) only supports adding one ScheduleDateOverride row at a time via the form UI; a district typically has 10-20 holiday dates per year to enter per building, and Orono has multiple buildings each with their own schedule doc, making this repetitive today.

**Implementation.** In apps/web/src/admin/buildings/BuildingSchedulePage.tsx, add a small dialog/textarea where an admin pastes newline- or comma-separated YYYY-MM-DD dates; parse with the existing `localDate` regex from packages/shared/src/schema/buildingSchedule.ts, dedupe against existing `overrides[].date`, and append new `OverrideEntry` rows (dayTypeId: null for 'no-school', matching the existing no-school override semantics already documented in buildingSchedule.ts's comments) to the form's local `overrides` state using the same `newId('override')` keying the file already uses. No schema or callable change — this only changes how the same `overrides` array gets populated in the form before the existing save/setDoc path runs.

**Files.** `apps/web/src/admin/buildings/BuildingSchedulePage.tsx`

### SCHED-04 — Manual slot override in the auto-assign review dialog

**medium** · value: **high**

In AutoAssignDialog, let the PE change the proposed slot for any pending row via a dropdown of that preference's other available same-day/building slots before confirming, instead of only accept-all-or-nothing per the greedy algorithm's first pick.

**Why this fits.** Gap explicitly noted: 'PE cannot manually override auto-assignment proposal during review (must accept or reject each one individually)'. The plan is already just proposal data (buildAutoAssignPlan in autoAssignPreferences.ts) that AutoAssignDialog renders before executing — swapping a row's slotId before the execute loop calls assignObservationFromPreference is a pure client change; the server transaction already re-validates availability regardless of which slot is chosen.

**Implementation.** In apps/web/src/scheduling/AutoAssignDialog.tsx, replace the plain `<TableCell>` proposed-time display with a `<select>` (same SELECT_CLASS pattern as AssignPreferencesPage.tsx) populated from `slots.filter(s => s.buildingId === row.buildingId && s.dateYMD === row.preferredDateYMD && s.status === 'available')`, defaulting to the algorithm's picked slotId. Track edits in local state keyed by prefId (`Record<string, string>`), and when building the execution `working` array in `runAssignments`, substitute any overridden slotId. Since two rows could now be pointed at the same slot after manual edits, add a client-side warning badge when a slotId appears more than once in `displayRows` (the server transaction will reject the second one anyway, surfacing as a per-row 'error' status, but a pre-flight warning avoids wasted round-trips).

**Files.** `apps/web/src/scheduling/AutoAssignDialog.tsx`, `apps/web/src/scheduling/autoAssignPreferences.ts`

### SCHED-05 — Cross-window double-booking warning for invitees

**medium** · value: **high**

When a staff member is picked as an invitee for a new window (or books a slot), warn the PE/staff if that person already has an active booking (in any other open window) whose time overlaps the slot being considered, since nothing today prevents the same teacher from being pulled out of class twice at once by two different observers.

**Why this fits.** Gap explicitly noted: 'No scheduling conflict policy for same staff member overlapping multiple windows in the app (cross-window booking allowed)'. peBusyIntervals only tracks a single window's PE-time ledger, so cross-window overlaps for the \*observed\* staff member are invisible today.

**Implementation.** Add a lightweight read-only check: on BookingPage.tsx, before rendering SlotGrid, query `observations` where `observedEmail == userEmail` and `status == 'Draft'` (existing composite-friendly query, similar to scheduledEmailReminders.ts's observedEmail filter) to get the invitee's other scheduled (`scheduledStartAt`/`scheduledEndAt`) observations, and pass the resulting intervals into SlotGrid as a new `staffConflictedSlotIds` prop (parallel to the existing `conflictedSlotIds` for observer-calendar conflicts) computed via simple interval overlap against each slot's startUTC/endUTC. Badge those slots 'You have another observation at this time' the same way SlotGrid.tsx already badges 'Observer busy'. This is soft (warn-only, not blocking) to match the app's existing soft-fail philosophy for conflicts (checkSlotConflicts.ts). A hard-block variant would need a new Firestore composite index (observedEmail + status + scheduledStartAt) added to firestore.indexes.json — call out that index change needs owner sign-off if pursued.

**Files.** `apps/web/src/scheduling/BookingPage.tsx`, `apps/web/src/scheduling/SlotGrid.tsx`

**Depends on.** A composite Firestore index on observations(observedEmail, status, scheduledStartAt) may be needed for the query at scale — firestore.indexes.json is owner-protected, flag for sign-off if the simple client-side filter over a small result set isn't sufficient.

### SCHED-06 — Waitlist / notify-me for full day-preference days

**medium** · value: **medium**

When a day-preference window's `perDayCap` is reached for a given date, let a staff member who wants that day opt into a 'notify me if it opens up' waitlist entry instead of being stuck with no valid day to pick; when a preference on that day is withdrawn or its slot is cancelled, automatically email the next waitlisted person that the day has room again.

**Why this fits.** Gap explicitly noted: 'No wait-list / cancellation waitlist fallback when slots fill'. dayCounts on the window already tracks per-date submission counts (perDayCap enforcement point), so 'day is full' is already a computable fact — this only adds a queue and a trigger.

**Implementation.** Add a new subcollection `/observationWindows/{windowId}/waitlist/{email}` (extend WINDOW_SUBCOLLECTIONS in packages/shared/src/constants.ts) with a Zod schema `observationWaitlistEntry` (email, name, buildingId, preferredDateYMD, submittedAt) in a new packages/shared/src/schema/observationWaitlist.ts. In apps/functions/src/scheduling/submitDayPreference.ts, when the per-day cap check fails, instead of a hard error, return a distinguishable result so BookingPage.tsx can offer 'Join the waitlist for this day' calling a new `joinWaitlist` callable. Add a Firestore-triggered function (or extend withdrawDayPreference.ts / assignObservationFromPreference.ts's cancel path) that, after `dayCounts[date]` drops below `perDayCap`, pops the oldest waitlist doc for that date and sends a 'day open again' email via sendTemplatedEmail with a new EMAIL_TRIGGER_TYPES entry `scheduling.waitlistOpened` in packages/shared/src/schema/emailTemplate.ts (needs an admin-authored template, same as other scheduling triggers).

**Files.** `packages/shared/src/schema/observationWaitlist.ts (new)`, `packages/shared/src/constants.ts`, `packages/shared/src/schema/emailTemplate.ts`, `apps/functions/src/scheduling/submitDayPreference.ts`, `apps/functions/src/scheduling/withdrawDayPreference.ts`, `apps/web/src/scheduling/BookingPage.tsx`

### SCHED-12 — Admin scheduling health dashboard

**medium** · value: **medium**

A new admin page summarizing scheduling health across the district: count of open windows nearing their end date with low booking rates, buildings missing a bell schedule (blocking window creation for any invitee there), staff with connected vs. not-connected Google Calendars, and windows with unresolved schedule-change notifications — giving an admin a single place to spot problems before the Aug/Sept cutover rather than opening every window individually.

**Why this fits.** Today's admin surfaces (SchedulingSettingsPage, BuildingSchedulePage, BuildingsPage) are all per-entity editors with no aggregate view; the underlying facts (buildings without a buildingSchedules doc, windows with `scheduleChangeNotifiedIssues`, low booking rates near expiry) are all already stored but never surfaced together. Valuable specifically for a solo-developer district ahead of a district-wide rollout where visibility into rollout health matters more than any single window.

**Implementation.** New page apps/web/src/admin/scheduling/SchedulingHealthPage.tsx, added to apps/web/src/lazyRoutes.ts (mirroring the existing `'/admin/scheduling-settings': 'SchedulingSettingsPage'` entry) at e.g. `/admin/scheduling-health`, gated the same way other admin routes are (check apps/web/src/admin/scheduling/SchedulingSettingsPage.tsx or the route guard pattern in lazyRoutes.ts for admin-only access). Pull data with existing hooks: `useFirestoreCollection<ObservationWindow>(COLLECTIONS.observationWindows)`, `useFirestoreCollection<Building>(COLLECTIONS.buildings)` cross-referenced against `useFirestoreCollection<BuildingSchedule>(COLLECTIONS.buildingSchedules)` to flag buildings with no matching schedule doc, and a slots subcollection group query (`collectionGroup('slots').where('scheduleChangeNotifiedIssues', '!=', [])` — note this needs a composite/array index; check firestore.indexes.json, owner sign-off required if a new index is needed) to list unresolved schedule-change issues. All-client-side aggregation, no new callable required for the read side.

**Files.** `apps/web/src/admin/scheduling/SchedulingHealthPage.tsx (new)`, `apps/web/src/lazyRoutes.ts`

**Depends on.** A collectionGroup query over slots' scheduleChangeNotifiedIssues may need a new Firestore index — firestore.indexes.json is owner-protected, flag for sign-off; the simpler per-building/per-window aggregation needs no index changes.

### SCHED-13 — Recurring observation windows

**large** · value: **high**

Let a PE define a recurrence (e.g. 'every 4 weeks' or 'once per quarter') when opening a window, so the system automatically opens a new window with the same settings and invitees on each cycle instead of the PE manually recreating one every rotation — a natural extension once the clone-window feature exists, but automated rather than manual.

**Why this fits.** Gap explicitly noted: 'No recurring/repeating observation windows (each window created independently)'. For a PE running standing quarterly observation rounds for the same roster, this removes the single biggest piece of manual, repetitive admin overhead in the whole scheduling flow — the createObservationWindow callable already does 100% of the heavy lifting (slot generation, invite tokens, emails), so recurrence is really 'call that same logic on a timer with saved parameters'.

**Implementation.** Add a new schema `packages/shared/src/schema/recurringWindowSeries.ts` (windowSeriesId, all the same fields as createObservationWindowInput minus startDate/endDate, plus a recurrence rule — keep it simple: `{ intervalWeeks: number, occurrences: number | null, nextStartDate: localDate }` rather than full RFC5545 RRULE, matching this repo's preference for simple/explicit over general-purpose). Store as `/recurringWindowSeries/{id}`. Add a new `onSchedule` function (pattern: apps/functions/src/scheduling/expireObservationWindows.ts) that runs daily, finds series whose `nextStartDate` has arrived, calls the same window-creation logic used by createObservationWindow.ts (factor its core into a shared `createWindowFromInput()` helper both the callable and the scheduled job call) and advances `nextStartDate` by `intervalWeeks`. Add a 'Repeat this window' toggle + interval/occurrence inputs to CreateObservationWindowDialog.tsx that, instead of (or in addition to) calling createObservationWindow directly, writes a recurringWindowSeries doc via a new `createRecurringWindowSeries` callable. Add a small admin/PE list view to manage/cancel a series. This is the largest of the ideas here — treat window-series management (pause, edit invitee roster between occurrences, cancel remaining occurrences) as its own sub-scope within the implementation.

**Files.** `packages/shared/src/schema/recurringWindowSeries.ts (new)`, `apps/functions/src/scheduling/createObservationWindow.ts`, `apps/functions/src/scheduling/createRecurringWindowSeries.ts (new)`, `apps/functions/src/scheduling/runRecurringWindowSeries.ts (new, onSchedule)`, `apps/web/src/observations/CreateObservationWindowDialog.tsx`, `apps/web/src/observations/MyObservationWindowsPage.tsx`

---

<a id="ai"></a>

## Audio, transcription & AI tagging

### AI-01 — Playback speed control on recordings

> ✅ **Shipped 2026-07-25** — PR #69. Rate is per-player local state, not persisted.

**tweak** · value: **medium**

Add a small speed selector (0.5x/1x/1.25x/1.5x/2x) next to each audio player in the AudioRecorder's recordings list, so observers can skim a long recording quickly while cross-checking the transcript rather than listening at real-time speed.

**Why this fits.** Zero backend work, pure UX win for a workflow (verifying transcript accuracy against audio) that already exists. Costs nothing against the Aug/Sept cutover timeline.

**Implementation.** In apps/web/src/observations/AudioRecorder.tsx's RecordingPlayer component (around line 485), add a `<select>` or small button group next to the `<audio controls src={src}>` element that sets `audioRef.current.playbackRate` — requires converting the `<audio>` from an uncontrolled JSX element to one backed by a `useRef<HTMLAudioElement>`. Persist the chosen rate in a `useState` local to RecordingPlayer (no need to persist across sessions). No schema or Cloud Function changes.

**Files.** `apps/web/src/observations/AudioRecorder.tsx`

### AI-02 — Copy transcript to clipboard

**tweak** · value: **low**

Add a small 'Copy' icon button next to the existing transcript `<details>` block in the recordings list so observers can quickly paste a transcript into an email or another doc without selecting text by hand.

**Why this fits.** Trivial addition that reuses text already rendered in the DOM; no new state machine, no server call.

**Implementation.** In apps/web/src/observations/AudioRecorder.tsx's RecordingsList (around line 448-477, inside the `{transcript ? <details>...}` block), add a button that calls `navigator.clipboard.writeText(transcript)` with a brief 'Copied' toast/state flip (mirror the existing `isInserted` local-state pattern used for the Insert button). Use the `Check`/`Copy` lucide icons already imported elsewhere in this file's import list style.

**Files.** `apps/web/src/observations/AudioRecorder.tsx`

### AI-03 — Download transcript as .txt

**small** · value: **medium**

Add a 'Download .txt' action alongside 'Insert into script' on each completed transcript so observers can save a plain-text copy for their own records or to paste into external tools, independent of the observation workflow.

**Why this fits.** Common ask for PE/administrator archival habits carried over from the old GAS workflow; purely client-side, no PII exposure beyond what's already visible on screen.

**Implementation.** In apps/web/src/observations/AudioRecorder.tsx's RecordingsList transcript block, add a handler that builds `new Blob([transcript], { type: 'text/plain' })`, creates an object URL, and triggers a synthetic `<a download>` click — same `URL.createObjectURL`/`URL.revokeObjectURL` pattern already used for audio playback in RecordingPlayer (lines 492-519). Name the file using the observation id + recording index, e.g. `transcript-${observationId}-${i + 1}.txt`.

**Files.** `apps/web/src/observations/AudioRecorder.tsx`

### AI-04 — Pause/resume recording

**small** · value: **medium**

Add a Pause/Resume control during an in-progress recording so observers can stop capturing audio during an off-topic interruption (e.g. a fire drill, a private student conversation) without losing the segments recorded so far or starting a brand-new clip.

**Why this fits.** MediaRecorder natively supports `.pause()`/`.resume()`; observers currently must Stop (which finalizes and uploads) and start a second clip, fragmenting the transcript. This is a real workflow gap for a live classroom-observation tool.

**Implementation.** In apps/web/src/observations/AudioRecorder.tsx, extend the `Phase` union (currently 'idle'|'recording'|'uploading'|'error', line 46) with a 'paused' state. Add a Pause button in RecordButton (line 279) that calls `recorderRef.current?.pause()` and stops the `tickerRef` interval without clearing it; Resume calls `.resume()` and restarts the ticker. MediaRecorder continues appending to the same `chunksRef.current` array across pause/resume, so `uploadRecording` needs no changes. Update PhaseStatus (line 314) to show a distinct 'Paused' indicator.

**Files.** `apps/web/src/observations/AudioRecorder.tsx`

### AI-05 — Bulk re-queue failed transcription jobs

**small** · value: **medium**

Add a 'Re-queue all failed' button on the admin Transcription Jobs page next to the existing failed-count banner, so an admin recovering from a model outage or bad API key doesn't have to click Re-queue on dozens of rows one at a time.

**Why this fits.** The page already has a per-row RequeueButton and a visible failedCount banner (lines 128, 221-233 of TranscriptionJobsPage.tsx) pointing admins at the fix — this closes the loop for the actual recovery action, which today is entirely manual per row.

**Implementation.** In apps/web/src/admin/transcription/TranscriptionJobsPage.tsx, add a button next to the failedCount banner (around line 221) that iterates `jobs.filter(j => j.status === 'Failed')` and calls the existing `handleRequeue` (line 118) for each, sequentially or with a small concurrency cap (e.g. 3 at a time) to avoid slamming `requestTranscription`'s per-user daily rate limit (transcriptionRequestsPerDay in apps/functions/src/transcription/requestTranscription.ts, default 50 — see packages/shared/src/schema/settings.ts rateLimits). Surface a running count ('Re-queuing 4 of 12…') and stop early with a clear message if a call fails with 'resource-exhausted'.

**Alternate approach (proposed independently by the admin team).** apps/web/src/admin/transcription/TranscriptionJobsPage.tsx already defines `reQueueFn = httpsCallable(functions, 'requestTranscription')` and a per-row `handleRequeue`. Add the same `useRowSelection`-style select-mode used in apps/web/src/admin/roles/RolesPage.tsx (import from apps/web/src/admin/\_shared/useRowSelection.ts), restrict selectable rows to `status === 'Failed'`, and add a bulk action button that runs `Promise.allSettled(selectedFailedJobs.map(j => reQueueFn({observationId: j.observationId, audioFileId: j.audioDriveFileId})))`, reusing the existing `requeueState` map keyed by job id for per-row spinner/result feedback. `requestTranscription` is already rate-limited server-side via apps/functions/src/lib/rateLimit.ts (transcriptionRequestsPerDay in appSettings.rateLimits) so a runaway bulk click can't blow past the configured cap — surface a friendly error when the callable rejects for that reason.

**Files.** `apps/web/src/admin/transcription/TranscriptionJobsPage.tsx`, `apps/web/src/admin/_shared/useRowSelection.ts`, `apps/functions/src/lib/rateLimit.ts`

**Depends on.** Bounded by the existing transcriptionRequestsPerDay rate limit — bulk re-queue can legitimately exhaust an admin's own daily quota if the admin is also the requestedBy on jobs; worth surfacing that in the button's tooltip.

### AI-10 — Search and 'My jobs' quick filter on Transcription Jobs admin page

**small** · value: **low**

Add a text search box (matches requester email or observation id) and a 'My jobs' quick-filter chip to the admin Transcription Jobs page, which today only filters by status.

**Why this fits.** TranscriptionJobsPage already paginates 100 rows at a time with only a status filter (apps/web/src/admin/transcription/TranscriptionJobsPage.tsx, STATUS_OPTIONS chips at line 236); as job volume grows across a district-wide rollout, an admin investigating one teacher's failed transcription has no way to jump to it without scrolling pages.

**Implementation.** Add a `where('requestedBy', '==', ...)` Firestore constraint (Firestore doesn't support case-insensitive `contains` queries — this is exact-match on requester email, not a fuzzy search) alongside the existing `statusFilter` constraint in `buildQuery` (line 61-72), plus a client-side substring filter on `observationId` applied to the already-fetched `jobs` array (Firestore has no native substring search and adding one needs a search-index service out of scope here). Add a 'My jobs' chip that sets the requester filter to the signed-in admin's own email via `useAuth()`.

**Files.** `apps/web/src/admin/transcription/TranscriptionJobsPage.tsx`

**Depends on.** Exact-match search only for observationId (client-side over the loaded page) and requestedBy (server-side query) — full-text search is out of scope without a new indexing service.

### AI-14 — Customizable rubric-framework name in the auto-tag prompt

**small** · value: **low**

Let admins set the evaluation framework's display name (e.g. 'Marzano Framework', 'Orono Instructional Framework') used in the Gemini auto-tag prompt, instead of the prompt hardcoding 'Danielson Framework' regardless of what rubric a district actually configured.

**Why this fits.** geminiTagScript.ts's prompt text is hardcoded: 'You are tagging a teacher observation script with components from the Danielson Framework' (line 210) — but the app's own rubric schema comment notes Danielson is just 'the variant the GAS app shipped' (packages/shared/src/schema/rubric.ts), and the rubric editor lets admins fully redefine domains/components. A district running a different named framework would get subtly wrong prompt framing with no way to fix it short of editing source.

**Implementation.** Add a `frameworkName: z.string().trim().min(1).max(120).default('Danielson Framework')` field to the `geminiFeatures.scriptAutoTag` sub-schema (or a top-level `appSettings` field) in packages/shared/src/schema/settings.ts, editable via a text input in apps/web/src/admin/settings/SettingsPage.tsx near the existing scriptAutoTag model selector (around line 68/558-588). In apps/functions/src/observations/geminiTagScript.ts, read this value from the `settings` doc already being fetched (line 83-99) and interpolate it into the prompt template (line 210) in place of the literal 'Danielson Framework' string.

**Files.** `packages/shared/src/schema/settings.ts`, `apps/web/src/admin/settings/SettingsPage.tsx`, `apps/functions/src/observations/geminiTagScript.ts`

### AI-06 — Live quota indicator for audio uploads and transcription requests

**medium** · value: **medium**

Show observers a small 'X of Y transcriptions used today' / 'X of Y audio uploads this hour' indicator near the Record button and Transcribe button, so a PE approaching the district's rate limit understands why a request might soon be rejected instead of hitting a surprise 429/'resource-exhausted' error mid-observation.

**Why this fits.** apps/functions/src/lib/rateLimit.ts already computes `remaining` and `resetAtMs` on every check but only the requester who trips the limit ever sees it, and only as an error string. Firestore rules deny client reads of `rateLimitCounters` entirely, so this data is currently invisible until something fails.

**Implementation.** Add a new lightweight callable (e.g. `peekRateLimit` in a new apps/functions/src/lib or apps/functions/src/rateLimit/ file) that reads the caller's own `rateLimitCounters/{rateLimitCounterId(userEmail, key)}` doc (existing helper in apps/functions/src/lib/rateLimit.ts) and returns `{ remaining, resetAtMs, max }` via `decideRateLimit`'s pure logic but WITHOUT incrementing the counter (i.e. call `decideRateLimit(existing, max, windowMs, now)` and only read `.decision`, never write). No firestore.rules change needed since this goes through a callable, not direct client reads. Surface the result in apps/web/src/observations/AudioRecorder.tsx near the Record/Transcribe buttons, refetched on mount and after each successful upload/transcribe request. Keep it low-key (e.g. a muted caption) so it doesn't distract from the recording UI.

**Files.** `apps/functions/src/lib/rateLimit.ts`, `apps/web/src/observations/AudioRecorder.tsx`, `apps/functions/src/audio/uploadAudio.ts`, `apps/functions/src/transcription/requestTranscription.ts`

**Depends on.** New Cloud Function export needs to be registered in the functions index (wherever apps/functions/src/index.ts re-exports callables) — routine, not owner-protected.

### AI-07 — Auto-tag review before applying to script

**medium** · value: **high**

Instead of geminiTagScript silently rewriting the observer's scriptDoc the instant 'Auto-tag' is clicked, show the suggested component tags in a review panel first — accept, reject, or accept-all — before any marks are written to the script. Observers currently have no way to preview or selectively reject a bad AI suggestion short of manually finding and un-tagging it after the fact.

**Why this fits.** geminiTagScript (apps/functions/src/observations/geminiTagScript.ts) already computes `accepted`/`skippedCount` server-side and returns only counts; the actual suggested spans are discarded once written. This is the single biggest trust gap in the auto-tag feature for a tool whose entire purpose is producing defensible evaluation evidence — an unreviewable AI edit to an observation script is a real credibility risk for a district-wide eval tool.

**Implementation.** Split geminiTagScript into two callables: (1) a 'suggest' step that runs `callGeminiForTags` + the verbatim-match filtering (lines 150-171) and returns the accepted `RawTagSuggestion[]` plus componentColorMap entries WITHOUT calling `applyTagsToScriptDoc`/`obsRef.update`, and (2) an 'apply' step that takes a client-approved subset of those suggestions and does the existing `applyTagsToScriptDoc` + Firestore update. The client (apps/web/src/observations/ScriptEditor.tsx's `runAutoTag`, line 150) renders each suggestion (component id/title, matched text, source paragraph) in a checklist dialog, lets the observer uncheck any, then calls 'apply' with the kept subset. Reuse `extractTaggedSpansForComponent`/`buildScriptNotesDoc` styling conventions from apps/web/src/observations/extract-script-tags.ts for rendering the preview highlights. Since suggestions aren't persisted between the two calls, pass the full suggestion list back to 'apply' (it's small — capped by paragraph count) rather than round-tripping through Firestore.

**Files.** `apps/functions/src/observations/geminiTagScript.ts`, `apps/web/src/observations/ScriptEditor.tsx`, `apps/web/src/observations/extract-script-tags.ts`

### AI-08 — Transcription job quality flag (short-transcript / silence detection)

**medium** · value: **medium**

Flag transcription jobs whose resulting transcript looks suspiciously short relative to the recording — e.g. a 10-minute recording that produced a 5-word transcript, often meaning silence, a muted mic, or Gemini giving up. Surface a warning badge both in the admin Transcription Jobs page and inline on the recording in AudioRecorder, so users know to re-record rather than trust an empty-feeling transcript.

**Why this fits.** Explorer gap: 'No transcript quality metrics — transcript length logged but not indexed; no ability to flag low-confidence transcriptions.' A short transcript from a long recording is a common real failure mode (muted mic, wrong input device) and today looks identical in the UI to a genuinely quiet observation.

**Implementation.** In apps/functions/src/transcription/onTranscriptionJobCreated.ts, after a successful transcribeWithGeminiFileUri call (line 112), compute a simple heuristic — words-per-second-of-audio using the audio duration (derive from Drive file metadata if available, or approximate using `sizeBytes`/typical bitrate as a rough proxy since exact duration isn't currently read) vs. transcript word count — and store a new `qualityFlag: 'ok' | 'short' | null` field on the job doc at completion (extend packages/shared/src/schema/transcriptionJob.ts with `qualityFlag: z.enum(['ok','short']).nullable().default(null)`). Render a small warning badge next to 'transcript ready' in apps/web/src/observations/AudioRecorder.tsx's RecordingsList when `job.qualityFlag === 'short'`, and add a filter chip for it in apps/web/src/admin/transcription/TranscriptionJobsPage.tsx alongside the existing STATUS_OPTIONS chips.

**Files.** `packages/shared/src/schema/transcriptionJob.ts`, `apps/functions/src/transcription/onTranscriptionJobCreated.ts`, `apps/web/src/observations/AudioRecorder.tsx`, `apps/web/src/admin/transcription/TranscriptionJobsPage.tsx`

**Depends on.** Getting real audio duration cleanly may require decoding audio server-side (not currently done) — the size-based heuristic is a reasonable v1 that avoids adding a new dependency; note as an approximation, not exact duration.

### AI-09 — Scope auto-tag to a text selection

**medium** · value: **medium**

Let observers auto-tag just the currently-selected paragraph(s) instead of always re-running Gemini over the entire script. Useful after inserting a new transcript chunk or editing one section — right now any 'Auto-tag' click reprocesses the whole document, which is slower, costs more Gemini tokens, and can shuffle/duplicate tags on already-reviewed sections.

**Why this fits.** geminiTagScript today always calls `extractParagraphs(scriptDoc)` on the full document (apps/functions/src/observations/geminiTagScript.ts line 104) with no range parameter. A script grows incrementally across an observation (typed notes + multiple inserted transcripts), and re-tagging everything each time is wasteful and risks re-tagging spans an observer already manually corrected.

**Implementation.** Add an optional `paragraphRange?: { start: number; end: number }` to the `geminiTagScript` callable's request shape (apps/functions/src/observations/geminiTagScript.ts, GeminiTagRequest interface line 26). When present, slice `paragraphs` to that range before building `paragraphBlock` for the prompt (line 208), and when applying suggestions in `applyTagsToScriptDoc`, offset `paragraphIndex` back so marks land in the right place in the full doc (the function already tracks a `paragraphCounter` while walking the whole doc, line 334, so gate application to only counters inside range, leaving other paragraphs untouched). On the client, in apps/web/src/observations/ScriptEditor.tsx's `runAutoTag` (line 150), derive the selected paragraph range from `editor.state.selection` (mirror the existing `paragraphRangeAt` helper at line 456) and pass it through when there's a non-empty selection; fall back to whole-doc behavior when selection is empty, preserving today's default.

**Files.** `apps/functions/src/observations/geminiTagScript.ts`, `apps/web/src/observations/ScriptEditor.tsx`

### AI-11 — Drive quota status widget on the admin Settings page

**medium** · value: **medium**

Show the service account's current Google Drive storage usage (used / limit, percent) as a live stat on the admin Settings page, instead of quota status being invisible until the daily monitorDriveQuota sweep emails an alert at 80%.

**Why this fits.** monitorDriveQuota (apps/functions/src/drive/monitorDriveQuota.ts) already computes exactly this data once a day and only surfaces it via an email to the security admin when it crosses 80% — admins have no way to check current usage proactively (e.g. before a big observation season) or confirm the SA has headroom without waiting for an alert.

**Implementation.** Extract `parseStorageQuota` (already a standalone exported function, apps/functions/src/drive/monitorDriveQuota.ts line 25) into a small shared helper, then add a new lightweight admin-only callable (e.g. `getDriveQuotaStatus`) that calls `drive.about.get({ fields: 'storageQuota' })` via the existing `getDriveClient()` (apps/functions/src/lib/drive.ts) and returns `{ usageBytes, limitBytes, pct } | { unlimited: true }`. Gate the callable to admin role only (mirror the `isAdminRole` check pattern used in apps/functions/src/observations/geminiTagScript.ts line 78). Render a stat card in apps/web/src/admin/settings/SettingsPage.tsx near the rate-limit controls, calling the callable on mount with a manual refresh button (avoid polling — this data changes slowly).

**Files.** `apps/functions/src/drive/monitorDriveQuota.ts`, `apps/functions/src/lib/drive.ts`, `apps/web/src/admin/settings/SettingsPage.tsx`

**Depends on.** New callable needs registering in the functions index; no firestore.rules or storage.rules changes since it's a live Drive API read via a callable, not a Firestore read.

**See also.** `PLAT-11`

### AI-12 — Transcript version history per recording

**medium** · value: **medium**

Keep a short history of prior transcripts when an observer re-transcribes a recording, instead of silently overwriting `observation.transcripts[audioFileId]`. Let the observer view or restore an earlier transcript version from a small dropdown next to 'Re-transcribe'.

**Why this fits.** Explorer gap: 'Transcription caching is manual only — re-transcribing overwrites previous transcript, no versioning.' A model swap or a bad audio segment on retry can produce a worse transcript than the original with no way back today; `transcriptionJobs` already keeps every historical job doc (`groupLatestJobsByAudioFileId` in transcriptionJobGrouping.ts explicitly reduces multiple jobs per file down to 'latest' for display, line 27), so the raw history already exists — it's just discarded in the UI and the observation doc keeps only the newest text.

**Implementation.** The transcript history is already implicitly stored: every re-transcribe creates a new `/transcriptionJobs` doc with its own `transcriptPreview`/completedAt (packages/shared/src/schema/transcriptionJob.ts), but jobs are pruned after 90 days (per the transcriptionJob.ts doc comment) and `transcriptPreview` is only the first 280 chars — not the full text, which lives solely on `observation.transcripts[audioFileId]` and gets clobbered. To make full versions restorable: change `onTranscriptionJobCreated.ts`'s write (line 119-122) to store the transcript on the job doc itself in full (new `transcriptFull: z.string().nullable().default(null)` field on transcriptionJob schema) in addition to updating `observation.transcripts`, so the job history collection becomes the source of truth for prior versions. In apps/web/src/observations/AudioRecorder.tsx's RecordingsList, use `useTranscriptionJobs`'s underlying job list (not just the latest-per-file map) to build a small 'Version history' popover per recording showing past attempts by date, with a 'Restore this version' action that writes the chosen `transcriptFull` back into `observation.transcripts[audioFileId]` via a small callable (reuses the existing observer/admin permission check pattern from geminiTagScript.ts).

**Files.** `packages/shared/src/schema/transcriptionJob.ts`, `apps/functions/src/transcription/onTranscriptionJobCreated.ts`, `apps/web/src/observations/useTranscriptionJobs.ts`, `apps/web/src/observations/transcriptionJobGrouping.ts`, `apps/web/src/observations/AudioRecorder.tsx`

**Depends on.** Storing full transcript text on every job doc increases Firestore storage slightly (bounded by the existing 90-day job-retention prune) and means transcript text now lives in two places (job doc + observation doc) — worth a short data-consistency comment in the schema.

### AI-13 — Talk-time / speaker-balance analysis from transcripts

**large** · value: **high**

After a transcript completes, run a second Gemini pass that segments it into teacher-talk vs. student-talk turns (or estimates the teacher-talk percentage) and surfaces this as a simple stat next to the transcript — e.g. 'Teacher talk: ~72% of recorded time'. This is a well-known, high-value observation metric (student engagement / discourse balance) that peer observers currently have to estimate by ear.

**Why this fits.** Existing infra does all the hard parts already: Gemini Files API upload/transcribe pipeline (onTranscriptionJobCreated.ts), a Gemini-JSON-response pattern for structured output (geminiTagScript.ts's `responseMimeType: 'application/json'` prompt technique), and a per-feature admin toggle+model-select system (GeminiFeatures in settings.ts) to gate cost/rollout. This turns raw audio into an evaluation-relevant metric that directly supports Danielson Domain 3 (Instruction) evidence, which is exactly this app's purpose.

**Implementation.** Add a third GeminiFeature entry (`talkTimeAnalysis`) to `geminiFeatures` in packages/shared/src/schema/settings.ts (mirrors `audioTranscription`/`scriptAutoTag`, lines 108-132), with its own admin enable/model toggle in apps/web/src/admin/settings/SettingsPage.tsx (mirrors the existing two feature rows around line 61-68). Add a new Cloud Function (e.g. apps/functions/src/transcription/analyzeTalkTime.ts, or fold into `onTranscriptionJobCreated.ts` as an optional follow-up step) that, once transcription succeeds, either re-uses the transcript text with a prompt asking Gemini to estimate speaker-turn proportions (cheaper — text-only) or re-references the already-uploaded `geminiFileUri` for an audio-based estimate before it's deleted in the `finally` block (more accurate but requires reordering that cleanup). Store the result as `talkTime: { teacherPct: number, studentPct: number, source: 'text'|'audio' } | null` on the observation doc's transcripts map or a sibling field (extend the Observation schema similarly to how `transcripts` is keyed by audioFileId). Surface it as a small stat badge in apps/web/src/observations/AudioRecorder.tsx next to the transcript. Flag explicitly as an estimate, not a precise measurement, in the UI copy given the LLM-inference nature of the analysis.

**Files.** `packages/shared/src/schema/settings.ts`, `packages/shared/src/schema/observation.ts`, `apps/functions/src/transcription/onTranscriptionJobCreated.ts`, `apps/web/src/admin/settings/SettingsPage.tsx`, `apps/web/src/observations/AudioRecorder.tsx`

**Depends on.** New Gemini API cost per transcription (bounded by the existing per-feature enable toggle and maxInstances caps already used elsewhere); needs product buy-in on accuracy expectations before promoting beyond an opt-in admin-enabled feature, since it's inherently an LLM estimate, not ground truth.

---

<a id="admin"></a>

## Admin console

### ADMIN-01 — Active/Inactive status filter for Roles and Buildings pages

> ✅ **Shipped 2026-07-25** — PR #70. Went beyond the brief: the filter chip and predicate were extracted into `apps/web/src/admin/_shared/` and `StaffPage` now consumes them, so all three admin pages share one idiom.

**tweak** · value: **medium**

Add a status filter (All / Active / Inactive) to the Roles and Buildings admin list pages, matching the filter that already exists on the Staff page. Right now the only way to see which roles/buildings are deactivated is to scan the whole table for an 'Inactive' badge, which gets tedious as the list grows through the pre-cutover cleanup pass.

**Why this fits.** Cheap, uses an existing UI pattern already proven on StaffPage, and directly supports the admin's pre-cutover task of finding and deciding what to do with deactivated roles/buildings.

**Implementation.** apps/web/src/admin/roles/RolesPage.tsx and apps/web/src/admin/buildings/BuildingsPage.tsx both already filter client-side (`filtered = useMemo(...)` in RolesPage) with only a text search. Add a status radio/segmented control next to AdminSearchInput (mirror StaffFilterBar's status field in apps/web/src/admin/staff/StaffFilterBar.tsx) and extend the `filtered` predicate with `r.isActive` checks, same shape as StaffPage.tsx's `filters.status === 'active' | 'archived'` branch. No schema change — `role.isActive` / `building.isActive` already exist in packages/shared/src/schema/role.ts and building.ts.

**Files.** `apps/web/src/admin/roles/RolesPage.tsx`, `apps/web/src/admin/buildings/BuildingsPage.tsx`, `apps/web/src/admin/staff/StaffFilterBar.tsx`

### ADMIN-02 — "Last updated" sortable column on Roles, Buildings, Modules, Rubrics tables

**tweak** · value: **low**

Add a sortable 'Last updated' column (relative or absolute date) to the RolesPage, BuildingsPage, ModulesPage, and RubricsListPage tables, so an admin doing pre-cutover review can immediately spot stale configuration that hasn't been touched in months versus recently-edited entries.

**Why this fits.** Every relevant schema (role.ts, building.ts, module.ts, rubric.ts) already stamps `updatedAt: isoDate` on every write — this is a pure display/sort addition with zero backend work, following the exact ColumnDef pattern AuditLogPage.tsx already uses for its timestamp column.

**Implementation.** Add a ColumnDef&lt;T> entry `{ key: 'updatedAt', header: 'Last updated', sortAccessor: (r) => r.updatedAt instanceof Date ? r.updatedAt.getTime() : 0, cell: (r) => formatTimestamp(r.updatedAt) }` to each page's `columns` array (see RolesPage.tsx's existing columns list for the pattern). Reuse or extract the `formatTimestamp`/`toDate` Timestamp-vs-Date coercion helper already duplicated in AuditLogPage.tsx and TranscriptionJobsPage.tsx into a shared util (e.g. apps/web/src/admin/\_shared/formatTimestamp.ts) rather than adding a fourth copy — note raw Firestore reads bypass Zod defaults so guard with `instanceof Date` before calling `.toDate()`.

**Files.** `apps/web/src/admin/roles/RolesPage.tsx`, `apps/web/src/admin/buildings/BuildingsPage.tsx`, `apps/web/src/admin/modules/ModulesPage.tsx`, `apps/web/src/admin/rubrics/RubricsListPage.tsx`, `apps/web/src/admin/audit-log/AuditLogPage.tsx`

### ADMIN-03 — URL-synced admin filters + Audit Log deep links

**small** · value: **medium**

Sync the Staff page's filter/search state (role, year, building, status, search text) to the URL query string so filtered views are bookmarkable and shareable, then make the Audit Log's user/target cells clickable links that jump straight into a matching filtered Staff view (e.g. clicking a staff email in an audit entry opens /admin/staff?search=that-email).

**Why this fits.** AuditLogPage.tsx already renders raw email strings and free-form `target` refs (e.g. `staff/user@orono.k12.mn.us`) with no way to act on them; wiring them into StaffPage's existing filter state turns the audit log from a read-only ledger into an investigation tool a solo admin can actually use day-to-day.

**Implementation.** In apps/web/src/admin/staff/StaffPage.tsx, replace the local `useState<StaffFilters>` with a thin wrapper around react-router's `useSearchParams` (StaffFilters shape is defined in StaffFilterBar.tsx) so filters round-trip through the URL. In AuditLogPage.tsx, wrap the `e.userEmail` cell and any `target` value matching the `staff/` prefix (`e.target.startsWith('staff/')`) in a `<Link to={`/admin/staff?search=${encodeURIComponent(email)}`}>`. Keep the parsing tolerant (missing/garbage query params should fall back to EMPTY_FILTERS, not throw).

**Files.** `apps/web/src/admin/staff/StaffPage.tsx`, `apps/web/src/admin/staff/StaffFilterBar.tsx`, `apps/web/src/admin/audit-log/AuditLogPage.tsx`

### ADMIN-04 — Scheduled + severity-leveled global banner

**small** · value: **medium**

Extend the global announcement banner (Admin → Settings) with an optional start/end date and a severity level (info / warning / critical), so an admin can schedule a cutover-window notice in advance and have it auto-appear and auto-clear, styled by urgency, instead of manually toggling the text field on the day of.

**Why this fits.** The banner is explicitly built for exactly this use case ('cutover windows, planned downtime, deadlines' per its own doc comment) but today requires an admin to remember to type and then clear it manually — a real risk during the Aug/Sept 2026 GAS cutover this app is built around.

**Implementation.** Extend `appSettings` in packages/shared/src/schema/settings.ts with `globalBannerSeverity: z.enum(['info','warning','critical']).default('info')`, `globalBannerStartDate: localDate.nullable().default(null)`, `globalBannerEndDate: localDate.nullable().default(null)` (reuse the `localDate` YYYY-MM-DD helper already exported from packages/shared/src/schema/buildingSchedule.ts). Add a pure `isBannerActive(settings: AppSettings, today: string): boolean` helper alongside the schema so both the web banner and any future check share the same date logic. Update apps/web/src/components/GlobalBanner.tsx to call it and vary the container's Tailwind classes by severity (info keeps today's `bg-ops-blue-lighter`, warning/critical get amber/red equivalents — check DESIGN.md for the on-brand alert palette). Add the three new fields to the Settings form in apps/web/src/admin/settings/SettingsPage.tsx next to the existing `globalBannerText` input.

**Alternate approach (proposed independently by the platform team).** Replace the `globalBannerText: z.string()` field in packages/shared/src/schema/settings.ts with a `globalBanner: z.object({ text: z.string().trim().max(280).default(''), severity: z.enum(['info','warning','critical']).default('info'), expiresAt: isoDate.nullable().default(null) })` (or keep `globalBannerText` for backward compat and add two new sibling fields to avoid a data migration — simpler given raw Firestore reads bypass Zod defaults on old docs). Update apps/web/src/components/GlobalBanner.tsx to pick a background/text color per severity (reuse the ops-red/ops-blue Tailwind tokens already used elsewhere in the file) and to hide the banner client-side once `Date.now() > expiresAt`. Update the 'Global banner text' Field block in apps/web/src/admin/settings/SettingsPage.tsx to add a severity `<select>` and a datetime `<Input type="datetime-local">`.

**Files.** `packages/shared/src/schema/settings.ts`, `packages/shared/src/schema/buildingSchedule.ts`, `apps/web/src/components/GlobalBanner.tsx`, `apps/web/src/admin/settings/SettingsPage.tsx`

### ADMIN-05 — Rollover concurrency lock

**small** · value: **medium**

Prevent two admins (or one admin in two tabs) from starting the annual staff-cycle rollover at the same time, which today can produce confusing partial results because the callable's optimistic per-doc `fromYear` check silently skips rows that changed out from under a stale preview.

**Why this fits.** Closes a named gap ('no lock/lease mechanism for preventing concurrent rollover attempts') with a small, self-contained addition that doesn't touch the existing chunked-batch-write logic at all — it just gates entry to it.

**Implementation.** Add a lock sub-field to appSettings, e.g. `rolloverLock: z.object({ lockedBy: email, lockedAt: isoDate }).nullable().default(null)` in packages/shared/src/schema/settings.ts. In apps/functions/src/scripts/applyStaffRollover.ts, before the existing re-read/apply logic, run a Firestore transaction that reads `/appSettings/global`, throws `HttpsError('failed-precondition', ...)` if `rolloverLock` is set and less than e.g. 10 minutes old (stale-lock auto-expiry so a crashed tab can't wedge the feature forever), otherwise sets the lock; on completion (success or the final catch), clear it in a `finally`. In apps/web/src/admin/staff/RolloverDialog.tsx, surface a disabled state with 'Rollover in progress, started by X at Y' when `appSettings.rolloverLock` is set (read via the existing `useFirestoreDoc<AppSettings>` pattern already used in StaffPage.tsx).

**Files.** `packages/shared/src/schema/settings.ts`, `apps/functions/src/scripts/applyStaffRollover.ts`, `apps/web/src/admin/staff/RolloverDialog.tsx`

### ADMIN-08 — Rubric JSON export/import for backup and cross-environment portability

**small** · value: **medium**

Add 'Export JSON' and 'Import JSON' buttons to the rubric editor so an admin can download a full rubric (domains, components, proficiency descriptors, look-fors, colors) as a file, and later re-upload it — either as a point-in-time backup before a risky edit, or to move a rubric into a fresh Firebase project (e.g. a staging environment, or a district split) without hand re-entry.

**Why this fits.** Rubrics have no version history and no backup path today beyond Firestore's own backups (which a solo admin can't self-serve restore from); 'duplicate rubric' exists but only within the same project. This gives a lightweight, dependency-free safety net using data that's already fully client-visible.

**Implementation.** In apps/web/src/admin/rubrics/RubricEditorPage.tsx (and/or RubricsListPage.tsx for a list-level bulk export), add an 'Export JSON' button that does `JSON.stringify(rubric, null, 2)` and triggers a download via the same `downloadTextFile` helper already used for CSV exports in apps/web/src/admin/staff/staffCsv.ts and AuditLogPage.tsx (generalize it to accept any mime type — it already takes one). For import, add a file-picker dialog that reads the JSON, runs it through `rubricInput.safeParse` (packages/shared/src/schema/rubric.ts) before touching Firestore, shows validation errors inline (mirror the StaffImportDialog.tsx pattern of showing per-row errors before commit), and on confirm writes via `setDoc(doc(db, COLLECTIONS.rubrics, parsed.data.rubricId), {...parsed.data, updatedAt: serverTimestamp()}, {merge:false})`. Warn clearly before overwrite if a rubric with that `rubricId` already exists — this is a destructive write, not a merge.

**Files.** `apps/web/src/admin/rubrics/RubricEditorPage.tsx`, `apps/web/src/admin/rubrics/RubricsListPage.tsx`, `packages/shared/src/schema/rubric.ts`, `apps/web/src/admin/staff/staffCsv.ts`, `apps/web/src/admin/staff/StaffImportDialog.tsx`

### ADMIN-06 — Live period preview for period-picker signup fields

**medium** · value: **medium**

When an admin creates or edits a signup field of type 'period-picker' on the Signup Fields page, let them pick a sample building and see the actual list of periods (from that building's real bell schedule) that staff would be shown when filling out that field — instead of publishing it blind and discovering at fill-time that a building has no periods configured.

**Why this fits.** Closes a named gap: period-picker fields resolve periods from `/buildingSchedules` at \*fill\* time, with zero admin-time preview, so a misconfigured or schedule-less building silently produces an empty/broken picker for real staff filling out signup.

**Implementation.** packages/shared/src/schema/signupField.ts defines `signupField.type === 'period-picker'` with no per-field building reference (it resolves against whichever building the \*filler\* is in, at fill time). Add a preview-only affordance in apps/web/src/admin/signup-fields/SignupFieldsPage.tsx's edit dialog: a building `<select>` (sourced from `useFirestoreCollection<Building>(COLLECTIONS.buildings, [where('isActive','==',true)])`, same pattern as StaffPage.tsx) that, once chosen, fetches that building's `/buildingSchedules/{buildingId}` doc via `useFirestoreDoc<BuildingSchedule>` and renders the periods from its currently-active day type (weeklyPattern → dayTypes[].periods, per packages/shared/src/schema/buildingSchedule.ts) as a read-only list ('Monday shows: Period 1, Period 2, …'). This is preview-only — it doesn't change the signupField doc's persisted shape at all, just gives the admin visibility before publishing.

**Files.** `apps/web/src/admin/signup-fields/SignupFieldsPage.tsx`, `packages/shared/src/schema/signupField.ts`, `packages/shared/src/schema/buildingSchedule.ts`, `apps/web/src/admin/buildings/BuildingSchedulePage.tsx`

### ADMIN-07 — Admin-configurable email trigger → preference-category mapping

**medium** · value: **medium**

Let an admin reassign which of the four opt-out categories (observation notices / reminders / scheduling updates / manual messages) a given non-critical email trigger falls under, from the Email Templates admin page, instead of that mapping being fixed in code.

**Why this fits.** Closes a named gap: EMAIL_TRIGGER_CATEGORY is hardcoded in packages/shared/src/schema/emailTemplate.ts, so an admin who wants (say) 'window invite' emails treated as 'reminders' instead of 'scheduling updates' currently needs a code change and redeploy — for a solo-developer district app, admin-configurability here removes a whole class of 'please change this for me' requests.

**Implementation.** Add an override field to appSettings in packages/shared/src/schema/settings.ts, e.g. `emailCategoryOverrides: z.record(z.enum(EMAIL_TRIGGER_TYPES), z.enum(EMAIL_PREFERENCE_CATEGORIES)).default({})` — scope it to only remap \*already-non-critical\* triggers (don't allow toggling `isCriticalEmailTrigger` triggers out of always-send; keep that hardcoded in emailTemplate.ts as a genuine safety rail for booking confirmations etc). In apps/functions/src/lib/emailUtils.ts, both `isEmailSuppressed` (line ~96) and `sendEmail` (line ~163) read `EMAIL_TRIGGER_CATEGORY[triggerType]` directly — change both call sites to first load `/appSettings/global`.emailCategoryOverrides and prefer `overrides[triggerType] ?? EMAIL_TRIGGER_CATEGORY[triggerType]`. Add a small category `<select>` next to each trigger's row in apps/web/src/admin/email-templates/EmailTemplatesPage.tsx (only rendered for triggers not in CRITICAL_EMAIL_TRIGGER_TYPES) that writes to the new appSettings field via the same `setDoc(..., {merge:true})` pattern SettingsPage.tsx uses.

**Files.** `packages/shared/src/schema/emailTemplate.ts`, `packages/shared/src/schema/settings.ts`, `apps/functions/src/lib/emailUtils.ts`, `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx`

### ADMIN-09 — Legacy building-name resolver for staff records

**medium** · value: **medium**

A dedicated cleanup screen that finds every distinct free-text string in staff `buildings[]` arrays that doesn't match any real building's `buildingId`/`displayName` (shown today as an '(unmapped)' tag with no fix path), lets the admin map each one to a real building in one place, and bulk-rewrites every affected staff doc in one action.

**Why this fits.** Named gap: legacy pre-slugified building references show as '(unmapped)' with no batch-fix UI, forcing an admin to open each affected staff member individually. Getting this clean before the district-wide Aug/Sept 2026 cutover matters because building assignment feeds scheduling/slot logic.

**Implementation.** Add a page (e.g. apps/web/src/admin/buildings/BuildingResolverPage.tsx, linked from BuildingsPage.tsx) that loads `useFirestoreCollection<Staff>(COLLECTIONS.staff)` and `useFirestoreCollection<Building>(COLLECTIONS.buildings)`, computes the set of active-buildings' `buildingId`s and `displayName`s, and for every staff doc's `buildings` array entries not matching either, groups by raw string → list of affected staff emails (mirrors the '(unmapped)' tag logic already implemented somewhere in StaffInlineEditors.tsx's BuildingsPill — check that file for the exact match rule before duplicating it, and factor it into a shared helper both consume). For each raw string, offer a `<select>` of real buildings (or 'discard'); on confirm, run a `writeBatch` (WRITE_BATCH-chunked like applyStaffRollover.ts's 400-per-batch pattern) that replaces the raw string with the resolved `buildingId` in each affected staff doc's `buildings` array and bumps `updatedAt`. Write an audit log entry summarizing the remap (new AUDIT_ACTIONS entry, e.g. `buildingsRemapped`, added to packages/shared/src/schema/auditLog.ts) so the change is traceable.

**Files.** `apps/web/src/admin/staff/StaffInlineEditors.tsx`, `apps/web/src/admin/buildings/BuildingsPage.tsx`, `packages/shared/src/schema/staff.ts`, `packages/shared/src/schema/auditLog.ts`, `apps/functions/src/scripts/applyStaffRollover.ts`

### ADMIN-10 — Inactive-staff purge tool with reference-safety checks

**medium** · value: **medium**

A 'Data cleanup' panel on the Staff page that lists staff deactivated for longer than a configurable threshold (e.g. 2+ academic years), checks each for any referencing observations/bookings, and — only for staff with zero references — offers a genuine hard-delete, distinct from the existing soft 'archive' toggle.

**Why this fits.** Named gap: soft-deleted staff have no recovery/purge UI at all; StaffPage's RowActions only offers Archive/Restore (confirmed in code), never a real delete. A long-running single-district app will otherwise accumulate archived staff forever with no cleanup path, and an unsafe blanket 'delete' would be dangerous given observations reference staff by email — hence the reference check being the core of this feature, not an afterthought.

**Implementation.** New admin-only callable in apps/functions/src (e.g. apps/functions/src/staff/purgeInactiveStaff.ts, mirroring the auth/audit pattern in apps/functions/src/scripts/applyStaffRollover.ts): given a list of staff emails, for each one query `observations` (as observer and as observed — check packages/shared/src/schema/observation.ts for the actual field names), `observationSlot`, and `observationWindow` collections for any reference; only staff with zero hits in all three are eligible, everyone else is reported back as 'blocked, has N references' rather than silently skipped. Gate with the same live-staff-doc admin check pattern used in applyStaffRollover.ts (`isAdminRole` / `hasAdminAccess`), write an audit entry per purge run. On the client, add a collapsible 'Data cleanup' section to StaffPage.tsx (only visible to admins) listing `isActive === false` staff sorted by `updatedAt`, with a per-row eligibility badge and a confirm-to-purge dialog reusing the destructive-confirmation pattern already in RolesPage.tsx's `confirmingDelete` state.

**Files.** `apps/web/src/admin/staff/StaffPage.tsx`, `apps/functions/src/scripts/applyStaffRollover.ts`, `packages/shared/src/schema/staff.ts`, `packages/shared/src/schema/observation.ts`, `packages/shared/src/schema/auditLog.ts`

### ADMIN-11 — Compound module auto-enable rules

**large** · value: **medium**

Replace the module `autoEnable` rule's single-criterion limitation (one cycle status OR one display year, never both, never multiple values, never negation) with a small rule set that supports AND/OR combinations and exclusions — e.g. 'all Year 1 and Year 2 staff except those in the Mentor module' or 'summative-cycle staff in Year 2 or Year 3.'

**Why this fits.** Named gap, explicit in the module.ts source comment ('never both, never multiple values'). Real districts have module-assignment rules that don't fit a single dimension — this is the kind of thing that will get requested repeatedly as more modules are configured pre-cutover.

**Implementation.** packages/shared/src/schema/module.ts's `autoEnable` is a `z.discriminatedUnion('dimension', [...])` with a single value each for 'status'/'year', consumed by the pure helper `staffMatchesAutoEnable(staff, rule)` at the bottom of that file. Extend it to a rule tree, e.g. `autoEnableRule = z.union([autoEnableCriterion, z.object({op: z.enum(['and','or']), rules: z.array(z.lazy(() => autoEnableRule)).min(1).max(5)}), z.object({op: z.literal('not'), rule: z.lazy(() => autoEnableRule)})])`, keeping the old single-criterion shape as a leaf so `moduleDoc.autoEnable` stays backward-compatible for existing docs (old docs parse as a leaf node, same runtime behavior). Rewrite `staffMatchesAutoEnable` to recursively evaluate the tree. CRITICAL: the code comment explicitly says 'Mirrors the inline cycle math in firestore.rules — keep the two in sync (rules tests guard the rules side)' — firestore.rules is in the owner-protected file set, so this idea needs explicit owner sign-off and a security-rules-side implementation of the same rule tree before it can ship; flag that clearly rather than treating the rules change as routine. Update the admin UI in ModulesPage.tsx/ModuleBuilderPage.tsx to a small rule builder (a list of AND-ed criterion rows to start, with OR/NOT as a stretch) rather than the current single dropdown.

**Files.** `packages/shared/src/schema/module.ts`, `apps/web/src/admin/modules/ModulesPage.tsx`, `apps/web/src/admin/modules/ModuleBuilderPage.tsx`, `firestore.rules`

**Depends on.** REQUIRES OWNER SIGN-OFF — firestore.rules is owner-protected and this feature explicitly requires updating the mirrored rule-matching logic there, plus the rules-tests suite under tests/.

### ADMIN-12 — Admin command palette (cross-entity Cmd+K search)

**large** · value: **high**

A keyboard-triggered (Cmd/Ctrl+K) fuzzy search overlay, available anywhere in the admin console, that jumps directly to a staff member, role, building, module, or rubric by name — replacing 'click through the sidebar to the right list page, then scroll/search there' with a single keystroke and a few characters typed.

**Why this fits.** The admin console has 15 pages across 5 sections (per ADMIN_NAV_SECTIONS in adminNav.ts) and several of those pages (Staff especially) hold hundreds of rows; at district scale (a few hundred staff) all the underlying collections are small enough to fetch and fuzzy-match entirely client-side with zero new infrastructure — this is a solo-developer-friendly power feature, not a search-backend project.

**Implementation.** New component, e.g. apps/web/src/admin/\_shared/CommandPalette.tsx, mounted once in apps/web/src/admin/AdminLayout.tsx with a `keydown` listener for Cmd/Ctrl+K (check for an existing shadcn `Command` primitive under apps/web/src/components/ui first — if not present, `pnpm dlx shadcn add command` per the shadcn skill/conventions, cmdk-based). On open, fetch (or reuse already-cached) `useFirestoreCollection` results for staff/roles/buildings/modules/rubrics (all already loaded on their respective pages via the same hooks — for the palette, a lightweight always-on top-level fetch of just id+displayName+email fields is enough, not full docs) and fuzzy-match against typed text (simple substring/Levenshtein is plenty at this data volume — no client library needed). Selecting a result calls `navigate()` to the matching admin route from ADMIN_NAV, ideally pre-filling that page's URL-synced filter/search (see the 'URL-synced admin filters' idea above) so it lands directly on the matched row, not just the list page.

**Files.** `apps/web/src/admin/AdminLayout.tsx`, `apps/web/src/admin/adminNav.ts`, `apps/web/src/hooks/useFirestoreCollection.ts`, `apps/web/src/admin/_shared`

**Depends on.** May need `pnpm dlx shadcn add command` (cmdk) if the Command primitive isn't already vendored under apps/web/src/components/ui — check there first per repo convention.

**See also.** `STAFF-11`

### ADMIN-13 — Weekly "What Changed" admin digest email

**large** · value: **medium**

A scheduled weekly email to the security admin (and optionally other opted-in admins) summarizing the past week's audit log activity — staff added/deactivated, role/year mapping changes, rollover runs, and any email delivery failures — so a solo admin doesn't have to remember to open the Audit Log page proactively to catch problems.

**Why this fits.** This composes entirely out of infrastructure that already exists and is proven: the audit log (packages/shared/src/schema/auditLog.ts), the onSchedule Cloud Function pattern (already used for apps/functions/src/audit/pruneAuditLog.ts, apps/functions/src/email/scheduledEmailReminders.ts, apps/functions/src/drive/monitorDriveQuota.ts), and the full email pipeline (sendEmail → renderEmailShell → /mail doc). No new third-party service, no new data model beyond a settings toggle.

**Implementation.** New scheduled function apps/functions/src/audit/weeklyAdminDigest.ts using `onSchedule` (weekly cron, e.g. Monday 6am America/Chicago, same region/pattern as pruneAuditLog.ts), querying `/auditLog` for the past 7 days grouped by action type (reuse AUDIT_ACTIONS from packages/shared/src/schema/auditLog.ts), building an HTML summary, and calling the existing `sendEmail`/`sendTemplatedEmail` helpers from apps/functions/src/lib/emailUtils.ts to send it to `appSettings.securityAdminEmail` (already a field per packages/shared/src/schema/settings.ts). Add a new `EmailTriggerType` value (e.g. `'admin.weeklyDigest'`) to packages/shared/src/schema/emailTemplate.ts so the digest's HTML body is itself an editable, admin-configurable template like every other trigger (surfacing it in apps/web/src/admin/email-templates/EmailTemplatesPage.tsx's TRIGGER_LABELS/TRIGGER_VARIABLES maps), and a boolean `weeklyDigestEnabled` toggle in appSettings (SettingsPage.tsx) so an admin can turn it off. Keep the function read-only against auditLog — it must never write there itself except its own eventual audit trail for 'digest sent'.

**Files.** `apps/functions/src/audit/pruneAuditLog.ts`, `apps/functions/src/lib/emailUtils.ts`, `packages/shared/src/schema/auditLog.ts`, `packages/shared/src/schema/emailTemplate.ts`, `packages/shared/src/schema/settings.ts`, `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx`, `apps/web/src/admin/settings/SettingsPage.tsx`

**Depends on.** New Cloud Function deploy (routine, not owner-protected) — firebase.json/deploy workflows don't need changes since function deploys are picked up automatically by the existing functions build.

---

<a id="staff"></a>

## Staff experience

### STAFF-01 — App-wide offline indicator

> ✅ **Shipped 2026-07-25** — PR #68. The strip is now the single source of truth for offline messaging; `GlobalToolsBar` was changed to show only save/retry state so the editor no longer shows two contradictory notices.

**tweak** · value: **medium**

Surface a small persistent "You're offline — changes may not save" strip whenever the browser loses connectivity, on every authenticated page (dashboard, directory, profile, modules), not just the observation editor. Teachers on flaky building Wi-Fi or an iPad that drops network get an honest signal instead of a page that silently stops updating.

**Why this fits.** The connectivity hook already exists and is proven in production (ObservationEditorPage) but is invisible everywhere else in the staff experience, so a teacher browsing their dashboard or directory offline gets stale Firestore snapshots with no cue.

**Implementation.** Reuse `useOnlineStatus` from apps/web/src/hooks/useOnlineStatus.ts (currently only imported by apps/web/src/observations/ObservationEditorPage.tsx and referenced in apps/web/src/observations/GlobalToolsBar.tsx). Add a small banner component modeled on apps/web/src/components/GlobalBanner.tsx (same `role="status" aria-live="polite"` pattern) and mount it in apps/web/src/components/Layout.tsx directly below `<GlobalBanner />` so it appears under the AppHeader on every route. Keep it dismissible-free like GlobalBanner (state changes on its own once `online` fires). No schema or backend change.

**Files.** `apps/web/src/hooks/useOnlineStatus.ts`, `apps/web/src/components/Layout.tsx`, `apps/web/src/components/GlobalBanner.tsx`

### STAFF-02 — Copy-email quick action in Staff Directory and Staff Person page

**tweak** · value: **low**

Add a small copy-to-clipboard icon button next to each staff member's email in the Staff Directory (list and card views) and on the Staff Person header, so peer evaluators/admins can grab an address without opening a mail client.

**Why this fits.** StaffDirectoryPage and StaffPersonPage already show/link email addresses; a one-click copy is a near-zero-cost convenience for the peer evaluators and admins who use this directory daily to email colleagues.

**Implementation.** Add a small `navigator.clipboard.writeText(s.email)` button (lucide `Copy`/`Check` icon swap on click, `sonner` toast already used elsewhere e.g. apps/web/src/routes/MyObservationsPage.tsx for the success/failure pattern) next to the email text in apps/web/src/routes/StaffDirectoryPage.tsx (list rows around line 232, card rows don't currently show email — could add it there too) and apps/web/src/routes/StaffPersonPage.tsx header. Purely client-side, no backend change.

**Files.** `apps/web/src/routes/StaffDirectoryPage.tsx`, `apps/web/src/routes/StaffPersonPage.tsx`

### STAFF-03 — "New" badge on recently-added modules

**tweak** · value: **low**

Show a small "New" pill next to a module's sidebar entry and on its ModulePage header when the module was created within the last 14 days and the staff member hasn't opened it yet, so newly rolled-out PD tracks (e.g. a new Mentor module) actually get noticed instead of silently appearing in the nav.

**Why this fits.** `ModuleDoc.createdAt` already exists (packages/shared/src/schema/module.ts line 100) and modules already surface as sidebar nav items (AppSidebar.tsx `moduleNavItems`), but there's no visual signal that something changed — staff have to notice a new sidebar row on their own.

**Implementation.** Compute `isNew = (Date.now() - createdAtMs) < 14 * 86400_000` in apps/web/src/components/AppSidebar.tsx's `moduleNavItems` useMemo (around line 282-298) and in apps/web/src/modules/ModulePage.tsx, using the module's `createdAt` (already loaded via `useFirestoreCollection<ModuleDoc>`). "Not yet opened" can piggyback on the existing `moduleProgress` subcollection presence (any progress doc for that moduleId means it's been engaged) rather than adding new state. Render as a small pill matching the existing chip styling (`dash-hero__chip` class family in dashboard.css, or a simple Tailwind badge). No schema change needed.

**Files.** `apps/web/src/components/AppSidebar.tsx`, `apps/web/src/modules/ModulePage.tsx`, `packages/shared/src/schema/module.ts`

### STAFF-04 — "Add to Calendar" (.ics) download for pre-obs/post-obs meetings and the observation itself

> ✅ **Shipped 2026-07-25** — PR #67. Reusable builder at `apps/web/src/lib/ics.ts`; `SCHED-07` should consume it. Calendar eligibility is keyed on the step's date **source**, not its chip style — deadline-type dates (`windowEndDate`, `createdAt`) correctly produce no event. Timed VEVENTs only for real booked slots.

**small** · value: **high**

On each dashboard checkpoint card that represents a dated meeting (pre-observation conversation, the classroom observation, post-observation conversation), add a small "Add to calendar" link that downloads a standards-based .ics file for that event — no Google OAuth required. This covers staff who never connect Google Calendar (the existing ProfilePage integration is opt-in) and gives observers/observed a reliable non-Google fallback (works with Outlook, Apple Calendar, etc.).

**Why this fits.** The dashboard already computes a real `Date` for every meeting-type checkpoint (via `DATE_SOURCE_FN` in dashboardEvents.ts) but currently only exposes it as a formatted label string, and Google Calendar sync is opt-in per ProfilePage's CalendarIntegrationSection — many staff won't connect it. A client-only .ics download needs zero backend/OAuth and works for everyone immediately.

**Implementation.** `CheckpointWithStatus` (apps/web/src/dashboard/deriveCheckpoints.ts) currently only stores formatted `dateLabel`/`monthLabel` strings, not the raw `Date` — add a `rawDate: Date | null` field, populated from the existing `stepDate` local variable around line 168-197 of deriveCheckpoints.ts. Write a small ICS builder (e.g. apps/web/src/lib/ics.ts) producing a minimal VEVENT with DTSTART/DTEND/SUMMARY/DESCRIPTION, generate a `Blob` with `type: 'text/calendar'`, and trigger download via an `<a download>` with `URL.createObjectURL`. Surface the link in `TaskRow` (apps/web/src/dashboard/DashboardView.tsx, around the CTA button block ~line 590-618) only for `task.type === 'meeting' || task.type === 'observation'` and only when `rawDate` is set. No Firestore/schema change; purely additive to the existing derive/render pipeline.

**Files.** `apps/web/src/dashboard/deriveCheckpoints.ts`, `apps/web/src/dashboard/dashboardEvents.ts`, `apps/web/src/dashboard/DashboardView.tsx`

**See also.** `SCHED-07`

### STAFF-05 — Staff Directory: building filter + sortable columns

**small** · value: **medium**

Add a "Building" filter dropdown next to the existing role filter on the Staff Directory, and let peer evaluators/admins click the Name/Role/Building column headers (list view) to re-sort, instead of the current fixed alphabetical-by-name order. Useful for a peer evaluator who covers one building and wants to see just their roster, or an admin scanning by role within a building.

**Why this fits.** `Staff.buildings` is already a first-class array field used throughout (badges shown per row) but StaffDirectoryPage only filters on role/search/active — building, the dimension peer evaluators most often care about, has no filter today.

**Implementation.** In apps/web/src/routes/StaffDirectoryPage.tsx, add a `buildingFilter` state and a `distinctBuildings` memo mirroring the existing `distinctRoles` memo (lines 44-53), built from the union of all `s.buildings` values across loaded staff. Extend the `filtered` memo's predicate (lines 55-65) with a building check. For sorting, replace the fixed `STAFF_CONSTRAINTS = [orderBy('name', 'asc')]` with a small client-side sort state (`sortKey: 'name' | 'role' | 'building'`) applied after filtering, since building isn't a single scalar Firestore can orderBy cleanly (staff can have multiple buildings). Persist choices to sessionStorage the same way `VIEW_MODE_KEY` is already persisted (lines 27-38) if desired.

**Files.** `apps/web/src/routes/StaffDirectoryPage.tsx`

### STAFF-06 — PWA manifest + "Add to Home Screen" for iPad

**small** · value: **medium**

Add a web app manifest and Apple touch-icon meta tags so teachers and peer evaluators can add Peer Observations to their iPad home screen as a standalone, full-screen app icon — no App Store submission, just standard PWA metadata using assets already in the repo.

**Why this fits.** iPad Safari is already called out as a first-class target (dedicated Playwright viewport, an open WebKit investigation in TODO.md) but there's no `manifest.json`, no `apple-touch-icon`, and no service worker registration anywhere under apps/web/public — the app can't be pinned to a home screen today, which is a meaningful friction point for observers carrying an iPad between classrooms.

**Implementation.** Add `apps/web/public/manifest.json` (name, short_name, icons referencing the existing `apps/web/public/brand/` assets, `display: "standalone"`, theme_color from the district brand color already applied at runtime by apps/web/src/components/BrandingProvider.tsx — hardcode the default OPS blue as a static fallback since manifest theme_color can't be dynamic). Add `<link rel="manifest">`, `<link rel="apple-touch-icon">`, and `<meta name="apple-mobile-web-app-capable" content="yes">` to apps/web/index.html. This is metadata-only — no service worker, no offline caching, keeps scope small and avoids interfering with Firestore's own offline/online behavior.

**Files.** `apps/web/index.html`, `apps/web/public/brand`, `apps/web/src/components/BrandingProvider.tsx`

### STAFF-12 — Export "My Observations" as CSV

**small** · value: **low**

Add an "Export CSV" button to the My Observations table (and/or the Profile page's finalized-observations archive) that downloads a spreadsheet of date, observation name, observer, type, and acknowledgment status — useful for a teacher building a portfolio, or an evaluator being asked to compile a paper trail outside the app.

**Why this fits.** MyObservationsPage.tsx already renders exactly this tabular data client-side (date/name/observer/type/PDF/acknowledged) from a query the staff member already has read access to; turning it into a downloadable CSV is a small, self-contained client-side transform with no new data access.

**Implementation.** In apps/web/src/routes/MyObservationsPage.tsx, add a button in the `PageHeader`'s `actions` (or `belowBar`) slot that maps the already-loaded `observations` array to CSV rows (Date via the existing `formatDate` helper, `observationName`, `observerName`/`observerEmail` fallback, `type`, `acknowledgedAt` presence) and triggers a `Blob`/`URL.createObjectURL` download, same technique as the .ics idea above. No backend involvement — this mirrors what `pnpm export:emulator`/`export:prod` already do server-side for admins, just as a lightweight client-side self-service version scoped to one person's own records.

**Files.** `apps/web/src/routes/MyObservationsPage.tsx`

**See also.** `OBS-06`, `XCUT-08`

### STAFF-07 — "My Modules" overview page

**medium** · value: **medium**

A new route (e.g. /modules) listing every PD module a staff member is assigned (explicit assignment or auto-enable match), each as a card with its color, icon, and a progress bar/percentage — the same completion math ModulePage already computes per-module, just rolled up into one consolidated view. Currently the only way to see "all my modules" is scanning the sidebar one entry at a time; there's no single place showing overall PD progress across tracks.

**Why this fits.** All the underlying data and math already exist per-module (ModulePage's `totalMaterials`/`doneMaterials`, AppSidebar's `moduleNavItems` assignment resolution via `staffMatchesAutoEnable`) but are never aggregated, so a staff member in three modules (e.g. Mentor + ILT + a building initiative) has no consolidated progress view, and admins can't point staff to one landing page for "all your PD."

**Implementation.** New route file (e.g. apps/web/src/modules/MyModulesPage.tsx), registered lazily in apps/web/src/lazyRoutes.ts and apps/web/src/App.tsx alongside the existing `/m/:moduleId` route. Reuse the assignment-resolution logic already duplicated between apps/web/src/dashboard/StaffDashboardPage.tsx (`assignedModuleIds` memo, lines 102-110) and apps/web/src/components/AppSidebar.tsx (`moduleNavItems` memo, lines 282-298) — consider extracting a shared `resolveAssignedModules(staff, modules)` helper into apps/web/src/modules/ (or packages/shared) rather than a third copy. For each assigned module, query its `items` subcollection (MODULE_SUBCOLLECTIONS.items) and the staff's `moduleProgress` subcollection to compute the same `doneMaterials/totalMaterials` ratio ModulePage.tsx already derives (lines 47-65), then render as a card grid with a progress bar per module (visually similar to the module-progress bar already built in ModulePage.tsx lines 128-145) linking to `/m/{moduleId}`. Add a sidebar nav entry pointing here. No schema change.

**Files.** `apps/web/src/modules/ModulePage.tsx`, `apps/web/src/components/AppSidebar.tsx`, `apps/web/src/dashboard/StaffDashboardPage.tsx`, `apps/web/src/lazyRoutes.ts`, `apps/web/src/App.tsx`

### STAFF-08 — "My Growth" — personal rubric-rating trend view on Profile

**medium** · value: **high**

Add a chart/visualization section to the Profile page plotting a staff member's own proficiency ratings (developing/basic/proficient/distinguished) across their finalized observations over time, broken out by rubric domain, so a teacher can see their own trajectory across observation cycles at a glance instead of opening each PDF individually.

**Why this fits.** This is explicitly called out as unbuilt in the code itself — ProfilePage.tsx line 465: "Future: rubric-rating data viz vs. org aggregate goes here" — and all the data it needs already exists and is already readable by the staff member: `observationRubricSnapshot.domains` (frozen rubric structure) plus `observationData[componentId].proficiency` on each of their own finalized Observation docs, which ProfilePage already loads in full (the `observations` query, lines 259-267).

**Implementation.** No new data fetching needed — ProfilePage.tsx already holds `observations` (all of the signed-in user's own docs, readable per firestore.rules since `observedEmail == request.auth.token.email` for finalized docs) and `finalizedByYear`. Add a new memo that, for each finalized observation with a non-null `rubricSnapshot`, averages `PROFICIENCY_LEVELS` index (packages/shared/src/schema/rubric.ts — 'developing'|'basic'|'proficient'|'distinguished' map to 0-3) per domain from `observation.observationData`. No charting library exists in apps/web/package.json (verified) — build a small hand-rolled SVG (bar or line) following the existing precedent of `ProgressRing`/`Timeline` inline SVG components in apps/web/src/dashboard/DashboardView.tsx rather than adding a new dependency. Render as a new section on ProfilePage.tsx replacing the line-465 comment, gated behind `finalizedByYear.length > 0`. Purely additive/read-only; no schema or security-rule change.

**Files.** `apps/web/src/routes/ProfilePage.tsx`, `packages/shared/src/schema/observation.ts`, `packages/shared/src/schema/rubric.ts`, `apps/web/src/dashboard/DashboardView.tsx`

### STAFF-09 — "My Building" colleague lookup for regular staff

**medium** · value: **medium**

Let any staff member (not just peer evaluators/admins) see a short list of colleagues who share their building(s) — name, role, and a mailto link — surfaced on the Profile page next to the existing "My Administrator(s)" card. Currently a regular teacher has zero visibility into who else works at their building through this app.

**Why this fits.** firestore.rules explicitly blocks a plain `list`/broad `get` on `/staff` for non-special-access users ("a staff doc carries sensitive HR-adjacent fields... a broad get would let any teacher pull any colleague's record" — firestore.rules lines 87-96), so this can't be built as a client-side Firestore query the way StaffDirectoryPage does it. It needs a narrow, purpose-built callable that returns only {name, email, role} for staff sharing a building — the same shape ProfilePage already renders for administrators, just without the elevated-role restriction.

**Implementation.** New Cloud Functions v2 callable (e.g. `apps/functions/src/staff/getBuildingColleagues.ts`) that takes no input, resolves the caller's own `/staff/{email}` doc server-side (admin SDK bypasses rules), queries `/staff` where `buildings array-contains-any [caller's buildings]` and `isActive == true`, and returns a trimmed `{name, email, role}[]` — deliberately omitting year/summativeYear/hasAdminAccess/emailPreferences. Wire it through the existing rate-limit wrapper (apps/functions/src/lib/rateLimit.ts, same pattern as `updateEmailPreferences`) since it's a staff-triggerable read with no bespoke Firestore-rules coverage. Render results in a new card on apps/web/src/routes/ProfilePage.tsx modeled on the existing "My Administrator{s}" section (lines 382-410), called via `httpsCallable` the same way `updateEmailPreferencesFn`/`getCalendarConnectionStatusFn` already are in that file. No firestore.rules change needed (the callable runs server-side with admin privileges) — flag for owner review anyway since it's a new data-exposure surface even though scoped.

**Files.** `apps/web/src/routes/ProfilePage.tsx`, `apps/functions/src/lib/rateLimit.ts`, `packages/shared/src/schema/staff.ts`, `firestore.rules`

**Depends on.** New Cloud Function deploy; no firestore.rules edit required but the new data-exposure surface (any staff member can now learn building-mates' names/roles) should get explicit owner sign-off before shipping.

### STAFF-10 — Browser reminders for closing signup windows

**medium** · value: **medium**

Let a staff member opt in (per-device, via the Web Notifications API) to a local browser notification when their open self-scheduling window is about to close (e.g. within 24 hours) — reusing the "urgent" deadline logic the dashboard already computes for the signup checkpoint card, just also firing a native OS notification instead of only a highlighted card.

**Why this fits.** `deriveCheckpoints.ts` already flags a checkpoint `urgent: true` and computes `deadlineRelativeLabel` ("Closes tomorrow", "2 days left") for the signup step when `dateFrom === 'windowEndDate'` (lines 171-181), but that state is only visible if the staff member happens to open the dashboard before the window lapses — there's no push/reminder mechanism today for a deadline someone might otherwise miss.

**Implementation.** Client-only, opt-in per browser (`Notification.requestPermission()`), no new Cloud Function or schema needed for a first pass. In apps/web/src/dashboard/StaffDashboardPage.tsx (or a new small hook), when `openBooking` is non-null and the derived urgent checkpoint's `dueRelative` crosses the `DEADLINE_URGENCY_DAYS` threshold (deriveCheckpoints.ts line 121), and the user has previously granted Notification permission, fire `new Notification(...)` once per session/day (dedupe via localStorage keyed on windowId+day to avoid re-notifying every render). This only fires while a tab is open, which is an honest limitation to document to the user (not a true push notification) — a true always-on push would require a service worker + FCM setup, out of scope for this pass. Add an opt-in toggle near the existing email-preferences UI on apps/web/src/routes/ProfilePage.tsx for discoverability.

**Files.** `apps/web/src/dashboard/StaffDashboardPage.tsx`, `apps/web/src/dashboard/deriveCheckpoints.ts`, `apps/web/src/routes/ProfilePage.tsx`

### STAFF-11 — Global quick-jump command palette (⌘K)

**medium** · value: **medium**

A keyboard-triggered (⌘K / Ctrl+K) search overlay that lets any staff member jump straight to a person (peer evaluator/admin only), a module, a rubric domain, or a static page (Profile, My Observations, Staff Directory) without hunting through the sidebar — especially useful once a role has many module nav entries appended to their sidebar.

**Why this fits.** The sidebar already assembles exactly the navigable surface this needs (`buildNavItems`, `moduleNavItems`, `rubricDomainItems` in apps/web/src/components/AppSidebar.tsx) but there's no keyboard-driven way to reach any of it — a peer evaluator with dozens of staff still has to go through Staff Directory's search box, and everyone else has to scan/scroll a growing sidebar.

**Implementation.** Add shadcn/ui's `command` component (not yet present in apps/web/src/components/ui — install via the shadcn skill/CLI, which pulls in `cmdk`, a dependency already implied by the shadcn/ui stack). Build a `CommandPalette` component mounted once in apps/web/src/components/Layout.tsx, listening for the ⌘K/Ctrl+K keydown. Source its static-page and module entries from the same `navConfig`/`moduleNavItems` AppSidebar.tsx already computes (extract that computation into a shared hook, e.g. `useNavConfig()`, so Layout and AppSidebar share one source of truth instead of duplicating it). For staff-person search (peer-evaluator/admin only, gated on `claims.isAdmin || role === peer-evaluator` same as the existing `/staff` route guard), reuse the existing `useFirestoreCollection<Staff>(COLLECTIONS.staff, ...)` query pattern already in StaffDirectoryPage.tsx, filtered client-side by the typed query. No schema change.

**Files.** `apps/web/src/components/AppSidebar.tsx`, `apps/web/src/components/Layout.tsx`, `apps/web/src/routes/StaffDirectoryPage.tsx`, `apps/web/src/components/ui`

**See also.** `ADMIN-12`

### STAFF-13 — PD Module completion suite: certificates + reflection checks

**suite** · value: **medium**

Extend the module system beyond a checklist into a small completion suite: (1) a downloadable PDF "Certificate of Completion" generated once a staff member finishes 100% of a module's materials, reusing the existing observation-PDF pipeline; (2) an optional short reflection/check-for-understanding prompt an admin can attach to a module (new richtext-adjacent section type) that a staff member fills in before the module counts as done; (3) a completion-confirmation email using the existing email pipeline. Turns "module tracking" into something with a real artifact staff can point to (e.g. for license renewal / PD hour documentation), not just a checked box.

**Why this fits.** The repo already has every piece this needs except the glue: a Puppeteer-based Cloud Run PDF renderer (apps/pdf-renderer) already produces the observation PDFs, a Drive-upload service account already stores binaries off Firebase Storage (apps/functions/src/lib/drive.ts), and a full templated-email pipeline (emailTemplates → substituteVariables → sendEmail → renderEmailShell → /mail doc) already exists — this is a matter of composing existing infrastructure for a new artifact type rather than building new plumbing.

**Implementation.** This is intentionally scoped as a multi-part suite, not one PR. Staff-facing pieces: (a) extend `MODULE_SECTION_TYPES` in packages/shared/src/schema/module.ts (currently `['richtext','resources','materials']`) with a `'reflection'` type storing a free-text or short Tiptap answer per staff member (new subcollection under staff, mirroring `STAFF_SUBCOLLECTIONS.moduleProgress`); (b) in apps/web/src/modules/ModulePage.tsx, once `doneMaterials === totalMaterials` (and any reflection section is answered), show a "Download certificate" CTA; (c) a new Cloud Function callable (e.g. `apps/functions/src/modules/generateModuleCertificate.ts`) that calls the pdf-renderer service the same way `regenerateObservationPdf`/`finalizeObservation` already do, uploads the PDF to Drive via `apps/functions/src/lib/drive.ts`, and returns a Drive view link; (d) a new `EmailTriggerType` (e.g. `'module.completed'`) wired into the existing trigger/template system in packages/shared/src/schema/emailTemplate.ts. This has real cross-cutting cost: new Zod schema fields, a new subcollection, a new callable rate-limited via apps/functions/src/lib/rateLimit.ts, new firestore.rules coverage for the reflection subcollection (owner sign-off required), and admin-console authoring UI for the reflection section type (out of this domain's scope but a hard dependency — admins need a way to author it before staff can see it).

**Files.** `packages/shared/src/schema/module.ts`, `packages/shared/src/schema/emailTemplate.ts`, `apps/web/src/modules/ModulePage.tsx`, `apps/web/src/modules/moduleSections.tsx`, `apps/functions/src/lib/drive.ts`, `apps/functions/src/lib/rateLimit.ts`, `apps/pdf-renderer`, `firestore.rules`

**Depends on.** Requires firestore.rules additions for the new reflection subcollection (owner-protected — needs explicit sign-off) and a companion admin-console authoring surface for the new 'reflection' module section type, which is outside this staff-experience domain.

---

<a id="plat"></a>

## Communications & platform

### PLAT-01 — Severity-colored audit log actions

**tweak** · value: **low**

In the Audit Log admin table, security-relevant actions (sign_in_rejected, rate_limit_tripped, role_changed, staff_deactivated, observation_deleted, evidence_removed) render with a colored Badge (warning/destructive tone) instead of plain monospace text, so an admin scanning the log can spot anomalies at a glance instead of reading every row.

**Why this fits.** The table already special-cases exactly one action (emailDeliveryFailed) with `<Badge tone="warning">`; extending the same pattern to a short, fixed list of other sensitive AUDIT_ACTIONS values is a same-file, low-risk visual improvement that raises the log's usefulness during the district cutover when admins will be watching it closely.

**Implementation.** Edit the `action` column's `cell` renderer in apps/web/src/admin/audit-log/AuditLogPage.tsx (around the existing `e.action === AUDIT_ACTIONS.emailDeliveryFailed ? <Badge tone="warning">...` ternary). Build a small `Record<AuditAction, 'warning'|'destructive'|undefined>` map keyed off AUDIT_ACTIONS from @ops/shared (packages/shared/src/schema/auditLog.ts) covering signInRejected, rateLimitTripped, roleChanged, staffDeactivated, observationDeleted, evidenceRemoved; fall back to plain text for everything else. Reuse the existing Badge component (apps/web/src/components/ui/badge.tsx) — no new component needed.

**Files.** `apps/web/src/admin/audit-log/AuditLogPage.tsx`, `packages/shared/src/schema/auditLog.ts`

### PLAT-02 — Copy audit details JSON to clipboard

**tweak** · value: **low**

Add a small copy icon/button next to the existing 'View'/'Hide' toggle on each audit log row's Details panel so an admin can copy the raw `details` JSON (e.g. a rejected-href list, a rate-limit context) straight into a support ticket or Slack message without manually selecting text out of a `<pre>` block.

**Why this fits.** The `DetailsButton` component in AuditLogPage already renders `JSON.stringify(details, null, 2)` in a `<pre>`; adding `navigator.clipboard.writeText` behind a button is a few lines and removes real day-to-day friction for a solo admin who will be triaging delivery failures and rate-limit trips by hand.

**Implementation.** Edit `DetailsButton` in apps/web/src/admin/audit-log/AuditLogPage.tsx: add a ghost icon button (lucide `Copy` icon, already imported style in the file) that calls `navigator.clipboard.writeText(JSON.stringify(details, null, 2))` and flips to a brief 'Copied' state for ~1.5s (setTimeout + local state, mirroring other toast-less inline-feedback patterns in the codebase).

**Files.** `apps/web/src/admin/audit-log/AuditLogPage.tsx`

### PLAT-03 — Reset branding to OPS defaults button

**tweak** · value: **low**

Add a 'Reset to OPS defaults' button on the Branding admin page that clears appName/primaryColor/logoUrl/iconUrl back to the packaged OPS Tech values in one click, instead of requiring an admin to manually retype the default app name and hex color and re-clear both logo fields.

**Why this fits.** BrandingPage.tsx has a save flow and a live preview panel but no undo/reset path — if a district admin experiments with a color and wants to bail, they have to remember and retype every OPS_BRAND default. Trivial to add given OPS_BRAND already exports the canonical defaults.

**Implementation.** In apps/web/src/admin/branding/BrandingPage.tsx, add a 'Reset to defaults' outline Button next to 'Save branding' that calls the local setters (`setAppName(OPS_BRAND.defaultAppName)`, `setPrimaryColor(OPS_BRAND.defaultPrimaryColor)`, `setLogoUrl(null)`, `setIconUrl(null)`) — this only touches component state, the admin still has to hit Save to persist, matching the page's existing hydrate-then-save UX (useHydratedDraft). OPS_BRAND is already imported from '@ops/shared'.

**Files.** `apps/web/src/admin/branding/BrandingPage.tsx`, `packages/shared/src/brand.ts`

### PLAT-04 — Surface remaining rate-limit quota to end users

**small** · value: **medium**

When an audio upload or transcription request succeeds, return the caller's remaining quota (e.g. '4 of 20 audio uploads left this hour') so the recorder/transcription UI can show a low-quota warning before the user hits a hard 429, instead of only learning about the limit after being blocked.

**Why this fits.** `checkRateLimit()` in apps/functions/src/lib/rateLimit.ts already computes `remaining` and `resetAtMs` on every call, but apps/functions/src/audio/uploadAudio.ts and apps/functions/src/transcription/requestTranscription.ts currently only use that decision on the rejection path (429 + Retry-After header) — the data is thrown away on success. Returning it costs nothing new server-side.

**Implementation.** In uploadAudio.ts and requestTranscription.ts, after `checkRateLimit()` returns `allowed: true`, include `decision.remaining` and `decision.resetAtMs` in the function's success response (uploadAudio is an HTTP function — add to the JSON body; requestTranscription is likely an onCall — add to the returned object, check its return type). On the web side, surface it as a small muted-text hint near the record/transcribe button (find the caller in apps/web/src — likely an audio recorder component) only when remaining &lt;= ~3, to avoid noisy UI on the common case.

**Files.** `apps/functions/src/audio/uploadAudio.ts`, `apps/functions/src/transcription/requestTranscription.ts`, `apps/functions/src/lib/rateLimit.ts`

### PLAT-05 — Honor the outbound email address setting + add reply-to

**small** · value: **medium**

Make the already-exposed 'Outbound email address' admin setting (Admin → Settings) actually control the `from` address on sent mail, and add an optional reply-to so recipients replying to a notification (e.g. a booking confirmation) land in a real monitored inbox instead of a noreply address.

**Why this fits.** appSettings.outboundEmailAddress is a real Zod-schema field with a form input on SettingsPage.tsx, but apps/functions/src/lib/emailUtils.ts hardcodes `const FROM_EMAIL = 'observations@orono.k12.mn.us'` and never reads the setting — the admin control is currently decorative. Wiring it up (plus a reply-to) turns an already-built-but-inert knob into a working one and is a natural pairing since both touch the same `sendEmail()` call site.

**Implementation.** In apps/functions/src/lib/emailUtils.ts, replace the hardcoded FROM_EMAIL usage in `sendEmail()` with a value loaded from `/appSettings/global.outboundEmailAddress` (mirror the existing `loadEmailBranding`/`loadSecurityAdminEmail` pattern — read once, fall back to the current hardcoded string via `appSettings.shape.outboundEmailAddress` default if the doc/field is missing, since raw Firestore reads bypass Zod defaults). Add an optional `replyTo?: string` param to `sendEmail()`'s args and to the `/mail` doc's `message` object (the Trigger Email extension supports a `replyTo` field on the message object — verify against whatever extension config is eventually adopted per TODO.md's pending Send Email extension decision). Keep FROM_EMAIL as the ultimate fallback constant.

**Files.** `apps/functions/src/lib/emailUtils.ts`, `apps/web/src/admin/settings/SettingsPage.tsx`, `packages/shared/src/schema/settings.ts`

**Depends on.** Loosely coupled to the still-undecided 'Adopt the Firestore Send Email extension' TODO item — confirm the extension's mail-doc `message.replyTo` field name against whatever config gets adopted before shipping.

### PLAT-06 — Email template version history with one-click revert

**medium** · value: **high**

Every time an admin edits and saves an email template's subject/body, keep a bounded history of prior versions (author, timestamp, previous subject+bodyHtml) inline on the template doc, with a 'History' panel in the template editor that lets the admin preview and restore any prior version — protecting against an accidental bad save wiping out a carefully-worded notification with no way back.

**Why this fits.** EmailTemplatesPage.tsx's `saveTemplate()` currently does a plain `setDoc(..., { merge: true })` overwrite with no prior-version capture, and the audit log only records `settingsUpdated`-style entries elsewhere, not template body diffs — so a bad edit to e.g. the booking-confirmation template (a critical, always-send trigger) is unrecoverable today except via Firestore console history if backups are enabled. This is squarely in-domain since it's the same admin surface as the rest of the email template capability.

**Implementation.** Extend `emailTemplate` in packages/shared/src/schema/emailTemplate.ts with an optional `history: z.array(z.object({ subject: z.string(), bodyHtml: z.string(), editedAt: isoDate, editedBy: email })).max(10).default([])` field (capped array on the doc itself avoids needing a new subcollection + new firestore.rules entry, which would need owner sign-off). In EmailTemplatesPage.tsx's `saveTemplate()`, before `setDoc`, prepend the \*current\* (pre-edit) subject/bodyHtml/updatedAt/editor to `history` (trim to the last 10) and include it in the same `setDoc` call. Add a 'History' disclosure in `TemplateRow` (mirrors the existing preview `<iframe>` pattern) listing each version with a 'Restore' button that copies that version's subject/bodyHtml back into `editForm` for the admin to review-then-save (never a silent overwrite).

**Files.** `packages/shared/src/schema/emailTemplate.ts`, `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx`

### PLAT-07 — Admin rate-limit monitor page

**medium** · value: **medium**

A new Admin page listing which staff members are currently close to or have tripped their audio-upload or transcription rate limits, so the solo admin can proactively spot an abuse case or a legitimate power-user who needs a higher configured limit, instead of only finding out reactively via a `rateLimitTripped` audit entry buried in the log.

**Why this fits.** /rateLimitCounters is explicitly server-only in firestore.rules (`allow read, write: if false`), so today there is no way — not even for an admin — to see current counter state; the only visibility is the audit log's `rate_limit_tripped` entries after the fact. A read-only admin callable avoids any firestore.rules change (owner-protected) since it goes through the Admin SDK like every other backend read.

**Implementation.** Add a new onCall function e.g. `listRateLimitStatus` (admin-only via the same `isAdminRole(callerRole)` guard pattern used in resendStaffInvite.ts) in apps/functions/src/audit/ or a new apps/functions/src/rateLimit/ dir, that queries `db.collection(RATE_LIMIT_COUNTERS_COLLECTION)` (exported from apps/functions/src/lib/rateLimit.ts) ordered by `count` desc, limited to e.g. top 50, and returns `{ userEmail, key, count, windowStart }[]` joined against `loadRateLimits()` so the client can compute a percent-of-limit. Add a small admin page (new dir apps/web/src/admin/rate-limits/RateLimitMonitorPage.tsx, registered in apps/web/src/lazyRoutes.ts and apps/web/src/admin/adminNav.ts) rendering a table via the existing AdminDataView component (apps/web/src/admin/\_shared/AdminDataView.tsx, same one AuditLogPage uses).

**Files.** `apps/functions/src/lib/rateLimit.ts`, `apps/web/src/lazyRoutes.ts`, `apps/web/src/admin/adminNav.ts`, `apps/web/src/admin/_shared/AdminDataView.tsx`

### PLAT-08 — Broadcast a manual email to a filtered staff group

**medium** · value: **high**

Let a PE or admin send a 'manual' template to a filtered group of staff (by role, building, or year) in one action — e.g. 'remind all Year-1 Teachers to finish their Work Product' — instead of the current one-recipient-at-a-time `sendManualEmail` flow that requires opening each staff member's page individually.

**Why this fits.** sendManualEmail.ts already does everything a broadcast needs per-recipient (permission check, template load, variable substitution, `sendEmail()` which already handles per-recipient suppression via email preferences) — it just takes a single `toEmail` string. This is a genuinely high-value, low-novelty extension: mostly a loop plus a staff-filter UI, both of which already exist in the Staff admin area.

**Implementation.** Add a new onCall `sendBulkManualEmail` in apps/functions/src/email/ that accepts `{ templateId, toEmails: string[], vars }`, re-uses the exact same auth/permission/template-load logic as sendManualEmail.ts, and loops `sendEmail()` per recipient (each gets its own mailDocId via the same `manual-${templateId}-${local}-${Date.now()}` convention, and per-recipient suppression already works since `sendEmail` accepts a single string 'to' or reuse its array support and let it batch). Cap the batch size (e.g. 200) to bound execution time within the callable's timeoutSeconds. On the web side, add a 'Message a group' entry point — either a new small page under apps/web/src/admin/email-templates/ or a bulk-select affordance added to the existing Staff admin table (apps/web/src/admin/staff/) that lets the admin filter by role/building/year (staff schema already carries these fields) and then pick a manual-trigger template to send to the resulting list.

**Files.** `apps/functions/src/email/sendManualEmail.ts`, `apps/functions/src/lib/emailUtils.ts`, `apps/web/src/admin/staff`, `apps/web/src/admin/email-templates/EmailTemplatesPage.tsx`

**Depends on.** Consider a lighter per-recipient rate limit or a hard batch cap so a large broadcast can't be used to spam the Trigger Email extension / hit its own send quota.

### PLAT-09 — Enforce the configured session duration

**medium** · value: **medium**

Actually enforce the 'Session duration (hours)' admin setting by forcing a sign-out (and redirect to the sign-in screen) once a user's session exceeds the configured window, instead of the setting being a schema field with a form input that nothing currently reads.

**Why this fits.** appSettings.sessionDurationHours is a real, admin-editable, positive-max-168 Zod field wired into SettingsPage.tsx's form, but a repo-wide search finds it referenced nowhere else — not in AuthProvider.tsx, not in any Cloud Function. It's a security control the UI implies exists but doesn't. For a K-12 district app on shared/lab devices, an enforced idle/absolute session timeout is a real, expected control.

**Implementation.** In apps/web/src/auth/AuthProvider.tsx, on sign-in success, stamp a `signInAtMs` (e.g. into a small localStorage entry, since Firebase ID tokens' own `auth_time` claim is also available via `getIdTokenResult()` -- prefer the token's `auth_time` since it can't be tampered with client-side by clearing localStorage). Add a periodic check (interval or on-focus) comparing `Date.now() - authTimeMs` against `appSettings.sessionDurationHours * 3600_000` (load via the existing useFirestoreDoc-based settings hook, same doc SettingsPage already reads) and call the existing `signOut()` when exceeded, surfacing a 'Your session expired, please sign in again' message on the sign-in screen. This is a soft client-side timeout (Firebase ID tokens already auto-refresh up to their own max session length); note in code comments that a hard server-side cutoff would additionally need Identity Platform session-duration configuration, which is a project-level Firebase Auth setting outside this app's deploy surface.

**Files.** `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/admin/settings/SettingsPage.tsx`, `packages/shared/src/schema/settings.ts`

### PLAT-10 — Admin dashboard card for staff who haven't signed in yet

**medium** · value: **high**

A card on the admin dashboard listing active staff who were invited (a `staff.created` email was sent) but have never signed in, with a one-click 'Resend invite' action per person — giving the solo admin a rollout-readiness view instead of having to guess who's stuck or manually cross-reference the Staff list against sign-in activity.

**Why this fits.** All the primitives already exist and just aren't surfaced together: `sign_in` is a real AUDIT_ACTIONS entry written on every successful login, `resendStaffInvite` is an existing admin-only callable, and the district is mid-rollout toward an Aug/Sept 2026 cutover where exactly this kind of adoption-tracking view is highest-value.

**Implementation.** Add a query (client-side, admin-only route so firestore.rules' `allow read: if isAdmin()` on /auditLog already covers it) for the most recent `sign_in` audit entry per staff email — since Firestore can't do a 'group by userEmail, latest timestamp' query directly, either (a) do it in a new admin-only callable that reads /staff (active) and /auditLog with `action == 'sign_in'` via the Admin SDK and diffs the sets, returning `{ email, name, invitedAt }[]` for staff with zero sign-in entries, or (b) simpler/cheaper: denormalize a `lastSignInAt` field onto the /staff doc — add a write in whatever function currently handles first sign-in (check syncMyClaims.ts, apps/functions/src/auth/syncMyClaims.ts) so `staff/{email}.lastSignInAt` gets stamped, then the dashboard card is a plain Firestore query for `isActive == true && lastSignInAt == null`. Prefer (b) for a much cheaper live-query dashboard card. Card renders in an existing admin dashboard component (apps/web/src/admin/dashboard/) with a 'Resend invite' button wired to the existing `resendStaffInvite` callable already used elsewhere.

**Files.** `apps/functions/src/auth/syncMyClaims.ts`, `apps/web/src/admin/dashboard`, `apps/functions/src/email/resendStaffInvite.ts`, `packages/shared/src/schema/staff.ts`

### PLAT-11 — Drive quota usage history and trend chart

**medium** · value: **medium**

Store each day's Drive-quota sample (not just the alert-worthy ones) so an admin page can show a usage-over-time chart, letting the district see the growth trend (e.g. 'up 4% a week, will hit 80% in ~6 weeks') well before the reactive 80% alert email fires, and confirm the quota check itself is running daily.

**Why this fits.** monitorDriveQuota.ts already computes `limitBytes`/`usageBytes`/`fraction` every day at 05:00 CT but only acts on it when crossing QUOTA_ALERT_THRESHOLD (0.8) — every other day's sample is logged to Cloud Logging and discarded. Persisting it is a small addition to an already-running scheduled function and turns a purely reactive alert into a proactive trend view.

**Implementation.** In apps/functions/src/drive/monitorDriveQuota.ts, after computing `parsed`/`fraction`/`pct` (before the `if (fraction < QUOTA_ALERT_THRESHOLD) return;` early-return), write a small doc to a new collection, e.g. `db.collection('driveQuotaHistory').doc(dateYMD).set({ limitBytes, usageBytes, usageInDriveBytes, pct, sampledAt: FieldValue.serverTimestamp() })`, regardless of whether the alert threshold is crossed. Add `driveQuotaHistory` to COLLECTIONS in packages/shared/src/constants.ts and a matching Zod schema (new packages/shared/src/schema/driveQuotaHistory.ts). Add a firestore.rules entry `match /driveQuotaHistory/{date} { allow read: if isAdmin(); allow write: if false; }` — call out explicitly that this new rule needs owner sign-off since firestore.rules is protected. Build a small admin page/chart (a new admin/drive-quota area, or a card on the existing Settings page) reading the last ~90 days and rendering a simple sparkline/line chart (no new charting dependency needed for a single-series trend — an inline SVG polyline is enough, consistent with the 'favor existing infra' guidance).

**Files.** `apps/functions/src/drive/monitorDriveQuota.ts`, `packages/shared/src/constants.ts`, `firestore.rules`

**Depends on.** Requires a new firestore.rules match block for the new collection — needs explicit owner sign-off since firestore.rules is protected.

**See also.** `AI-11`

### PLAT-12 — In-app notification center

**large** · value: **high**

A bell-icon dropdown in the app header showing each signed-in user's recent relevant events — their observation was finalized, a booking was confirmed/cancelled, their role changed — read directly from the app instead of only via email, with unread-count badging. Gives staff who miss or ignore email (or who have opted out of a category via emailPreferences) an in-app fallback, and gives the solo admin one less 'did the email even send' support question.

**Why this fits.** This is the single biggest lever left in the domain: nearly all the hard parts already exist and just need to be tapped a second time. Every notification-worthy event already flows through `sendTemplatedEmail`/`sendEmail` with a `triggerType`, an `EMAIL_TRIGGER_CATEGORY` mapping, and a `isCriticalEmailTrigger` check — the same call sites can fan out a lightweight in-app record alongside the email without re-deriving 'what happened and to whom' from scratch.

**Implementation.** Add a new Zod schema packages/shared/src/schema/notification.ts for a `/notifications/{email}/items/{id}` subcollection doc: `{ triggerType: EmailTriggerType, title: string, body: string, target: string, createdAt: isoDate, readAt: isoDate.nullable().default(null) }`. In apps/functions/src/lib/emailUtils.ts, add a `writeNotification()` helper called from inside `sendEmail()` right after the existing audit-log write, keyed off the same `recipients` array that already survived the preference-suppression filter (so a user who opted out of emails for a category still gets the in-app version — or thread the same category check through if you want it to also respect email preferences; decide deliberately, don't silently diverge). This reuses the trigger-type plumbing that already exists rather than inventing a parallel notification-classification system. Add firestore.rules for the new subcollection: `match /notifications/{email}/items/{id} { allow read, update: if isCurrentUserEmail(email); allow write: if false; }` (clients can mark-as-read via a narrow field-restricted rule or, more conservatively, only via a callable — decide based on the existing isCurrentUserEmail() helper already used elsewhere in the ruleset) — call out explicitly that this needs owner sign-off since firestore.rules is protected, as is firestore.indexes.json if a composite index is needed for `readAt == null` queries. Add a bell-icon component to the app header (find the header shell, likely near apps/web/src/components/BrandingProvider.tsx's consumers) using useFirestoreCollection against the signed-in user's own /notifications/{email}/items subcollection.

**Files.** `apps/functions/src/lib/emailUtils.ts`, `packages/shared/src/schema/notification.ts`, `packages/shared/src/constants.ts`, `firestore.rules`, `apps/web/src/components`

**Depends on.** Requires new firestore.rules (and possibly firestore.indexes.json) entries — explicit owner sign-off needed before this can ship, since both files are owner-protected.

---

<a id="xcut"></a>

## Cross-cutting (critic pass)

_These came from the critic pass — a single agent that saw only the titles from all six domain teams and hunted for what nobody proposed. They skew larger and more structural than the per-domain ideas, and several of them (caseload boundaries, retention policy, calibration) are the kind of thing a district asks about after go-live rather than before._

### XCUT-04 — Pre-/post-observation meeting reminder emails

**small** · value: **medium**

Automated reminder emails the morning of a scheduled pre-observation or post-observation meeting, sent to both the observer and observed staff member, using the existing `preObsDate`/`postObsDate` fields already captured on the observation doc.

**Why this fits.** `observation.ts` has carried `preObsDate`/`postObsNotes`/`postObsDate` fields since Phase 2, and `MeetingNotesSection.tsx` lets users record them, but grep confirms zero functions reference these fields — no reminder ever fires. The proposed '.ics download' idea just gives a static calendar file; it doesn't remind anyone the day of. This is a real, already-half-built gap none of the 81 ideas touched.

**Implementation.** New scheduled function `apps/functions/src/observations/sendMeetingReminders.ts`, modeled directly on `expireObservationWindows.ts`'s daily-scan pattern: query observations where `preObsDate`/`postObsDate` equals today (Chicago time) and status is Draft, send via `sendTemplatedEmail` (`apps/functions/src/lib/emailUtils.ts`) with a new trigger type added to `EMAIL_TRIGGER_TYPES`/`EMAIL_TRIGGER_CATEGORY` in `packages/shared/src/schema/emailTemplate.ts` so staff can opt out like other non-critical categories. No firestore.rules changes needed — it's a scheduled read + `/mail` doc write, same shape as existing jobs.

**Files.** `apps/functions/src/observations`, `apps/functions/src/scheduling/expireObservationWindows.ts`, `packages/shared/src/schema/emailTemplate.ts`, `apps/web/src/observations/MeetingNotesSection.tsx`

### XCUT-05 — Bulk reassign an evaluator's in-flight draft observations

**medium** · value: **medium**

Admin tool to reassign all of a departing/reassigned peer evaluator's open Draft observations (and pending observation-window invites they're hosting) to a replacement evaluator in one action, preserving audit history of the original observer.

**Why this fits.** `applyStaffRollover` handles year/summative-year transitions but never touches observation or window ownership. When a PE goes on leave or changes roles mid-cycle mid-year (a real staffing event), their unfinished Draft observations and open windows currently have no admin path off that evaluator except editing documents one at a time. None of the 81 ideas — including the staff-domain rollover and scheduling-domain bulk actions — cover this.

**Implementation.** New callable `apps/functions/src/observations/reassignObserver.ts` alongside `reopenObservation.ts`, rate-limited via `apps/functions/src/lib/rateLimit.ts` like other admin callables, writing an audit entry (`packages/shared/src/schema/auditLog.ts`) recording old/new observer per document. Add a companion for `observationWindows` (owner field swap) reusing `updateObservationWindow.ts`'s validation. Only touches Draft observations — Finalized ones keep their original `observerEmail`/`observerName` as historical record per the schema's own documented denormalization rationale.

**Files.** `apps/functions/src/observations/reopenObservation.ts`, `apps/functions/src/scheduling/updateObservationWindow.ts`, `apps/web/src/admin/staff/StaffPage.tsx`

### XCUT-07 — Keyboard-navigable, screen-reader-labeled rubric scoring grid

**medium** · value: **medium**

Make the proficiency-level selection grid (developing/basic/proficient/distinguished per component) and look-for checklists fully operable by keyboard (arrow-key navigation between cells, Enter/Space to select) with proper ARIA roles, so the core scoring interaction isn't mouse/touch-only.

**Why this fits.** Nobody among the 6 domain teams proposed any accessibility work, despite this being the single most-used, most consequential interaction in the product (every observation goes through it) and a legal exposure point for a public K-12 district. `RubricRow.tsx` and the proficiency grid are almost certainly built from styled `div`/`button` grids without grid semantics given the Tailwind-first component style seen elsewhere in the repo.

**Implementation.** Audit `apps/web/src/components/rubric/RubricRow.tsx` and wherever `proficiencyLevel` selection renders in `ObservationEditorPage.tsx`; add `role="radiogroup"`/`role="radio"` semantics (proficiency is mutually-exclusive per component, matching `observationComponentEntry.proficiency` in `observation.ts`), `aria-checked`, and roving-tabindex arrow-key handling. Pair with a contrast check against DESIGN.md's `table-row-action-required` (red-100/red-900) treatment used for flagged rows.

**Files.** `apps/web/src/components/rubric/RubricRow.tsx`, `apps/web/src/observations/ObservationEditorPage.tsx`

### XCUT-08 — Admin data-subject bundle export for a single staff member

**medium** · value: **medium**

Admin-triggered export that bundles everything the system holds about one staff member — all observations (draft + finalized), transcripts, evidence-file links, audit-log entries mentioning them, and rollover history — into a single downloadable package (CSV manifest + linked Drive folder or zipped PDF set), for responding to a Minnesota Government Data Practices Act (MGDPA) personnel-data request or an internal HR/legal request.

**Why this fits.** The proposed 'Export "My Observations" as CSV' (staff-experience) is self-service and observation-list-only. Minnesota public employees have a statutory right to know what personnel data a public district holds on them (MGDPA, not FERPA — this is staff evaluation data, not student records) and districts periodically get formal records requests. No team proposed the admin-side, complete-record, legally-motivated export — a genuine table-stakes need for a public-sector HR-adjacent system that `docs/operations.md` already flags as holding 'multi-year, HR-adjacent staff evaluation records.'

**Implementation.** New admin-only callable/page under `apps/web/src/admin/staff/` (e.g. a 'Export records' action on `StaffPage.tsx` row actions, alongside `BulkEditDialog.tsx`). Reuses the CSV-export patterns already established by `apps/web/src/admin/staff/staffCsv.ts` and the proposed per-list CSV exports, but joins across `observations`, `auditLog`, and `transcriptionJobs` filtered by the target email — query patterns already exist individually (`ObservationsListPage.tsx`'s filters, `AuditLogPage.tsx`). Should be rate-limited and itself write an audit-log entry (an export of PII is exactly the kind of action `packages/shared/src/schema/auditLog.ts` exists to record).

**Files.** `apps/web/src/admin/staff/StaffPage.tsx`, `apps/web/src/admin/audit-log/AuditLogPage.tsx`, `packages/shared/src/schema/auditLog.ts`, `apps/functions/src/lib/rateLimit.ts`

**See also.** `OBS-06`, `STAFF-12`

### XCUT-09 — Finalized-observation retention & purge policy

**medium** · value: **medium**

A configurable retention window (mirroring the existing audit-log retention setting) after which old finalized observations — and their Drive evidence/audio — are either flagged for admin review or automatically archived/purged, aligned to the district's state-mandated records retention schedule.

**Why this fits.** `pruneAuditLog.ts` already proves the district cares about retention-bounded data (`appSettings/global.auditLogRetentionDays`), but that job only touches the audit log — finalized observations, which contain the most sensitive personnel content in the system (proficiency ratings, audio, transcripts) plus Google Drive evidence files, have no retention policy at all today. None of the 81 ideas address the data-lifecycle end of the record, only creation/scoring/delivery.

**Implementation.** Add a `observationRetentionYears` (or explicit MN records-schedule reference) setting to `packages/shared/src/schema/settings.ts`, surfaced on `SettingsPage.tsx` next to the existing retention-style settings. New scheduled function modeled on `pruneAuditLog.ts`/`expireObservationWindows.ts`, querying `observations` where `status == 'Finalized'` and `finalizedAt` predates the cutoff — start conservative (flag + admin-notify, not auto-delete, since Drive evidence deletion is destructive and the doc's own audio/transcripts are irreversible). Actual deletion of Drive files uses `apps/functions/src/lib/drive.ts`; no firestore.rules change needed for a scheduled backend job, but flag any UI surfacing of 'up for purge' status as needing careful admin-only gating.

**Files.** `packages/shared/src/schema/settings.ts`, `apps/functions/src/audit/pruneAuditLog.ts`, `apps/functions/src/lib/drive.ts`, `apps/web/src/admin/settings/SettingsPage.tsx`

**Depends on.** Should ship as flag-for-review before any auto-delete mode, given Drive evidence deletion is irreversible

### XCUT-01 — Peer-evaluator caseload assignment + access boundary

**large** · value: **high**

Let admins assign each staff member a designated peer evaluator (or a small evaluator pool) instead of the current free-for-all where any peer-evaluator/full-access user can create an observation for anyone. Non-assigned evaluators either get a warning or are blocked from starting a new observation outside their caseload (admin override always allowed). A 'My Caseload' view replaces the implicit 'everyone' scope on NewObservationPage/ObservationsListPage for peer evaluators.

**Why this fits.** None of the 81 ideas address who is \*allowed\* to evaluate whom. Right now `SPECIAL_ROLES.peerEvaluator` is an all-or-nothing grant — every PE can observe every teacher. Districts doing formal evaluation almost always have a defined evaluator-of-record per staff member (accountability, MN statute alignment, avoiding 'evaluator shopping'). This is the 'parent-of-record boundary' gap called out in the brief, translated to this domain.

**Implementation.** Add `assignedEvaluatorEmails: z.array(email).default([])` to `packages/shared/src/schema/staff.ts` (staff doc), surfaced in `StaffDialog.tsx`/`StaffInlineEditors.tsx` as a multi-select. `NewObservationPage.tsx` and `CreateObservationDialog.tsx` filter/flag the observed-staff picker by caseload for non-admin observers. Enforcing this at the data layer (not just UI) requires a `firestore.rules` change on `observations.create`/`update` — call this out explicitly as needing owner sign-off, and ship the UI-side guard first as a soft launch. Add a 'My Caseload' variant of ObservationsListPage filtered by `observedEmail in assignedEvaluatorEmails`. Track caseload size imbalance as a stretch (simple count per PE on an admin page).

**Files.** `packages/shared/src/schema/staff.ts`, `apps/web/src/admin/staff/StaffDialog.tsx`, `apps/web/src/observations/NewObservationPage.tsx`, `apps/web/src/observations/CreateObservationDialog.tsx`, `firestore.rules`

**Depends on.** firestore.rules change needs owner sign-off for the enforcement half; UI-only soft version can ship without it

### XCUT-02 — Calibration / double-scoring sessions for evaluator agreement

**large** · value: **high**

Let an admin designate a real observation as a 'calibration session' where 2+ peer evaluators independently score the same lesson (same rubric, same time window) without seeing each other's ratings until both submit. The system then computes per-component agreement (exact match / adjacent / discrepant) and surfaces a side-by-side comparison for the post-hoc calibration meeting.

**Why this fits.** The proposed 'Evaluation Insights suite (growth trends + rater consistency)' analyzes rater consistency \*after the fact\* across independent observations of different lessons — it can't measure true inter-rater reliability because no two evaluators ever score the same event today. Evaluator calibration on a shared anchor lesson is standard practice for any formal teacher-evaluation system (Danielson/MN TDE frameworks require periodic calibration to keep summative scores defensible) and nobody proposed the underlying capture mechanism, only downstream analytics.

**Implementation.** New `calibrationSessions/{id}` collection referencing 2+ `observationId`s scored against the same rubric/lesson, add a Zod schema in `packages/shared/src/schema/` (e.g. `calibrationSession.ts`) modeled on `observation.ts`'s `observationRubricSnapshot` pattern. A new callable (parallel to `finalizeObservation.ts`) locks each participant's scores until all have submitted, then a comparison view (new page under `apps/web/src/admin/`) diffs `observationData` proficiency per `componentId` across the linked observations. Feeds naturally into the existing Evaluation Insights suite as a data source once built.

**Files.** `packages/shared/src/schema/observation.ts`, `apps/functions/src/observations/finalizeObservation.ts`, `apps/web/src/admin`

**Depends on.** Best built after (or alongside) the proposed Evaluation Insights suite, which can consume its output

### XCUT-06 — Offline-durable observation drafting for spotty iPad wifi

**large** · value: **high**

Enable real Firestore offline persistence scoped to the active observation being scripted, so a peer evaluator taking notes on an iPad in a classroom with dead wifi doesn't lose scriptDoc/componentNotes edits — writes queue locally and sync automatically on reconnect, with a save-state indicator distinct from a generic connectivity banner.

**Why this fits.** The proposed 'App-wide offline indicator' (staff-experience, tweak) only tells the user they're offline — it doesn't make anything actually work offline. Given iPad Safari is explicitly a first-class target and observations are scripted live in classrooms (the worst wifi environment in a building), losing 20 minutes of typed notes to a dropped connection is the single highest-stakes offline failure mode in the app and nobody proposed making writes durable, only visible.

**Implementation.** Firestore JS SDK supports `enableIndexedDbPersistence` (or the newer persistent cache in `initializeFirestore`'s `localCache` option) — check current `apps/web/src/lib/firebase.ts` init for whether this is already configured (it currently is not, based on the plain `getFirestore` pattern implied by hooks in `apps/web/src/hooks`). Scope the UX to `ObservationEditorPage.tsx`'s autosave path (`observationUpdateInput` partial writes) with a per-field pending/synced indicator rather than a blanket offline mode, since full offline querying across the whole app is a much bigger and riskier surface (security rules re-evaluate from cache, stale role claims, etc.).

**Files.** `apps/web/src/lib/firebase.ts`, `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/hooks`

**Depends on.** Firestore SDK offline persistence config; interacts with existing autosave debounce logic in ObservationEditorPage

### XCUT-03 — Coaching-cycle / growth-plan suite linking observations over time

**suite** · value: **high**

A persistent growth plan per staff member that spans multiple observations: an evaluator sets 1-3 target rubric components with a SMART-style goal and target date, subsequent observations reference the active plan, and progress (proficiency movement on the targeted components) is tracked and shown to both the staff member and their evaluator. Closes/archives when the goal is met or the cycle ends.

**Why this fits.** The domain list's 'Growth-focus flag on rubric components' (observation, medium) only tags a component as a growth area \*within one observation\* — it has no persistence across observations, no goal text, no target date, and no progress view. Coaching cycles (plan → observe → reflect → re-observe) are the actual instructional-coaching workflow districts want and no team proposed the cross-observation structure, only the single-observation flag.

**Implementation.** New `growthPlans/{id}` collection: `staffEmail`, `evaluatorEmail`, `targetComponentIds: componentId[]`, `goalText` (tiptapDoc), `targetDate`, `status: 'active'|'met'|'archived'`, `linkedObservationIds: string[]`. Extend `observation.ts`'s update input to optionally carry a `growthPlanId` link. Surface on the staff Profile page (pairs naturally with the proposed 'My Growth' idea) and on ObservationEditorPage as a banner showing the active plan's targeted components while scripting. Depends on the 'Growth-focus flag' idea landing first as the per-component primitive this suite composes.

**Files.** `packages/shared/src/schema/observation.ts`, `apps/web/src/observations/ObservationEditorPage.tsx`, `apps/web/src/routes`

**Depends on.** Builds on the domain-team's 'Growth-focus flag on rubric components' idea as its atomic building block
