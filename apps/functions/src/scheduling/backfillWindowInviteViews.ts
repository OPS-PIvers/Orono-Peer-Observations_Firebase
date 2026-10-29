import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@ops/shared';
import { syncWindowInviteViews } from './onObservationWindowInviteViews.js';

if (getApps().length === 0) initializeApp();

/** Marks the backfill done; its presence makes every later run a no-op. */
export const WINDOW_INVITE_VIEWS_BACKFILL_MARKER = `${COLLECTIONS.appSettings}/windowInviteViewsBackfill`;

/** Window ids per page (ids only; each window is re-read when synced). */
const PAGE_SIZE = 200;
/** Windows synced at once. */
const CONCURRENCY = 10;

export interface WindowInviteViewBackfillResult {
  windows: number;
  viewsWritten: number;
  viewsDeleted: number;
}

/**
 * One-time backfill of `/windowInviteViews` for windows that predate the
 * onObservationWindowInviteViews trigger and haven't been written since. The
 * booking page and staff dashboard read these views, so every window needs
 * them before invitees lose read access to the window doc itself.
 *
 * Runs on a schedule rather than by hand so nobody has to run a script
 * against production: the first run after deploy does the work and writes
 * the marker, and every later run sees the marker and returns.
 *
 * Each window goes through the trigger's own syncWindowInviteViews, which
 * re-reads the window and its existing views and only writes what differs,
 * so a window the trigger has already handled is left alone.
 */
export const backfillWindowInviteViews = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 540,
  },
  async () => {
    await runWindowInviteViewBackfill(getFirestore());
  },
);

export async function runWindowInviteViewBackfill(
  db: Firestore,
): Promise<WindowInviteViewBackfillResult | null> {
  const marker = db.doc(WINDOW_INVITE_VIEWS_BACKFILL_MARKER);
  if ((await marker.get()).exists) return null;

  const result: WindowInviteViewBackfillResult = { windows: 0, viewsWritten: 0, viewsDeleted: 0 };
  const windows = db.collection(COLLECTIONS.observationWindows);
  let lastId: string | null = null;

  // Any error propagates and leaves the marker unwritten, so the next run
  // tries again (already-synced windows then write nothing).
  for (;;) {
    let page = windows.orderBy(FieldPath.documentId()).select().limit(PAGE_SIZE);
    if (lastId !== null) page = page.startAfter(lastId);
    const snap = await page.get();
    if (snap.empty) break;

    const ids = snap.docs.map((d) => d.id);
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const synced = await Promise.all(
        ids.slice(i, i + CONCURRENCY).map((id) => syncWindowInviteViews(db, id)),
      );
      for (const { written, deleted } of synced) {
        result.viewsWritten += written;
        result.viewsDeleted += deleted;
      }
    }
    result.windows += snap.size;
    lastId = ids[ids.length - 1] ?? null;
    if (snap.size < PAGE_SIZE) break;
  }

  await marker.set({ ...result, completedAt: FieldValue.serverTimestamp() });
  logger.info('backfillWindowInviteViews: done', { ...result });
  return result;
}
