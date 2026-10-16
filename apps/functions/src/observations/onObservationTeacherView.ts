import { onDocumentWritten, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import type { Change, DocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, teacherViewOf } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Keeps `/teacherViews/{observationId}` in step with its observation: the
 * teacher-safe projection from `teacherViewOf` (see
 * packages/shared/src/schema/teacherView.ts for why it exists).
 *
 * Deliberately separate from onObservationWritten, which is serialized to
 * one instance for the Sheets quota; the view must not queue behind that.
 */
export const onObservationTeacherView = onDocumentWritten(
  { document: 'observations/{observationId}', region: 'us-central1', memory: '256MiB' },
  (event) => handleTeacherView(event),
);

/** JSON with sorted keys and Timestamps as millis, so two projections built
 *  from separate reads compare equal when their content is equal. */
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
 * Core handler, extracted from the onDocumentWritten wrapper so it can be
 * unit-tested with a plain event object (as handleStaffWritten is).
 */
export async function handleTeacherView(
  event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { observationId: string }>,
): Promise<void> {
  const { observationId } = event.params;
  const viewRef = getFirestore().collection(COLLECTIONS.teacherViews).doc(observationId);
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  if (!after) {
    // delete() on a missing doc succeeds, so not-found needs no handling.
    await viewRef.delete();
    logger.info('onObservationTeacherView: view deleted', { observationId });
    return;
  }

  // Most autosaves change only content the teacher can't see; skip those.
  if (
    before &&
    stableStringify(teacherViewOf(before, observationId)) ===
      stableStringify(teacherViewOf(after, observationId))
  ) {
    return;
  }

  // Trigger events can arrive out of order. Project the observation as it
  // is now, not as this event saw it, so a late event can't restore content
  // a later sharing change hid.
  const current = await getFirestore()
    .collection(COLLECTIONS.observations)
    .doc(observationId)
    .get();
  const data = current.data();
  if (!data) {
    await viewRef.delete();
    return;
  }
  await viewRef.set({
    ...teacherViewOf(data, observationId),
    updatedAt: FieldValue.serverTimestamp(),
  });
  logger.info('onObservationTeacherView: view written', { observationId });
}
