import { httpsCallable } from 'firebase/functions';
import type { TiptapDoc, WorkProductAnswer } from '@ops/shared';
import { functions } from '@/lib/firebase';
import { toJsDate } from '@/utils/staffFormatting';

const saveTeacherResponseFn = httpsCallable<
  { observationId: string; workProductAnswers?: unknown[]; goalsResponse?: TiptapDoc | null },
  { ok: true }
>(functions, 'saveTeacherResponse');

let queue: Promise<unknown> = Promise.resolve();

/**
 * Save the observed teacher's answers and/or Goals & Next Steps response
 * through the saveTeacherResponse callable (the rules no longer let the
 * teacher write a Draft directly; see that callable for why).
 *
 * Each save rewrites the whole field, so saves run one at a time in the
 * order issued, as Firestore's own write queue did: separate calls could
 * otherwise land out of order and an older save undo a newer one.
 */
export function saveTeacherResponse(
  observationId: string,
  patch: { workProductAnswers?: readonly WorkProductAnswer[]; goalsResponse?: TiptapDoc | null },
): Promise<void> {
  const data = {
    observationId,
    ...(patch.workProductAnswers
      ? {
          // Stored answers hold Firestore Timestamps, which don't survive
          // the callable wire; a Date goes over as an ISO string.
          workProductAnswers: patch.workProductAnswers.map((a) => ({
            ...a,
            updatedAt: toJsDate(a.updatedAt) ?? a.updatedAt,
          })),
        }
      : {}),
    ...(patch.goalsResponse !== undefined ? { goalsResponse: patch.goalsResponse } : {}),
  };
  const run = queue.then(() => saveTeacherResponseFn(data)).then(() => undefined);
  queue = run.catch(() => undefined);
  return run;
}
