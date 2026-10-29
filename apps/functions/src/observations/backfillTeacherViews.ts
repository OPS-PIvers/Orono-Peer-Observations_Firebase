import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, teacherViewOf } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/** Marks the backfill done; its presence makes every later run a no-op. */
export const TEACHER_VIEWS_BACKFILL_MARKER = `${COLLECTIONS.appSettings}/teacherViewsBackfill`;

/** Ids per page: the page query fetches ids only, so this bounds nothing big. */
const PAGE_SIZE = 400;
/** Observations read in full at once. Each can approach Firestore's 1MiB
 *  limit (transcripts, script), so keep this small for a 256MiB instance. */
const CONCURRENCY = 10;

export interface TeacherViewBackfillResult {
  scanned: number;
  created: number;
  alreadyPresent: number;
  /** Deleted between the page read and its transaction. */
  gone: number;
}

/**
 * One-time backfill of `/teacherViews` for observations that predate the
 * onObservationTeacherView trigger and haven't been written since. Teacher
 * pages read Drafts from these views (Draft privacy), so every observation
 * needs one before they switch over.
 *
 * Runs on a schedule rather than by hand so nobody has to run a script
 * against production: the first run after deploy does the work and writes
 * the marker, and every later run sees the marker and returns.
 *
 * Each view is created in a transaction that re-reads its observation, as
 * the trigger re-reads before it writes. Views are only ever created, never
 * overwritten: one that exists came from the trigger, and replacing it could
 * put back content a later sharing change hid. An observation deleted since
 * the page was read gets no view, so none is left behind with nothing to
 * delete it.
 */
export const backfillTeacherViews = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    await runTeacherViewBackfill(getFirestore());
  },
);

export async function runTeacherViewBackfill(
  db: Firestore,
): Promise<TeacherViewBackfillResult | null> {
  const marker = db.doc(TEACHER_VIEWS_BACKFILL_MARKER);
  if ((await marker.get()).exists) return null;

  const result: TeacherViewBackfillResult = { scanned: 0, created: 0, alreadyPresent: 0, gone: 0 };
  const observations = db.collection(COLLECTIONS.observations);
  const views = db.collection(COLLECTIONS.teacherViews);
  let lastId: string | null = null;

  // Any error (other than the outcomes below) propagates and leaves the
  // marker unwritten, so the next run tries again.
  const backfillOne = (id: string) =>
    db.runTransaction(async (tx) => {
      const obs = await tx.get(observations.doc(id));
      const data = obs.data();
      if (!data) return 'gone' as const;
      const viewRef = views.doc(id);
      if ((await tx.get(viewRef)).exists) return 'alreadyPresent' as const;
      tx.create(viewRef, { ...teacherViewOf(data, id), updatedAt: FieldValue.serverTimestamp() });
      return 'created' as const;
    });

  for (;;) {
    // Ids only: the transaction reads each observation in full.
    let page = observations.orderBy(FieldPath.documentId()).select().limit(PAGE_SIZE);
    if (lastId !== null) page = page.startAfter(lastId);
    const snap = await page.get();
    if (snap.empty) break;

    const ids = snap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const outcomes = await Promise.all(ids.slice(i, i + CONCURRENCY).map(backfillOne));
      for (const outcome of outcomes) result[outcome] += 1;
    }
    result.scanned += snap.size;
    lastId = ids[ids.length - 1] ?? null;
    if (snap.size < PAGE_SIZE) break;
  }

  await marker.set({ ...result, completedAt: FieldValue.serverTimestamp() });
  logger.info('backfillTeacherViews: done', { ...result });
  return result;
}
