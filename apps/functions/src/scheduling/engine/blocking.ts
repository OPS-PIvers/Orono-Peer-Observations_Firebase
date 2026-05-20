import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  SLOT_BLOCKED_REASON,
  WINDOW_SUBCOLLECTIONS,
  type ObservationSlot,
  type ObservationWindow,
} from '@ops/shared';
import { peConflicts } from './timeWindows.js';

const MAX_BATCH_WRITES = 450;

/** Coerce a Firestore Timestamp / Date / number into a Date. */
function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  return new Date(NaN);
}

/**
 * Recompute pe-conflict blocking for every reconsiderable slot in a window.
 *
 * For each slot that is currently `available`, or `blocked` for `pe-conflict`,
 * flip it to `blocked`/`pe-conflict` when it overlaps the window's
 * `peBusyIntervals` (± travel buffer), else back to `available`/null.
 *
 * `booked` slots and slots blocked for `no-school` / `window-cancelled` are
 * never touched. Writes are batched (≤450 per batch).
 */
export async function recomputeBlockedSlots(db: Firestore, windowId: string): Promise<void> {
  const windowRef = db.collection(COLLECTIONS.observationWindows).doc(windowId);
  const windowSnap = await windowRef.get();
  if (!windowSnap.exists) return;
  const window = windowSnap.data() as ObservationWindow;

  const peBusy = window.peBusyIntervals.map((iv) => ({
    slotId: iv.slotId,
    startUTC: toDate(iv.startUTC),
    endUTC: toDate(iv.endUTC),
  }));
  const bufferMinutes = window.travelBufferMinutes;

  const slotsSnap = await windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).get();

  interface Update {
    ref: FirebaseFirestore.DocumentReference;
    data: Record<string, unknown>;
  }
  const updates: Update[] = [];

  for (const slotDoc of slotsSnap.docs) {
    const slot = slotDoc.data() as ObservationSlot;

    const reconsiderable =
      slot.status === OBSERVATION_SLOT_STATUS.available ||
      (slot.status === OBSERVATION_SLOT_STATUS.blocked &&
        slot.blockedReason === SLOT_BLOCKED_REASON.peConflict);
    if (!reconsiderable) continue;

    const conflicts = peConflicts(
      toDate(slot.startUTC),
      toDate(slot.endUTC),
      peBusy,
      bufferMinutes,
      slot.slotId,
    );

    if (conflicts) {
      if (
        slot.status !== OBSERVATION_SLOT_STATUS.blocked ||
        slot.blockedReason !== SLOT_BLOCKED_REASON.peConflict
      ) {
        updates.push({
          ref: slotDoc.ref,
          data: {
            status: OBSERVATION_SLOT_STATUS.blocked,
            blockedReason: SLOT_BLOCKED_REASON.peConflict,
          },
        });
      }
    } else if (slot.status !== OBSERVATION_SLOT_STATUS.available) {
      updates.push({
        ref: slotDoc.ref,
        data: { status: OBSERVATION_SLOT_STATUS.available, blockedReason: null },
      });
    }
  }

  for (let i = 0; i < updates.length; i += MAX_BATCH_WRITES) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + MAX_BATCH_WRITES)) {
      batch.update(u.ref, u.data);
    }
    await batch.commit();
  }
}
