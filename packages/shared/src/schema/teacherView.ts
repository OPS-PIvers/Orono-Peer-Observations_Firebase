import { DRAFT_VISIBILITY_HIDDEN, type DraftVisibility } from './observation.js';

/**
 * Teacher view: `/teacherViews/{observationId}`, the copy of an observation
 * the observed staff member is allowed to read. Written only by the
 * `onObservationTeacherView` trigger (and the backfill script), never by
 * clients.
 *
 * Why it exists: rules gate whole documents, so `draftVisibility` on the
 * observation itself can only stop Draft content from rendering, not from
 * arriving in the teacher's browser. The view holds just the fields the
 * teacher may see right now, so reading it instead of the observation keeps
 * hidden Draft content on the server.
 *
 * The projection is an allowlist: a field not named below is never copied,
 * so new observation fields default to hidden.
 */

/** Fields the teacher always sees: who, what, when, the teacher's own
 *  answers, and scheduling / Drive pointers. */
export const TEACHER_VIEW_ALWAYS_FIELDS = [
  'observerEmail',
  'observerName',
  'observerRole',
  'observedEmail',
  'observedName',
  'observedRole',
  'observedYear',
  'observedBuildings',
  'status',
  'type',
  'questionSetId',
  'observationName',
  'observationDate',
  'preObsDate',
  'postObsDate',
  'draftVisibility',
  'workProductAnswers',
  'goalsResponse',
  'coObserverEmails',
  'createdAt',
  'finalizedAt',
  'acknowledgedAt',
  'acknowledgedBy',
  'windowId',
  'slotId',
  'scheduledStartAt',
  'scheduledEndAt',
  'signupDetails',
  'driveFolderId',
  'pdfDriveFileId',
] as const;

/** Fields copied only while the matching `draftVisibility` flag is on.
 *  Mirrors the editor's `show.*` gating in ObservationEditorPage. */
export const TEACHER_VIEW_FLAGGED_FIELDS = {
  ratings: ['observationData'],
  notes: ['componentNotes'],
  evidence: ['evidenceLinks'],
  script: ['scriptDoc', 'componentTags'],
  meetingNotes: ['preObsNotes', 'postObsNotes', 'goalsNextSteps'],
} as const satisfies Record<keyof DraftVisibility, readonly string[]>;

/** Fields that never reach the view. Listed for documentation and tests;
 *  the allowlist above is what actually excludes them. Draft audio is
 *  already blocked for the teacher by functions/src/audio/recordingAccess.ts. */
export const TEACHER_VIEW_NEVER_FIELDS = [
  'transcripts',
  'audioDriveFileIds',
  'audioRecordings',
  'rubricSnapshot',
  'gcalEventIds',
  'acknowledgeReminderSentAt',
  'finalizeStartedAt',
  'lastModifiedAt',
] as const;

const VISIBILITY_FLAGS = [
  'ratings',
  'notes',
  'evidence',
  'script',
  'meetingNotes',
] as const satisfies readonly (keyof DraftVisibility)[];

/** Reads `draftVisibility` from raw data. Missing or non-boolean flags are
 *  off, matching DRAFT_VISIBILITY_HIDDEN. */
function visibilityOf(obs: Record<string, unknown>): DraftVisibility {
  const raw = obs['draftVisibility'];
  const flags: DraftVisibility = { ...DRAFT_VISIBILITY_HIDDEN };
  if (!raw || typeof raw !== 'object') return flags;
  for (const key of VISIBILITY_FLAGS) flags[key] = Reflect.get(raw, key) === true;
  return flags;
}

/**
 * Projects raw observation data (as read from Firestore, unvalidated) onto
 * the teacher view. Absent fields stay absent; nothing is written as
 * `undefined`. `observationId` comes from the document id so the view is
 * correct even for legacy docs that never stored it.
 */
export function teacherViewOf(
  obs: Record<string, unknown>,
  observationId: string,
): Record<string, unknown> {
  const view: Record<string, unknown> = { observationId };
  const copy = (field: string) => {
    const value = obs[field];
    if (value !== undefined) view[field] = value;
  };
  for (const field of TEACHER_VIEW_ALWAYS_FIELDS) copy(field);
  const flags = visibilityOf(obs);
  for (const key of VISIBILITY_FLAGS) {
    if (flags[key]) TEACHER_VIEW_FLAGGED_FIELDS[key].forEach(copy);
  }
  return view;
}
