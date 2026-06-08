import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, type DocumentReference, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_WINDOW_STATUS,
  SLOT_BLOCKED_REASON,
  WINDOW_SUBCOLLECTIONS,
  cancelObservationWindowInput,
  isAdminRole,
  type ObservationSlot,
  type ObservationWindow,
} from '@ops/shared';
import { bookedSlotObservationIds } from './engine/bookingRules.js';
import { deleteDraftObservation } from './draftCleanup.js';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/**
 * Cancel an observation window.
 *
 * Allowed for an admin or the window's own observer. Marks the window
 * `cancelled`, flips every non-booked slot to `blocked`/`window-cancelled`,
 * and tears down the Draft observations the window's bookings spawned
 * (Finalized observations are preserved — their Drive folder is shared with
 * the observed staff member).
 */
export const cancelObservationWindow = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = cancelObservationWindowInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { windowId, reason } = parsed.data;

    const db = getFirestore();
    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(windowId);
    const windowSnap = await windowRef.get();
    if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
    const window = windowSnap.data() as ObservationWindow;

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin && window.observerEmail !== userEmail) {
      throw new HttpsError('permission-denied', 'Only the observer or an admin can cancel.');
    }

    const now = FieldValue.serverTimestamp();

    await windowRef.update({
      status: OBSERVATION_WINDOW_STATUS.cancelled,
      cancelledAt: now,
      cancelledBy: userEmail,
      cancellationReason: reason,
      updatedAt: now,
    });

    // Block every non-booked slot.
    const slotsSnap = await windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).get();
    const slots = slotsSnap.docs.map((d) => d.data() as ObservationSlot);
    const refs: DocumentReference[] = [];
    for (const slotDoc of slotsSnap.docs) {
      const slot = slotDoc.data() as ObservationSlot;
      if (slot.status === OBSERVATION_SLOT_STATUS.booked) continue;
      refs.push(slotDoc.ref);
    }
    for (let i = 0; i < refs.length; i += MAX_BATCH_WRITES) {
      const batch = db.batch();
      for (const ref of refs.slice(i, i + MAX_BATCH_WRITES)) {
        batch.update(ref, {
          status: OBSERVATION_SLOT_STATUS.blocked,
          blockedReason: SLOT_BLOCKED_REASON.windowCancelled,
        });
      }
      await batch.commit();
    }

    // Tear down the Draft observations the window's bookings spawned, so a
    // cancelled window doesn't leave orphaned Drafts behind. Finalized
    // observations are preserved by deleteDraftObservation.
    let cleanedDraftCount = 0;
    for (const obsId of bookedSlotObservationIds(slots)) {
      try {
        if (await deleteDraftObservation(db, obsId)) cleanedDraftCount += 1;
      } catch (err) {
        logger.warn('cancelObservationWindow: draft cleanup failed', {
          observationId: obsId,
          err,
        });
      }
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: now,
      userEmail,
      action: AUDIT_ACTIONS.windowCancelled,
      target: `${COLLECTIONS.observationWindows}/${windowId}`,
      details: { reason, blockedSlotCount: refs.length, cleanedDraftCount },
    });

    return { ok: true };
  },
);
