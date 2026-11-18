import { effectiveDraftVisibility, type DraftVisibility } from './observation.js';

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
 *  Mirrors the editor's `show.*` gating in ObservationEditorPage.
 *  `observationData` is shared field by field instead (see
 *  observationDataFor): proficiency and scratch notes with `ratings`,
 *  look-fors with `lookFors`. */
export const TEACHER_VIEW_FLAGGED_FIELDS = {
  notes: ['componentNotes'],
  evidence: ['evidenceLinks'],
  script: ['scriptDoc', 'componentTags'],
  meetingNotes: ['preObsNotes', 'postObsNotes', 'goalsNextSteps'],
} as const satisfies Record<
  Exclude<keyof DraftVisibility, 'ratings' | 'lookFors'>,
  readonly string[]
>;

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

const FLAGGED_KEYS = Object.keys(
  TEACHER_VIEW_FLAGGED_FIELDS,
) as (keyof typeof TEACHER_VIEW_FLAGGED_FIELDS)[];

/** The part of each `observationData` entry the switches share: the whole
 *  entry when both are on, `proficiency` + `scratchNotes` for `ratings`
 *  alone, `selectedLookForIds` for `lookFors` alone. Undefined when neither
 *  is on or there is no data. */
function observationDataFor(
  data: unknown,
  ratings: boolean,
  lookFors: boolean,
): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  if (!ratings && !lookFors) return undefined;
  if (ratings && lookFors) return data as Record<string, unknown>;
  const keep = ratings ? ['proficiency', 'scratchNotes'] : ['selectedLookForIds'];
  const out: Record<string, unknown> = {};
  for (const [componentId, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') continue;
    const picked: Record<string, unknown> = {};
    for (const field of keep) {
      const value: unknown = Reflect.get(entry, field);
      if (value !== undefined) picked[field] = value;
    }
    out[componentId] = picked;
  }
  return out;
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
  const flags = effectiveDraftVisibility(obs['draftVisibility']);
  for (const key of FLAGGED_KEYS) {
    if (flags[key]) TEACHER_VIEW_FLAGGED_FIELDS[key].forEach(copy);
  }
  const observationData = observationDataFor(obs['observationData'], flags.ratings, flags.lookFors);
  if (observationData !== undefined) view['observationData'] = observationData;
  return view;
}
