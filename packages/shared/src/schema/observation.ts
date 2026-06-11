import { z } from 'zod';
import { driveFileRef, email, isoDate, tiptapDoc } from './common.js';
import { staffYear } from './staff.js';
import { componentId, proficiencyLevel } from './rubric.js';
import { signupFieldAnswer } from './signupField.js';
import { OBSERVATION_STATUS, OBSERVATION_TYPES } from '../constants.js';

/**
 * /observations/{observationId} — observation records.
 *
 * Lifecycle: Draft (mutable by observer + admins; observable staff member has
 * read access to see what's being drafted) → Finalized (immutable; observed
 * staff member can acknowledge; PDF + Drive folder shared; email sent).
 *
 * Per-component state lives in three parallel maps keyed on componentId:
 *   - `observationData` — proficiency selection + look-fors selected
 *   - `componentNotes` — per-component rich-text notes (Tiptap JSON)
 *   - `evidenceLinks` — Drive file refs attached per component
 *
 * The "script" editor is a separate Tiptap doc with paragraph-level
 * componentTags linking script segments back to rubric components.
 *
 * Audio recordings live as Drive files; their ids accumulate in
 * `audioDriveFileIds`. When a transcription job completes, the resulting
 * text lands in `transcripts[audioFileId]`.
 */

export const observationStatus = z.enum([OBSERVATION_STATUS.draft, OBSERVATION_STATUS.finalized]);
export const observationType = z.enum([
  OBSERVATION_TYPES.standard,
  OBSERVATION_TYPES.workProduct,
  OBSERVATION_TYPES.instructionalRound,
]);

/** State stored per rubric component. */
export const observationComponentEntry = z.object({
  proficiency: proficiencyLevel.nullable().default(null),
  selectedLookForIds: z.array(z.string()).default([]),
});
export type ObservationComponentEntry = z.infer<typeof observationComponentEntry>;

/** Work product answers (replaces the deprecated WorkProductAnswers sheet). */
export const workProductAnswer = z.object({
  questionId: z.string().min(1),
  /** Question text snapshotted when the answer is saved, so historical
   *  answers survive the question being edited, deactivated, retyped, or
   *  deleted from the bank. Absent on answers saved before this field
   *  existed — viewers fall back to a generic label for those. */
  questionText: z.string().optional(),
  answer: z.string().default(''),
  updatedAt: isoDate,
});
export type WorkProductAnswer = z.infer<typeof workProductAnswer>;

export const observation = z.object({
  observationId: z.string().min(1),

  // Participants (denormalized at create time so historical observations
  // survive role/name changes).
  observerEmail: email,
  /** Observer's display name, denormalized from the observer's /staff doc at
   *  creation time. Falls back to '' for observations created before this
   *  field was added; consumers should fall back to the email localpart. */
  observerName: z.string().trim().default(''),
  observedEmail: email,
  observedName: z.string().trim().min(1),
  observedRole: z.string().trim().min(1),
  observedYear: staffYear,
  observedBuildings: z.array(z.string()).default([]),

  // Lifecycle
  status: observationStatus.default(OBSERVATION_STATUS.draft),
  type: observationType.default(OBSERVATION_TYPES.standard),

  // Free-form metadata
  observationName: z.string().trim().max(200).default(''),
  observationDate: isoDate,

  // Per-component state
  observationData: z.record(componentId, observationComponentEntry).default({}),
  componentNotes: z.record(componentId, tiptapDoc).default({}),
  evidenceLinks: z.record(componentId, z.array(driveFileRef)).optional(),

  // Script editor (live note-taking); paragraph-level marks link spans back to
  // rubric components. Tags are extracted client-side during rendering, not stored.
  scriptDoc: tiptapDoc.optional(),

  // Work product answers (only when type === 'Work Product')
  workProductAnswers: z.array(workProductAnswer).optional(),

  // Pre/post observation meeting notes (added Phase 2)
  preObsDate: isoDate.optional(),
  preObsNotes: tiptapDoc.optional(),
  postObsDate: isoDate.optional(),
  postObsNotes: tiptapDoc.optional(),

  // Audio + transcripts
  audioDriveFileIds: z.array(z.string()).default([]),
  transcripts: z.record(z.string(), z.string()).default({}),

  // Drive linkage (set on first attachment / on finalize)
  driveFolderId: z.string().nullable().default(null),
  pdfDriveFileId: z.string().nullable().default(null),

  // Audit timestamps
  createdAt: isoDate,
  lastModifiedAt: isoDate,
  finalizedAt: isoDate.nullable().default(null),

  /** Set when the observed staff member acknowledges the finalized
   *  observation from their dashboard. Only writable by the observed
   *  staff member, and only after `status === 'Finalized'`. */
  acknowledgedAt: isoDate.nullable().default(null),
  acknowledgedBy: email.optional(),

  // Scheduling linkage (set server-side when an observation is created from
  // a booked slot; null/empty for manually-created observations).
  windowId: z.string().nullable().default(null),
  slotId: z.string().nullable().default(null),
  scheduledStartAt: isoDate.nullable().default(null),
  scheduledEndAt: isoDate.nullable().default(null),
  /** Google Calendar event ids, per attendee calendar. */
  gcalEventIds: z
    .object({ observer: z.string().optional(), observed: z.string().optional() })
    .default({}),
  /** Answers to the window's sign-up detail fields, captured at booking. */
  signupDetails: z.array(signupFieldAnswer).default([]),
});
export type Observation = z.infer<typeof observation>;

/** Subset accepted from the create-observation form. Most state defaults
 *  on the server; the client only chooses participants + type. */
export const observationCreateInput = z.object({
  observedEmail: email,
  type: observationType.default(OBSERVATION_TYPES.standard),
  observationName: z.string().trim().max(200).default(''),
  observationDate: isoDate.optional(),
});
export type ObservationCreateInput = z.infer<typeof observationCreateInput>;

/** Partial used by autosave. Server validates that mutating fields are
 *  allowed in the current status (e.g., no finalize-only fields can move
 *  if status is Draft). */
export const observationUpdateInput = observation
  .pick({
    observationName: true,
    observationDate: true,
    observationData: true,
    componentNotes: true,
    evidenceLinks: true,
    scriptDoc: true,
    workProductAnswers: true,
    audioDriveFileIds: true,
    preObsDate: true,
    preObsNotes: true,
    postObsDate: true,
    postObsNotes: true,
  })
  .partial();
export type ObservationUpdateInput = z.infer<typeof observationUpdateInput>;

/**
 * Parse the recorded-at timestamp from an audio filename minted by uploadAudio.
 * Filenames follow the pattern `audio-YYYY-MM-DDTHH-mm-ss.<ext>` where the
 * timestamp portion encodes the UTC instant the recording was captured.
 *
 * Returns a Date object at the parsed timestamp, or null if the filename
 * does not match the expected pattern (e.g., hand-created or from an older version).
 */
// Pattern: audio-2026-06-10T14-30-45.webm
// Capture: audio-<YYYY>-<MM>-<DD>T<HH>-<mm>-<ss>.<ext>
const AUDIO_RECORDED_AT_RE = /^audio-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\./;

export function parseAudioRecordedAt(fileName: string): Date | null {
  const match = AUDIO_RECORDED_AT_RE.exec(fileName);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, min, sec] = match.map(Number);
  const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000Z`;
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? null : date;
}
