import type { TiptapDoc, WorkProductAnswer } from '@ops/shared';

/**
 * The observed teacher's own saved answers, held until the copy they read
 * shows them.
 *
 * On a Draft the teacher reads the teacher view, which a Cloud Function
 * rewrites after each observation write, so for a moment after a save it
 * still holds the old answers. Firestore's local echo can't cover that gap
 * (the write goes to /observations, the read comes from /teacherViews).
 * Without this, a second save in that window rewrites the whole answers
 * array from the stale copy and undoes the first, and reopening the
 * observation shows the old text. Each entry is dropped once the copy read
 * from Firestore matches it, so it never outlives the lag.
 *
 * Module state, per observation id: it survives navigating between pages in
 * this tab, which is the case that matters (a save flushes on unmount).
 */
const answers = new Map<string, Map<string, WorkProductAnswer>>();
const goals = new Map<string, TiptapDoc | null>();

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Record answers the teacher just saved to the observation. */
export function rememberSavedAnswers(
  observationId: string,
  saved: readonly WorkProductAnswer[],
): void {
  const mine = answers.get(observationId) ?? new Map<string, WorkProductAnswer>();
  for (const a of saved) mine.set(a.questionId, a);
  answers.set(observationId, mine);
}

/**
 * `stored` with the teacher's own saves laid over any entry the read copy
 * hasn't caught up with yet. Entries the copy now matches are forgotten.
 */
export function withSavedAnswers(
  observationId: string,
  stored: ReadonlyMap<string, WorkProductAnswer>,
): Map<string, WorkProductAnswer> {
  const out = new Map(stored);
  const mine = answers.get(observationId);
  if (!mine) return out;
  for (const [questionId, saved] of mine) {
    if (same(stored.get(questionId)?.answer, saved.answer)) mine.delete(questionId);
    else out.set(questionId, saved);
  }
  if (mine.size === 0) answers.delete(observationId);
  return out;
}

/** Record a Goals response the teacher just saved. */
export function rememberSavedGoals(observationId: string, saved: TiptapDoc | null): void {
  goals.set(observationId, saved);
}

/** The Goals response to show: the teacher's own save until the read copy
 *  matches it, then the stored value. */
export function withSavedGoals(
  observationId: string,
  stored: TiptapDoc | undefined,
): TiptapDoc | undefined {
  if (!goals.has(observationId)) return stored;
  const saved = goals.get(observationId) ?? null;
  if (same(stored, saved)) {
    goals.delete(observationId);
    return stored;
  }
  return saved ?? undefined;
}

/** Test hook: forget everything. */
export function resetPendingTeacherWrites(): void {
  answers.clear();
  goals.clear();
}
