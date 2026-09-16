# Observation Drive Access Plan

**Drafted:** 2026-09-16 · **Status:** Decisions made, ready to build · **Based on:** commit `2a089f5` (file and line references are from that commit)

Move every permanent observation record (finalized PDFs, audio recordings, evidence files) out of Paul's My Drive into a district Shared Drive. Then share each observation folder with exactly the people who should see it.

## Goal

- **No person owns the records.** Files belong to a Shared Drive. Paul may be a member while setting up and migrating, then leaves.
- **Each observation folder has a short, intentional reader list:** the observer, the co-access people defined in the admin console, and the observed staff member once the observation is finalized.
- **Co-access is configured, not hard-coded.** Building administrators see observations for their building's staff. The Director of Special Services sees observations for special education staff. More rules can be added later.
- **Drive access stays correct over time.** When a rule or a staff member's building or role changes, the access the app granted updates. Anything someone deliberately shares by hand in Drive is left in place.

> **Deliberately not in scope:** Firestore and Firebase Storage access. They hold metadata and temporary content, and developer and admin access there is fine. This plan only controls access to the permanent files in Drive.

## Who can open an observation folder

The target policy. Everything in phases 2–4 enforces this table.

| Person                | While Draft | Once Finalized | Source                                                                                                                      |
| --------------------- | ----------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Observer              | Reader      | Reader         | `observerEmail` on the observation                                                                                          |
| Co-access             | Reader      | Reader         | Admin-console rules matched against the observed staff member's `buildings` and `role`                                      |
| Observed staff        | No          | Reader         | `observedEmail`, granted at finalize                                                                                        |
| App admins            | No          | No             | Administrator / Full Access roles work through the app only, unless a co-access rule names them                             |
| Shared Drive members  | Everything  | Everything     | Membership inherits into every folder, so keep this list minimal: the district owner, `observations@`, and Paul temporarily |
| Other Peer Evaluators | No          | No             | Unless a co-access rule names them                                                                                          |
| Shared by hand        | Kept        | Kept           | A share someone adds directly in Drive is honored, never removed by the app                                                 |

## Decisions

Decided 2026-09-16 unless marked otherwise. Nothing left here blocks building.

- **A. Uploader account: `observations@orono.k12.mn.us`** (phases 0, 1). The address the app already sends email from (`apps/functions/src/lib/emailUtils.ts:18`). Authorized with the existing `pnpm drive:authorize` script, so authentication code doesn't change. It's inside the domain, so a "no sharing outside Orono" policy won't block it, and Shared Drive files don't count against its storage.
- **B. Co-access people see Drafts: yes** (phase 3). They get Reader from the moment the folder is created. Only the observed staff member waits for finalize.
- **C. App admins work through the app only** (phases 3, 4). No automatic Drive access. Admins keep reopening, regenerating and finalizing in the app, and the server does the Drive work. An admin who needs to browse a folder gets a co-access rule like anyone else. Revisit later if needed.
- **D. Permanent Shared Drive manager: deferred** (before Paul leaves). Paul is the Manager during setup and migration. The drive and the `observations@` account can be handed to a district owner at any point. The one requirement is that someone else is a Manager before Paul removes himself (last cutover step).
- **E. Manual Drive shares are honored** (phase 3). Sharing a folder by hand is a deliberate, rare act. The sync only ever removes access _the app itself granted_ (tracked per observation), such as when a principal changes buildings. Manual shares stay, and the admin preview lists them as "Shared directly in Drive" so they aren't invisible.
- **F. Reopening keeps observee access** (phase 3). Unchanged from today (`reopenObservation.ts:28`). The observed staff member keeps folder access while an admin corrects a reopened observation.
- **G. Evidence in shared drafts is hidden** (phase 4). When an observer shares evidence with the observed staff member during a Draft, that person sees evidence names but no Drive links until the observation is finalized, because the files aren't shared with them yet.
- **H. Rule shape for co-access: building rules and role rules** (phase 2). Building rules give building administrators access to their building's staff. A role rule gives the Director of Special Services access to staff in the special education roles. Admins enter the actual people and role lists on the new page.
- **I. More than one observer: later.** An observation has one `observerEmail`, and co-access rules cover principal and assistant principal pairs. A true co-observer field (two people editing one observation) is left out of this plan unless a case comes up that rules can't express.

---

## Phase 0 — Workspace setup

_No code · about 1 hour with a Workspace admin._ Done in Google Drive and the Google Admin console, not in the repo.

