import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, teacherViewOf } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/** Marks the backfill done; its presence makes every later run a no-op. */
export const TEACHER_VIEWS_BACKFILL_MARKER = `${COLLECTIONS.appSettings}/teacherViewsBackfill`;

const PAGE_SIZE = 400;

/** Firestore's ALREADY_EXISTS gRPC status. */
const ALREADY_EXISTS = 6;

export interface TeacherViewBackfillResult {
  scanned: number;
  created: number;
  alreadyPresent: number;
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
 * Views are only ever created, never overwritten: a view that exists was
 * written by the trigger from a newer read of its observation than this
 * page, so replacing it could put back content a later sharing change hid.
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

  const result: TeacherViewBackfillResult = { scanned: 0, created: 0, alreadyPresent: 0 };
  const views = db.collection(COLLECTIONS.teacherViews);
  let lastId: string | null = null;

  for (;;) {
    let page = db
      .collection(COLLECTIONS.observations)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (lastId !== null) page = page.startAfter(lastId);
    const snap = await page.get();
    if (snap.empty) break;

    const outcomes = await Promise.allSettled(
      snap.docs.map((d) =>
        views.doc(d.id).create({
          ...teacherViewOf(d.data(), d.id),
          updatedAt: FieldValue.serverTimestamp(),
        }),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') result.created += 1;
      else if (Reflect.get(Object(outcome.reason), 'code') === ALREADY_EXISTS) {
        result.alreadyPresent += 1;
      } else {
        // Leave the marker unwritten so the next run tries again.
        throw outcome.reason;
      }
    }
    result.scanned += snap.size;
    lastId = snap.docs[snap.docs.length - 1]?.id ?? null;
    if (snap.size < PAGE_SIZE) break;
  }

  await marker.set({ ...result, completedAt: FieldValue.serverTimestamp() });
  logger.info('backfillTeacherViews: done', { ...result });
  return result;
}
