# Admin observation updates — spec (from grill session, 2026-09-30)

## 1. Building admins create Standard observations only
- `CreateObservationDialog.tsx` and `CreateObservationWindowDialog.tsx`: for role `administrator`, hide the type picker and always use `Standard`.
- Hide the Work Product and Instructional Round badges, filters and labels in the admin's views: `StaffPersonPage`, `ObservationsListPage`, `NewObservationPage`, `ObservationEditorPage` and the admin's sidebar.
- `firestore.rules`: when a building admin creates an observation, the rules require `type == 'Standard'`. Add a rules test.
- `bookObservationSlot`: an admin-owned window must produce Standard observations.

## 2. Building-specific planning and reflection questions
- New data: each question set is scoped to one of:
  - the district admin default, or
  - a single building. A building set has the setting "Applies to: Admin observations only | All observations in this building".
- Resolving which set to use:
  - **Admin-led observation:** the admin picks the building at creation. It defaults automatically when only one building overlaps. Use that building's set, or the district admin default if the building has none.
  - **Peer evaluator observation:** use the teacher's building set only if its setting is "All". If more than one of the teacher's buildings qualifies, the PE picks at creation. Otherwise use today's global Standard questions.
- Store the chosen `questionBuildingId` on the observation.
- Editing permissions:
  - The Admin Console (`WorkProductPage`) can edit the district admin default and any building's set.
  - Building admins get a new "Observation Settings" page (sidebar, `requireAdministrator`). There they can add, edit, reorder and deactivate Planning and Reflection questions for their own buildings only. They cannot change the "Applies to" setting.
  - Firestore rules scope building-admin writes to their own buildings.
- Draft observations show the live set. Once the teacher answers, each answer keeps the question text it was written against, so later edits never change or orphan past responses.

## 3. Script tags visible in component notes
- The Notes chip gets a tag icon with a count badge (desktop `CellChip` and mobile `MobileSectionRow`). It shows whenever `extractTaggedSpansForComponent` returns more than 0 tags and never clears on view. It is separate from the red dot for manual notes.
- `NotesPanel` opens on the "Script tags (N)" tab when tags exist.

## 4. Recordings list in the audio popover
- Every recording is listed with its recorded date/time, duration and an editable label. Each has these actions: Play, Download, View in Drive, Rename and Delete.
- New per-recording metadata on the observation, keyed by Drive file ID: `{recordedAt, durationSec, label}`. Duration is measured on the client and sent with the upload. For existing recordings, fall back to the Drive file's `createdTime`.
- **Download:** fetch from `getAudio`, then save the blob as `<teacher>-<date>-<label>.webm`.
- **View in Drive:** a new callable grants the observer viewer access to that file (using `shareWithUser`) and returns a `webViewLink`, which opens in a new tab.
- **Delete:** confirm first. A new callable `removeRecording`, modeled on `removeEvidenceFile`:
  - Only the observer can call it, and only while the observation is in Draft.
  - It moves the Drive file to trash, removes the ID from `audioDriveFileIds`, and deletes the metadata and transcript.
- **Rename:** a callable, or add the metadata field to the observer's update whitelist.

## 5. "View as" a staff member (read-only)
- Building admins can view as any staff member in their assigned buildings who doesn't hold a special role. They start it from My Staff or Building Staff. Console admins can view as anyone.
- While viewing as someone, the app renders what that person sees: their dashboard, observations and sidebar. A persistent banner shows with an Exit button.
- All writes are blocked in the UI. Rules are unchanged: the admin keeps their own identity, and reads rely on their existing access.
- Each view-as session start is written to the audit log.
- To confirm during build: can the admin's read access cover every read that staff views need? This matters especially for staff-only queries such as `where observedEmail == me`, which will be rewritten to use the viewed person's email.

## 6. PDF rubric layout
- Change `apps/pdf-renderer/src/template.ts` `.proficiency-grid` to 4 columns (one row per component) in portrait. Tighten the font size and padding so all four levels fit.

## 7. Finalized-observation email with acknowledgment
- Keep the existing `observation.finalized` email from observations@. Add an "Acknowledge receipt" button that links to `/observations/:id?ack=1`.
- After sign-in, the page shows a confirmation prompt. One click runs the existing acknowledge logic.
- Notify the observer by email when the staff member acknowledges, via a new template trigger `observation.acknowledged`.
- Send a reminder if the observation isn't acknowledged after N days. The proposed default is 7 days, one reminder, handled by a scheduled function. Add a trigger `observation.acknowledgeReminder`.
- Attach the finalized PDF to the email. Fall back to a link if the PDF isn't ready or is too large.
