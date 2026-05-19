import { z } from 'zod';
import { driveFileRef, email, isoDate, tiptapDoc } from './common.js';
import { staffYear } from './staff.js';
import { componentId, proficiencyLevel } from './rubric.js';
import { OBSERVATION_STATUS, OBSERVATION_TYPES } from '../constants.js';

/**
 * /observations/{observationId} — observation records.
 *
 * Lifecycle: Draft (mutable, only the observer + admins can read/write) →
 * Finalized (immutable; observed staff member gains read access; PDF +
 * Drive folder shared; email sent).
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
  /** Free-text scratch notes (separate from the rich-text componentNotes
   *  map below — that one is for formatted long-form prose). */
  scratchNotes: z.string().default(''),
});
export type ObservationComponentEntry = z.infer<typeof observationComponentEntry>;

/** componentTag — links a Tiptap script paragraph to a rubric component.
 *  Stored alongside the script doc so the editor can render highlights. */
export const componentTag = z.object({
  /** Stable ID assigned by the editor when the tag is created. */
  id: z.string().min(1),
  componentId,
  /** Tiptap document position (start, end) — opaque to consumers. */
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});
export type ComponentTag = z.infer<typeof componentTag>;

/** Work product answers (replaces the deprecated WorkProductAnswers sheet). */
export const workProductAnswer = z.object({
  questionId: z.string().min(1),
  answer: z.string().default(''),
  updatedAt: isoDate,
});
export type WorkProductAnswer = z.infer<typeof workProductAnswer>;

export const observation = z.object({
  observationId: z.string().min(1),

  // Participants (denormalized at create time so historical observations
  // survive role/name changes).
  observerEmail: email,
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

  // Script editor (live note-taking)
  scriptDoc: tiptapDoc.optional(),
  componentTags: z.array(componentTag).default([]),

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
    componentTags: true,
    workProductAnswers: true,
    audioDriveFileIds: true,
    preObsDate: true,
    preObsNotes: true,
    postObsDate: true,
    postObsNotes: true,
  })
  .partial();
export type ObservationUpdateInput = z.infer<typeof observationUpdateInput>;
