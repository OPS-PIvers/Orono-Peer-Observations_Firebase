import { onDocumentWritten, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import type { Change, DocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, windowInviteViewsOf } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Keeps `/windowInviteViews/{windowId}_{email}` in step with its window: one
 * view per invitee holding only that invitee's entries (see
 * packages/shared/src/schema/windowInviteView.ts for why it exists).
 */
export const onObservationWindowInviteViews = onDocumentWritten(
  {
    document: 'observationWindows/{windowId}',
    region: 'us-central1',
    memory: '256MiB',
    // No `retry`: it makes non-interactive deploys demand --force. A dropped
    // event is repaired within the hour by backfillWindowInviteViews, which
    // re-syncs every live window and every window whose views still say it is
    // (so a missed cancel, fill or delete is caught too).
  },
  (event) => handleWindowInviteViews(event),
);

/** JSON with sorted keys and Timestamps as millis, so a stored view and a
 *  fresh projection compare equal when their content is equal. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object') {
      const toMillis: unknown = Reflect.get(v, 'toMillis');
      if (typeof toMillis === 'function') {
        const millis: unknown = toMillis.call(v);
        return { __millis: millis };
      }
      if (!Array.isArray(v)) {
        return Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        );
      }
    }
    return v;
  });
}

/**
 * Brings every view of one window in line with the window as it is now:
 * writes views whose content changed, deletes views of people no longer
 * invited (or of a deleted window). Shared by the trigger and the backfill.
 *
 * Runs in a transaction: two syncs of the same window can overlap (two
 * bookings a moment apart), and without one the sync that read the older
 * window could commit last and leave a view stale for good. In a
 * transaction the stale one is retried against the current window.
 * Returns the number of views written and deleted.
 */
export async function syncWindowInviteViews(
  db: Firestore,
  windowId: string,
): Promise<{ written: number; deleted: number }> {
  const viewsCol = db.collection(COLLECTIONS.windowInviteViews);
  const windowRef = db.collection(COLLECTIONS.observationWindows).doc(windowId);

  return db.runTransaction(async (tx) => {
    const windowSnap = await tx.get(windowRef);
    const existingSnap = await tx.get(viewsCol.where('windowId', '==', windowId));
    const data = windowSnap.data();
    const desired = data
      ? windowInviteViewsOf(data, windowId)
      : new Map<string, Record<string, unknown>>();

    const existingById = new Map<string, Record<string, unknown>>();
    for (const d of existingSnap.docs) {
      const view = d.data();
      delete view['updatedAt'];
      existingById.set(d.id, view);
    }

    let written = 0;
    let deleted = 0;
    for (const [id, view] of desired) {
      const existing = existingById.get(id);
      if (existing && stableStringify(existing) === stableStringify(view)) continue;
      tx.set(viewsCol.doc(id), { ...view, updatedAt: FieldValue.serverTimestamp() });
      written += 1;
    }
    for (const id of existingById.keys()) {
      if (desired.has(id)) continue;
      tx.delete(viewsCol.doc(id));
      deleted += 1;
    }
    return { written, deleted };
  });
}

/**
 * Core handler, extracted from the onDocumentWritten wrapper so it can be
 * unit-tested with a plain event object.
 */
export async function handleWindowInviteViews(
  event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { windowId: string }>,
): Promise<void> {
  const { windowId } = event.params;
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  // Most window writes (the evaluator-time ledger, timestamps) change
  // nothing an invitee sees; skip those without reading anything.
  if (
    before &&
    after &&
    stableStringify([...windowInviteViewsOf(before, windowId)]) ===
      stableStringify([...windowInviteViewsOf(after, windowId)])
  ) {
    return;
  }

  // Trigger events can arrive out of order, so sync against the window as
  // it is now rather than as this event saw it.
  const { written, deleted } = await syncWindowInviteViews(getFirestore(), windowId);
  if (written > 0 || deleted > 0) {
    logger.info('onObservationWindowInviteViews: views synced', { windowId, written, deleted });
  }
}