1. Create a Shared Drive named **Orono Peer Observations**. Paul is the **Manager** for now (moving folders in during phase 5 requires Manager access). A district owner can be added as Manager any time (Decision D).
2. Add `observations@orono.k12.mn.us` as a **Content manager**, not a Manager, so the app can't change membership. Content managers can't permanently delete in a Shared Drive, so phase 1 switches the app's deletes to trash.
3. Shared Drive settings:
   - Allow people outside Orono to access files: **Off**.
   - Allow people who aren't members to access files: **On**. This is required for per-folder sharing.
   - Allow content managers to share folders: **On**. This is required for the app to grant folder access.
4. Create two top-level folders inside the drive: `Observations` and `Modules`. Record both folder IDs.
5. Check the Google Admin console: Drive and Docs → Sharing settings → Shared drive creation must allow the settings above.

## Phase 1 — Make the Drive code Shared Drive–safe

_Small · 1 PR._ Most helpers in `lib/drive.ts` already pass `supportsAllDrives`. A handful of direct API calls don't, and those return 404 on Shared Drive files.

### Add `supportsAllDrives: true` where it's missing

- `apps/functions/src/audio/getAudio.ts:103`: `files.get` for metadata
- `apps/functions/src/transcription/onTranscriptionJobCreated.ts:89`: `files.get` for metadata
- `apps/functions/src/observations/uploadEvidenceFile.ts:186`: orphan-cleanup `files.delete`
- `apps/functions/src/modules/uploadModuleFile.ts`: `files.list` (:90, also needs `includeItemsFromAllDrives`), `files.create` (:99), `permissions.list` (:152), `permissions.create` (:160), `files.delete` (:246)
- `scripts/drive-auth/authorize-drive.ts`: the folder write-check around :196–214 needs the same flag, or authorizing against a Shared Drive folder fails

### Trash instead of permanently deleting

- `deleteDriveFile` (`lib/drive.ts:309`) and `deleteDriveFolder` (`lib/drive.ts:333`) switch to `files.update({ trashed: true })`. Trashing a folder trashes its contents, so the per-child loop goes away. The Shared Drive trash keeps items for 30 days.
- Orphan cleanup in `uploadEvidenceFile.ts:186` and `uploadModuleFile.ts:246` uses `trashDriveFile`.
- Rename the helpers so their names match what they do, and update the Draft-deletion path in `onObservationWritten.ts:293` plus superseded-PDF cleanup in `regenerateObservationPdf.ts:230`.

### Separate module files from observation folders

- Add a `DRIVE_MODULES_FOLDER_ID` param. `uploadModuleFile.ts:208` uses it directly and drops `ensureModuleFolder`. Today modules get a `Modules` subfolder under the observations parent, so they'd end up mixed in with restricted records.
- Module files keep their domain-wide Reader sharing. They are district resources, not evaluation records.

### Remove what no longer applies

- Delete `apps/functions/src/drive/monitorDriveQuota.ts` and its export. It checks the uploader account's personal storage, which Shared Drive files don't use.
- Rewrite the header comment in `lib/drive.ts:7–31` for the new model, and update the `authorize-drive.ts` prompt: "sign in as the uploader account", not "the owner of the parent folder".
- Update the Drive mocks in `finalizeObservation.test.ts` and `regenerateObservationPdf.test.ts`.

## Phase 2 — Co-access mapping in the admin console

_Medium · 1 PR._ Staff records already carry `buildings: string[]` and `role` (`packages/shared/src/schema/staff.ts:47–49`). Rules match on those two fields.

### Data model

New schema `packages/shared/src/schema/observationAccessRule.ts` and collection `COLLECTIONS.observationAccessRules`:

| Field                    | Type                   | Meaning                                                          |
| ------------------------ | ---------------------- | ---------------------------------------------------------------- |
| `label`                  | string                 | Human name, for example "Orono Middle School administrators"     |
| `kind`                   | `'building' \| 'role'` | Which staff field the rule matches                               |
| `buildingIds`            | string[]               | For `building`: matches observed staff in any of these buildings |
| `roleIds`                | string[]               | For `role`: matches observed staff with any of these role slugs  |
| `granteeEmails`          | string[]               | Who gets Reader on matching folders                              |
| `active`                 | boolean                | Turn a rule off without deleting it                              |
| `updatedAt`, `updatedBy` | timestamp, email       | Audit trail                                                      |

Firestore rules: admin read and write only. Add a `match /observationAccessRules/{ruleId}` block to `firestore.rules`.

### Admin page

