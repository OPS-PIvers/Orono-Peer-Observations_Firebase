import { onDocumentWritten, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import type { Change, DocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, windowInviteViewsOf } from '@ops/shared';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/**
 * Keeps `/windowInviteViews/{windowId}_{email}` in step with its window: one
 * view per invitee holding only that invitee's entries (see
 * packages/shared/src/schema/windowInviteView.ts for why it exists).
 */
export const onObservationWindowInviteViews = onDocumentWritten(
  { document: 'observationWindows/{windowId}', region: 'us-central1', memory: '256MiB' },
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
 * Returns the number of views written and deleted.
 */
export async function syncWindowInviteViews(
  db: Firestore,
  windowId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ written: number; deleted: number }> {
  const viewsCol = db.collection(COLLECTIONS.windowInviteViews);
  const [windowSnap, existingSnap] = await Promise.all([
    db.collection(COLLECTIONS.observationWindows).doc(windowId).get(),
    viewsCol.where('windowId', '==', windowId).get(),
  ]);
  const data = windowSnap.data();
  const desired = data
    ? windowInviteViewsOf(data, windowId)
    : new Map<string, Record<string, unknown>>();

  type Op =
    { kind: 'set'; id: string; view: Record<string, unknown> } | { kind: 'delete'; id: string };
  const ops: Op[] = [];
  const existingById = new Map<string, Record<string, unknown>>();
  for (const d of existingSnap.docs) {
    const view = d.data();
    delete view['updatedAt'];
    existingById.set(d.id, view);
  }
  for (const [id, view] of desired) {
    const existing = existingById.get(id);
    if (existing && stableStringify(existing) === stableStringify(view)) continue;
    ops.push({ kind: 'set', id, view });
  }
  for (const id of existingById.keys()) {
    if (!desired.has(id)) ops.push({ kind: 'delete', id });
  }

  if (!opts.dryRun) {
    for (let i = 0; i < ops.length; i += MAX_BATCH_WRITES) {
      const batch = db.batch();
      for (const op of ops.slice(i, i + MAX_BATCH_WRITES)) {
        const ref = viewsCol.doc(op.id);
        if (op.kind === 'set') {
          batch.set(ref, { ...op.view, updatedAt: FieldValue.serverTimestamp() });
        } else {
          batch.delete(ref);
        }
      }
      await batch.commit();
    }
  }
  return {
    written: ops.filter((o) => o.kind === 'set').length,
    deleted: ops.filter((o) => o.kind === 'delete').length,
  };
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
