import { z } from 'zod';
import { driveFileRef, email, isoDate, tiptapDoc } from './common.js';
import { staffYear } from './staff.js';
import { componentId, proficiencyLevel, rubricDomain } from './rubric.js';
import { signupFieldAnswer } from './signupField.js';
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

/** Work product answers (replaces the deprecated WorkProductAnswers sheet).
 *  `answer` is a Tiptap JSON document for anything answered through the
 *  current rich-text form; it stays a plain string for legacy answers saved
 *  before the Tiptap upgrade so older observations keep parsing/rendering
 *  without a data migration. */
export const workProductAnswer = z.object({
  questionId: z.string().min(1),
  answer: z.union([z.string(), tiptapDoc]).default(''),
  updatedAt: isoDate,
});
export type WorkProductAnswer = z.infer<typeof workProductAnswer>;

/** True iff a work product answer has non-empty content, whether stored as
 *  a legacy plain string or a Tiptap JSON document. Accepts `unknown` so
 *  callers reading raw (unvalidated) Firestore data can use it directly. */
export function workProductAnswerHasText(answer: unknown): boolean {
  if (answer == null) return false;
  if (typeof answer === 'string') return answer.trim() !== '';
  return tiptapNodeHasText(answer);
}

function tiptapNodeHasText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as { type?: unknown; text?: unknown; content?: unknown };
  if (n.type === 'text' && typeof n.text === 'string' && n.text.trim() !== '') return true;
  if (Array.isArray(n.content)) return n.content.some(tiptapNodeHasText);
  return false;
}

/** Frozen copy of the rubric content an observation was scored against,
 *  captured server-side at finalize time (finalizeObservation). Domains are
 *  resolved to the components actually in play for the observed role/year
 *  (falling back to the full rubric when no mapping narrows it) so the
 *  finalized read-only view renders the historical criteria text even after
 *  the live rubric is edited. Cleared on reopen — re-finalizing re-captures
 *  it. Absent/null on legacy finalized docs, which fall back to the live
 *  rubric. */
export const observationRubricSnapshot = z.object({
  rubricId: z.string().min(1),
  displayName: z.string().trim().min(1),
  domains: z.array(rubricDomain).min(1),
  /** Flattened component ids of `domains`, in display order. */
  assignedComponentIds: z.array(componentId).default([]),
  capturedAt: isoDate,
});
export type ObservationRubricSnapshot = z.infer<typeof observationRubricSnapshot>;

export const observation = z.object({
  observationId: z.string().min(1),

  // Participants (denormalized at create time so historical observations
  // survive role/name changes).
  observerEmail: email,
  /** Observer's display name, denormalized at create time so the observed
   *  staff member's dashboard can show who their PE is without needing read
   *  access to the observer's /staff doc. Empty on legacy docs. */
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

  /** Rubric content frozen at finalize time — see observationRubricSnapshot. */
  rubricSnapshot: observationRubricSnapshot.nullable().default(null),

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

/** Input for the admin-only reopenObservation callable, which flips a
 *  Finalized observation back to Draft so mistakes can be corrected and the
 *  observation re-finalized (regenerating + re-sharing the PDF). */
export const reopenObservationInput = z.object({
  observationId: z.string().min(1),
  /** Optional reason, recorded in the audit log. */
  reason: z.string().trim().max(500).default(''),
});
export type ReopenObservationInput = z.infer<typeof reopenObservationInput>;

/** Input for the removeEvidenceFile callable (observer-or-admin, draft-only
 *  unless admin — see removeEvidenceFile.ts for the full precondition). */
export const removeEvidenceFileInput = z.object({
  observationId: z.string().min(1),
  componentId: z.string().min(1),
  driveFileId: z.string().min(1),
});
export type RemoveEvidenceFileInput = z.infer<typeof removeEvidenceFileInput>;

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
