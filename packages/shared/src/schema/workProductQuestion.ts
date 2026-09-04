import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * Which observation type a question is filed under — one entry per member of
 * `OBSERVATION_TYPES`. Every observation type carries its own pre/post
 * reflection questions, Standard included; this list must stay in step with
 * `OBSERVATION_TYPES` in constants.ts.
 */
export const QUESTION_TYPES = ['standard', 'work-product', 'instructional-round'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * /workProductQuestions/{id} — the reflection question bank the observed staff
 * member answers, filed by observation type.
 *
 * The collection keeps its migrated name (from the GAS WorkProductQuestions
 * sheet) because renaming a live Firestore collection buys nothing but a
 * migration. `type` below, not the collection name, decides which observations
 * a question belongs to — and that includes Standard observations, which have
 * pre/post questions exactly as Work Product and Instructional Round do.
 */
export const workProductQuestion = z.object({
  questionId: slugId,
  text: z.string().trim().min(1),
  /** Display order. Lower = earlier in the form. */
  order: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
  /** Which observation type this question belongs to. Defaults to 'work-product'
   *  so existing docs without this field parse correctly. */
  type: z.enum(QUESTION_TYPES).default('work-product'),
  /**
   * When the teacher answers this question, relative to the observation
   * itself. `pre` questions are answerable from the moment the observation is
   * created; `post` questions unlock once the observation date has passed (see
   * `postQuestionsUnlocked`). Defaults to 'pre' so every question written
   * before the split keeps its existing always-available behaviour.
   */
  phase: z.enum(['pre', 'post']).default('pre'),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type WorkProductQuestion = z.infer<typeof workProductQuestion>;

export const workProductQuestionInput = workProductQuestion.omit({
  createdAt: true,
  updatedAt: true,
});
export type WorkProductQuestionInput = z.infer<typeof workProductQuestionInput>;

/** Ordered phases, for rendering the two sections and the admin selector. */
export const QUESTION_PHASES = ['pre', 'post'] as const;
export type QuestionPhase = (typeof QUESTION_PHASES)[number];

/**
 * Are a staff member's post-observation questions open yet?
 *
 * The gate is the observation date, not the status: an observation stays
 * `Draft` until the evaluator finalizes it, which can be days later, and the
 * teacher's post-reflection is meant to be written while the lesson is fresh.
 * Comparing calendar days (not timestamps) means the questions open the moment
 * the day after the observation begins, rather than 24 hours after whatever
 * time was stored.
 *
 * An observation with no date recorded keeps its post questions closed — there
 * is nothing to be "after" yet.
 */
export function postQuestionsUnlocked(observationDate: Date | null, now: Date): boolean {
  if (!observationDate) return false;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return day(now) > day(observationDate);
}

/**
 * Read `type` / `phase` off a question that came straight from Firestore.
 *
 * `useFirestoreCollection` hands back raw document data without running the
 * Zod parser, so the `.default()`s above never fire on read: a question
 * written before one of these fields existed genuinely arrives without it,
 * even though the inferred type promises otherwise. These helpers apply the
 * default at the read edge and keep the narrowing — and the reason it is
 * needed — in one place instead of scattering `?? 'pre'` across call sites
 * where the linter can only see the (lying) type.
 */
export function questionPhase(q: Pick<WorkProductQuestion, 'phase'>): QuestionPhase {
  return (q as Partial<Pick<WorkProductQuestion, 'phase'>>).phase ?? 'pre';
}

export function questionType(q: Pick<WorkProductQuestion, 'type'>): QuestionType {
  return (q as Partial<Pick<WorkProductQuestion, 'type'>>).type ?? 'work-product';
}
