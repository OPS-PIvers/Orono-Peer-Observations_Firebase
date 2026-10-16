import type { Firestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  QUESTION_TYPE_BY_OBSERVATION_TYPE,
  questionsForObservation,
  questionPhase,
  toDate as sharedToDate,
  workProductAnswerHasText,
  type AppSettings,
  type Branding,
  type DriveFileRef,
  type Observation,
  type WorkProductQuestion,
} from '@ops/shared';

/**
 * Inputs to the pdf-renderer shared by finalizeObservation and
 * regenerateObservationPdf, so a regenerated PDF prints the same dates,
 * questions and branding the original finalize did.
 */

export interface PdfQuestionsAndBranding {
  workProductQuestions: Pick<WorkProductQuestion, 'questionId' | 'text' | 'phase'>[];
  branding?: Pick<Branding, 'appName' | 'logoUrl' | 'primaryColor'>;
}

/**
 * Coerce a Firestore value to a real `Date`. Date fields are typed `Date` but
 * arrive from the Admin SDK as `Timestamp`s at runtime; left as-is they survive
 * the gaxios JSON POST to the pdf-renderer as `{_seconds,_nanoseconds}` blobs
 * the template can't format.
 */
export function toDate(value: unknown): Date | undefined {
  return sharedToDate(value) ?? undefined;
}

/**
 * Build the observation payload for the pdf-renderer: swap the role slug for its
 * display name and normalize every rendered date to a real `Date`. Finalize
 * passes `finalizedAt` (the doc's own value is still unset at render time); a
 * regenerate keeps the existing `finalizedAt` (the observation is already
 * Finalized), falling back to now only if it is somehow unset.
 */
export function toRendererObservation(
  obs: Observation & { id: string },
  roleDisplayName: string,
  finalizedAt?: Date,
): Observation {
  const normalized: Observation = {
    ...obs,
    observationId: obs.id,
    observedRole: roleDisplayName,
    observationDate: toDate(obs.observationDate) ?? obs.observationDate,
    finalizedAt: finalizedAt ?? toDate(obs.finalizedAt) ?? new Date(),
  };
  const preObsDate = toDate(obs.preObsDate);
  if (preObsDate) normalized.preObsDate = preObsDate;
  const postObsDate = toDate(obs.postObsDate);
  if (postObsDate) normalized.postObsDate = postObsDate;
  if (obs.evidenceLinks) {
    normalized.evidenceLinks = Object.fromEntries(
      Object.entries(obs.evidenceLinks).map(([cId, refs]): [string, DriveFileRef[]] => [
        cId,
        refs.map((ref) => ({ ...ref, uploadedAt: toDate(ref.uploadedAt) ?? ref.uploadedAt })),
      ]),
    );
  }
  return normalized;
}

/**
 * Load the question texts the PDF prints the reflection answers under, plus
 * the admin-configured branding.
 */
export async function loadPdfQuestionsAndBranding(
  db: Firestore,
  obs: Observation,
): Promise<PdfQuestionsAndBranding> {
  // Every observation type stores its reflection answers as Q&A keyed on
  // questionId. Fetch the observation's question set so the PDF can print
  // each answer under its question text. Every question of the set is
  // fetched (not just active ones) so answers to since-deactivated
  // questions still make it into the permanent record; an answer whose
  // question was deleted prints under the text it was written against.
  const questionType = QUESTION_TYPE_BY_OBSERVATION_TYPE[obs.type];
  let workProductQuestions: Pick<WorkProductQuestion, 'questionId' | 'text' | 'phase'>[] = [];
  {
    const questionsSnap = await db
      .collection(COLLECTIONS.workProductQuestions)
      .where('type', '==', questionType)
      .get();
    const answered = (obs.workProductAnswers ?? []).filter((a) =>
      workProductAnswerHasText(a.answer),
    );
    const answeredIds = new Set(answered.map((a) => a.questionId));
    const inSet = questionsForObservation(
      questionsSnap.docs.map((doc) => doc.data() as WorkProductQuestion),
      obs,
    );
    const known = new Set(inSet.map((q) => q.questionId));
    workProductQuestions = [
      ...inSet
        .filter((q) => q.isActive || answeredIds.has(q.questionId))
        .sort((a, b) => a.order - b.order)
        .map((q) => ({ questionId: q.questionId, text: q.text, phase: questionPhase(q) })),
      ...answered
        .filter((a) => !known.has(a.questionId) && a.questionText)
        .map((a) => ({
          questionId: a.questionId,
          text: a.questionText ?? '',
          phase: a.questionPhase ?? ('post' as const),
        })),
    ];
  }

  // Thread admin-configured branding into the PDF so the archived
  // record matches the web app / finalized-observation email header.
  // Missing/unset appSettings is fine — the renderer falls back to the
  // packaged OPS look.
  const appSettingsSnap = await db.doc(`${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`).get();
  const branding = (appSettingsSnap.data() as AppSettings | undefined)?.branding;

  return { workProductQuestions, ...(branding ? { branding } : {}) };
}