- Route `/admin/observation-access` in `apps/web/src/App.tsx` (admin block around line 92), plus an entry in `apps/web/src/admin/adminNav`.
- Two groups on the page: **Building administrators** (one rule per building) and **Program oversight** (role-based, for example Director of Special Services → the special education roles).
- A **"Who can open this staff member's observations?"** preview: pick a staff member and see the resolved reader list with the reason for each person, plus anyone listed as "Shared directly in Drive". This is the main way to catch mistakes in the mapping.
- Warn when a grantee email isn't an active staff record.
- Seed the initial rules (principal and assistant principal per building, Director of Special Services over special education roles) by hand in the page, not with a migration. That keeps the mapping owned by admins.

## Phase 3 — Resolve and sync folder access

_Medium–large · 1–2 PRs._

### Resolver: one function decides who can open a folder

- New `apps/functions/src/lib/observationAccess.ts` with a pure `computeFolderReaders({ observation, observedStaff, rules })` that returns a map of each email to its reasons. It applies the access table and decisions B, C and F. Unit-test it heavily: it's the policy.
- A thin `resolveFolderReaders(db, observation)` wrapper loads the observed staff doc and active rules.

### Sync: make Drive match the resolver

New `syncObservationFolderAccess(db, observationId)` in `lib/drive.ts`:

1. Resolve the desired readers.
2. `permissions.list` with `permissionDetails`, skipping inherited permissions (Shared Drive members).
3. Grant missing readers.
4. Remove a permission **only if the app granted it** (its email is in `appGrantedReaders`) and it's no longer in the desired set. Any other direct permission is a manual share and is left alone (Decision E).
5. Write two server-only fields on the observation: `appGrantedReaders: string[]` (what the app granted) and `driveReaders: string[]` (everyone with direct access, manual shares included, for in-app links and audio). The Firestore update allowlist at `firestore.rules:335` already stops clients from writing either.
6. Audit-log grants (`drive_folder_shared`, already defined) and removals (new `drive_folder_unshared`).

Best-effort, like today's `shareObservationFolderWithObserver`: a failure is logged and never fails an upload or finalize. The nightly sweep fixes anything missed.

### Call it everywhere a folder is created or changes state

- `audio/uploadAudio.ts:141`: after the folder is ensured (first upload creates it)
- `observations/uploadEvidenceFile.ts:152`: after the folder claim settles
- `observations/finalizeObservation.ts:287`: replaces the observed-staff `shareWithUser` call
- `observations/regenerateObservationPdf.ts:200–209`: replaces both share calls
- Delete `shareObservationFolderWithObserver` (`lib/drive.ts:283`) once nothing calls it.

### Keep it current

- **A rule changes:** a new `onDocumentWritten` trigger on `observationAccessRules` finds the staff matched by the old or new rule and syncs their observations.
- **A staff member's building or role changes:** extend `auth/onStaffWritten.ts` to sync observations where they're the observed staff member, but only when `buildings` or `role` actually changed.
- **Nightly sweep:** a new scheduled `reconcileDriveAccess` pages through every observation with a `driveFolderId` and syncs it with limited concurrency. At district scale (hundreds of observations a year) it fits comfortably in one run.

## Phase 4 — Match in-app links and audio to the policy

_Small · 1 PR._

> **The audio proxy currently bypasses Drive access.** `getAudio.ts:93–99` lets any user with special access (every Peer Evaluator) stream any recording. Its `role === 'Administrator'` check also compares against display names, but roles are stored as slugs, so that branch never matches.

- `audio/getAudio.ts`: allow playback when the caller is in `observation.driveReaders`, or resolve on the fly if the field is missing. That's the same list Drive enforces.
- Show Drive links only to people on the list, so nobody lands on Drive's request-access page:
  - `routes/StaffPersonPage.tsx:553`: "View PDF"
  - `components/rubric/RubricRow.tsx:916`: evidence chips
  - `observations/ObservationEditorPage.tsx:1704`: "Open Drive folder"
  - `observations/RecentObservationsStrip.tsx:119` and `routes/MyObservationsPage.tsx:206`: PDF links
- **Evidence in shared drafts (Decision G):** when an observer turns on the draft-sharing switch for evidence, the observed staff member sees evidence names in `RubricRow.tsx` but no Drive link until the observation is finalized.

## Phase 5 — Migration and cutover

_Medium · script + ops runbook._

### Migration script

New `scripts/drive-migrate/move-to-shared-drive.ts`, with dry-run by default, `--apply` to execute, and safe to re-run:

