import { z } from 'zod';
import { email, isoDate } from './common.js';

/**
 * A peer evaluator's manual check-off of one dashboard step for one staff
 * member. Doc presence = checked; un-checking deletes the doc. Written only
 * by the `setStepCheck` callable (rules deny client writes).
 *
 * Stored at either
 *   /observations/{observationId}/stepChecks/{stepId}  — observation-tied steps
 *   /staff/{email}/stepChecks/{stepId}                 — everything else
 * depending on `stepCheckScope(step)` (dashboard.ts). The doc id is the
 * step id.
 */
export const stepCheck = z.object({
  stepId: z.string().min(1),
  checkedBy: email,
  /** Denormalized so the observed staff member's dashboard can show who
   *  checked it without read access to the evaluator's /staff doc. */
  checkedByName: z.string().default(''),
  checkedAt: isoDate,
});
export type StepCheck = z.infer<typeof stepCheck>;

/** Input for the special-access `setStepCheck` callable. `observationId` is
 *  required for observation-tied steps and rejected for staff-scoped ones. */
export const setStepCheckInput = z.object({
  staffEmail: email,
  stepId: z.string().min(1).max(200),
  observationId: z.string().min(1).max(200).optional(),
  checked: z.boolean(),
});
export type SetStepCheckInput = z.infer<typeof setStepCheckInput>;
