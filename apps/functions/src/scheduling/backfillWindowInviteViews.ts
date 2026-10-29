import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, OBSERVATION_WINDOW_STATUS } from '@ops/shared';
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
 * Keeps `/windowInviteViews` complete. The booking page and staff dashboard
 * read these views, so every window needs them before invitees lose read
 * access to the window doc itself.
 *
 * First run after deploy: syncs every window (those that predate the
 * onObservationWindowInviteViews trigger) and writes the marker. Every later
 * run re-syncs live windows and windows whose views still say they are live
 * (see resyncOpenWindows). That repairs a view the trigger missed (it runs
 * without retries, which would need a forced deploy), and costs nothing when
 * the views are current, because each sync only writes what differs.
 *
 * Runs on a schedule rather than by hand so nobody has to run a script
 * against production.
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
    const db = getFirestore();
    const backfill = await runWindowInviteViewBackfill(db);
    if (backfill === null) await resyncOpenWindows(db);
  },
);

/**
 * Syncs every window id in `ids`, CONCURRENCY at a time, into `result`.
 * `sync` decides what a failure does (the backfill rethrows, the hourly
 * re-sync logs and moves on).
 */
async function syncAll(
  ids: string[],
  result: WindowInviteViewBackfillResult,
  sync: (id: string) => Promise<{ written: number; deleted: number }>,
): Promise<void> {
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const synced = await Promise.all(ids.slice(i, i + CONCURRENCY).map(sync));
    for (const { written, deleted } of synced) {
      result.viewsWritten += written;
      result.viewsDeleted += deleted;
    }
  }
  result.windows += ids.length;
}

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
    await syncAll(ids, result, (id) => syncWindowInviteViews(db, id));
    lastId = ids[ids.length - 1] ?? null;
    if (snap.size < PAGE_SIZE) break;
  }

  await marker.set({ ...result, completedAt: FieldValue.serverTimestamp() });
  logger.info('backfillWindowInviteViews: done', { ...result });
  return result;
}

/**
 * Re-syncs every window that is still live (open, partially or fully booked;
 * a booking or invite change can still alter it), plus every window whose
 * views still say it is live. The second set catches a dropped event that
 * cancelled, expired or deleted a window: the window no longer matches the
 * first query, but its stale views do. Views that already say cancelled or
 * expired need no checks: a cancelled window can't change, and re-opening an
 * expired one makes it live, so the first query finds it.
 */
export async function resyncOpenWindows(db: Firestore): Promise<WindowInviteViewBackfillResult> {
  const result: WindowInviteViewBackfillResult = { windows: 0, viewsWritten: 0, viewsDeleted: 0 };
  const liveStatuses = [
    OBSERVATION_WINDOW_STATUS.open,
    OBSERVATION_WINDOW_STATUS.partiallyBooked,
    OBSERVATION_WINDOW_STATUS.fullyBooked,
  ];
  const [windowsSnap, viewsSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.observationWindows)
      .where('status', 'in', liveStatuses)
      .select()
      .get(),
    db
      .collection(COLLECTIONS.windowInviteViews)
      .where('status', 'in', liveStatuses)
      .select('windowId')
      .get(),
  ]);
  const ids = new Set(windowsSnap.docs.map((d) => d.id));
  for (const d of viewsSnap.docs) {
    const windowId: unknown = d.get('windowId');
    if (typeof windowId === 'string') ids.add(windowId);
  }
  // One window that keeps failing must not stop the rest being repaired.
  const failed: string[] = [];
  await syncAll([...ids], result, (id) =>
    syncWindowInviteViews(db, id).catch((err: unknown) => {
      failed.push(id);
      logger.error('backfillWindowInviteViews: re-sync failed', { windowId: id, err });
      return { written: 0, deleted: 0 };
    }),
  );
  if (result.viewsWritten > 0 || result.viewsDeleted > 0 || failed.length > 0) {
    logger.warn('backfillWindowInviteViews: repaired stale views', { ...result, failed });
  }
  return result;
}
