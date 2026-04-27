import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * /workProductQuestions/{id} — the question bank shown when a peer evaluator
 * creates a Work Product observation.
 *
 * Migrated from the GAS WorkProductQuestions sheet. Admin-editable in v1.
 */
export const workProductQuestion = z.object({
  questionId: slugId,
  text: z.string().trim().min(1),
  /** Display order. Lower = earlier in the form. */
  order: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type WorkProductQuestion = z.infer<typeof workProductQuestion>;

export const workProductQuestionInput = workProductQuestion.omit({
  createdAt: true,
  updatedAt: true,
});
export type WorkProductQuestionInput = z.infer<typeof workProductQuestionInput>;