1. For every observation with a `driveFolderId`, move the folder into `Observations` with `files.update` (`addParents`/`removeParents`, `supportsAllDrives`). Moving keeps folder and file IDs, so emailed links, the Master Log Sheet and `pdfDriveFileId` keep working.
2. Move module files (`driveFile.driveFileId` on module items) into `Modules`. Their domain-reader sharing carries over.
3. Report each item's current owner first. Folders created before PR #110 may belong to the **service account**, not Paul, and must be moved by whichever identity owns them. The dry run lists these separately.
4. Report anything that fails to move, such as a folder containing files owned by someone else.

> Confirm in the dry run that the Drive API accepts moving _folders_ from My Drive into this Shared Drive under the district's settings. If it doesn't, the fallback is to create a new folder in the Shared Drive, move the files into it (file IDs are kept), and update `driveFolderId`.

### Cutover order

1. Merge and deploy phases 1–4. They work unchanged against the current My Drive folder.
2. Enter the co-access rules in the admin console and check them with the preview.
3. Run the migration script: dry run, review the output, then `--apply`.
4. Set `DRIVE_PARENT_FOLDER_ID` to the Shared Drive `Observations` folder and `DRIVE_MODULES_FOLDER_ID` to `Modules` in `apps/functions/.env.peer-evaluator-rubric`.
5. Run `pnpm drive:authorize` signed in as **`observations@orono.k12.mn.us`**, then redeploy functions.
6. Run `reconcileDriveAccess` manually once so every migrated folder gets its correct reader list. Existing observer and observee grants from before migration are adopted into `appGrantedReaders`, since the app made them, so later changes can remove them normally.
7. Go through the verification checklist.
8. When a district owner has been added as Manager (Decision D, no rush), Paul leaves the Shared Drive membership. Check that his old My Drive parent folder is empty, then delete it.

> **Don't revoke Paul's old Drive token from the app's Google Calendar screen.** Drive and Calendar share one OAuth client, and Google revokes the whole grant at once, so Paul's Calendar connection would break too. Replacing the `DRIVE_OAUTH_REFRESH_TOKEN` secret (step 5) is enough to stop the app acting as Paul.

## Verification checklist

Run with real district accounts after cutover. Each line is one person trying one thing.

- [ ] A Peer Evaluator records audio on a new Draft. In Drive, the folder is in the Shared Drive and has no personal owner.
- [ ] That observer can open the folder. A different Peer Evaluator gets Drive's request-access page and a 403 from audio playback.
- [ ] The building principal and assistant principal for the observed staff member's building can open the folder while it's a Draft.
- [ ] The Director of Special Services can open a special education teacher's folder, but not a general education teacher's.
- [ ] The observed staff member can't open the Draft folder. After finalize, they can open it and play audio in the app.
- [ ] Moving a staff member to another building moves co-access on the next sync, and the old building's administrators lose access.
- [ ] A share added by hand in Drive survives the nightly sweep and shows as "Shared directly in Drive" in the admin preview.
- [ ] During a Draft with evidence shared, the observed staff member sees evidence names but no Drive links.
- [ ] Deleting a Draft sends its folder to the Shared Drive trash. Regenerating a PDF trashes the old PDF.
- [ ] Transcription still completes for new recordings and for recordings made before migration.
- [ ] A newly uploaded module resource opens for an ordinary teacher account.
- [ ] Links in a finalized email sent before migration still open for its recipient.

## Out of scope and risks

### Not doing

- **A folder in each user's own Drive.** Rejected. Files would disappear when staff leave the district, admin actions on someone else's observation would fail without that person's token, and co-access would still need the same sharing sync.
- **Restricting Firestore reads for Peer Evaluators.** The app still lets special-access users list all observation metadata (`firestore.rules:310–316`). That's acceptable by decision; revisit separately if needed.

### Risks

- **Shared Drive members see everything.** The whole plan relies on a short member list. Anyone added as a member "just to help" bypasses the per-folder policy. Put this in the ops docs (`docs/operations.md`).
- **`observations@` is now a single point of failure for email and Drive.** If it's suspended, both stop. If its token is revoked, uploads stop. The existing error message in `lib/drive.ts:80` covers the token case; add the account to the district's "don't suspend" list.
- **Drive API rate limits during the sweep.** Limit concurrency and back off on 403 `rateLimitExceeded`.
- **Moving folders into the Shared Drive may be blocked** by district settings. The dry run finds this before anything changes, and the fallback is described in phase 5.
