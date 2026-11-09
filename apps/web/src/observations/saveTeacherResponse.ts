import { FunctionsError, httpsCallable } from 'firebase/functions';
import type { TiptapDoc, WorkProductAnswer } from '@ops/shared';
import { functions } from '@/lib/firebase';
import { toJsDate } from '@/utils/staffFormatting';

const saveTeacherResponseFn = httpsCallable<
  { observationId: string; workProductAnswers?: unknown[]; goalsResponse?: TiptapDoc | null },
  { ok: true }
>(functions, 'saveTeacherResponse');

/** Failures worth another attempt: the network, a cold start, an overloaded
 *  instance. A refusal or bad input fails the same way every time. */
const TRANSIENT = new Set([
  'functions/unavailable',
  'functions/internal',
  'functions/deadline-exceeded',
  'functions/resource-exhausted',
  'functions/unknown',
]);
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

const queues = new Map<string, Promise<unknown>>();

async function callWithRetry(data: Parameters<typeof saveTeacherResponseFn>[0]): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await saveTeacherResponseFn(data);
      return;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !(err instanceof FunctionsError) || !TRANSIENT.has(err.code)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Save the observed teacher's answers and/or Goals & Next Steps response
 * through the saveTeacherResponse callable (the rules no longer let the
 * teacher write a Draft directly; see that callable for why).
 *
 * Each save rewrites the whole field, so saves of the same field on the same
 * observation run one at a time in the order issued, as Firestore's own
 * write queue did: separate calls could otherwise land out of order and an
 * older save undo a newer one. Like that queue, a save that fails on a
 * transient error is retried, so an edit flushed as the page unmounts
 * (where no one sees an error) isn't lost to a network blip.
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
  const key = `${observationId}:${Object.keys(data).sort().join(',')}`;
  const run = (queues.get(key) ?? Promise.resolve()).then(() => callWithRetry(data));
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}
