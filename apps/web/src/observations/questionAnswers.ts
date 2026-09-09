import {
  OBSERVATION_STATUS,
  type Observation,
  type QuestionPhase,
  type WorkProductAnswer,
  type WorkProductQuestion,
  postQuestionsUnlocked,
  questionPhase,
  workProductAnswerHasText,
} from '@ops/shared';
import { toJsDate } from '@/utils/staffFormatting';

/**
 * Pure helpers behind the Planning / Reflection panels' question blocks.
 * Everything here is deterministic and table-testable; the React side
 * (`MeetingNotesSection`, `useWorkProductAnswers`) only wires these to
 * state and Firestore.
 */

export interface PhaseQuestions {
  pre: (WorkProductQuestion & { id: string })[];
  post: (WorkProductQuestion & { id: string })[];
}

/** Split a question bank into its Planning (`pre`) and Reflection (`post`) halves,
 *  preserving the caller's ordering within each. */
export function splitQuestionsByPhase(
  questions: readonly (WorkProductQuestion & { id: string })[] | null | undefined,
): PhaseQuestions {
  const out: PhaseQuestions = { pre: [], post: [] };
  for (const q of questions ?? []) {
    out[questionPhase(q)].push(q);
  }
  return out;
}

export interface AnswerProgress {
  answered: number;
  total: number;
}

/** How many of `questions` have a non-empty answer in `answers`. */
export function answerProgress(
  questions: readonly Pick<WorkProductQuestion, 'questionId'>[],
  answers: ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>,
): AnswerProgress {
  const lookup = (id: string): unknown =>
    answers instanceof Map ? answers.get(id) : (answers as Record<string, unknown>)[id];
  let answered = 0;
  for (const q of questions) {
    if (workProductAnswerHasText(lookup(q.questionId))) answered += 1;
  }
  return { answered, total: questions.length };
}

/**
 * Why a phase's answers can or cannot be edited right now.
 *
 * - `editable`: the viewer is the observed staff member and the phase is open.
 * - `not-answerer`: anyone else (the evaluator, an admin) — answers render
 *   read-only for them; the questions are the teacher's to answer.
 * - `locked-until-after`: Reflection before the calendar day after the
 *   observation date (or with no date at all) — see `postQuestionsUnlocked`.
 * - `finalized`: Planning after finalize. Planning answers are printed in the
 *   PDF, so revising them would make the app and the permanent record
 *   disagree. Reflection stays editable after finalize on purpose — the
 *   evaluator may finalize before the teacher has had a chance to reflect.
 */
export type AnswerEditability = 'editable' | 'not-answerer' | 'locked-until-after' | 'finalized';

export interface AnswerEditabilityInput {
  phase: QuestionPhase;
  status: Observation['status'];
  isObservedStaff: boolean;
  observationDate: Date | null;
  now: Date;
}

export function answerEditability({
  phase,
  status,
  isObservedStaff,
  observationDate,
  now,
}: AnswerEditabilityInput): AnswerEditability {
  if (phase === 'post' && !postQuestionsUnlocked(observationDate, now)) {
    return 'locked-until-after';
  }
  if (!isObservedStaff) return 'not-answerer';
  if (phase === 'pre' && status === OBSERVATION_STATUS.finalized) return 'finalized';
  return 'editable';
}

/**
 * True when an answer was saved after the observation was finalized. Only
 * Reflection answers can legitimately be — Planning is locked at finalize —
 * but the check is phase-agnostic so a reader can always tell what changed
 * after the PDF was archived.
 */
export function answeredAfterFinalize(
  answer: Pick<WorkProductAnswer, 'updatedAt'> | undefined,
  finalizedAt: unknown,
): boolean {
  if (!answer) return false;
  // Both stamps arrive raw from Firestore (Timestamp, not Date) — the
  // observation doc is not run through the Zod parser on read.
  const updated = toJsDate(answer.updatedAt);
  const finalized = toJsDate(finalizedAt);
  if (!updated || !finalized) return false;
  return updated.getTime() > finalized.getTime();
}
