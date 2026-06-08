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
  cancelBookingInput,
  isAdminRole,
  type Building,
  type ObservationPreference,
  type ObservationSlot,
  type ObservationWindow,
  type Staff,
} from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import { recomputeBlockedSlots } from './engine/blocking.js';
import { preferenceShouldRevert } from './engine/bookingRules.js';
import { loadSchedulingSettings, nextWindowStatus } from './bookObservationSlot.js';
import { deleteDraftObservation } from './draftCleanup.js';
import { formatChicagoDate, formatChicagoTime, toDate } from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

/**
 * Cancel an existing booking, freeing the slot back to the pool.
 *
 * Allowed for an admin, the window observer, or the staff member who booked
 * the slot. Reverses the booking in a transaction (slot freed, ledger entry
 * removed, invitee + window status reset), then best-effort recomputes blocked
 * slots, deletes the still-Draft observation, and emails both parties.
 */
export const cancelBooking = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');
    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);

    const parsed = cancelBookingInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();
    const scheduling = await loadSchedulingSettings(db);

    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const slotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(input.slotId);

    let cancelledSlot: ObservationSlot | null = null;
    let cancelledWindow: ObservationWindow | null = null;
    let cancelledObservationId: string | null = null;
    let cancelledStaffEmail: string | null = null;

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const window = windowSnap.data() as ObservationWindow;

      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new HttpsError('not-found', 'Slot not found');
      const slot = slotSnap.data() as ObservationSlot;

      if (slot.status !== OBSERVATION_SLOT_STATUS.booked) {
        throw new HttpsError('failed-precondition', 'Slot is not currently booked');
      }

      const allowed =
        isAdmin || window.observerEmail === callerEmail || slot.bookedBy === callerEmail;
      if (!allowed) {
        throw new HttpsError('permission-denied', 'Not allowed to cancel this booking');
      }

      // Day-preference revert: if this booking was assigned from a day
      // preference, the preference must drop back to unassigned so the PE can
      // re-assign it. Read inside the transaction (all reads before writes).
      let prefRefToRevert: DocumentReference | null = null;
      if (window.bookingMode === 'day-preference' && slot.bookedBy) {
        const prefRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.preferences).doc(slot.bookedBy);
        const prefSnap = await tx.get(prefRef);
        if (
          prefSnap.exists &&
          preferenceShouldRevert(
            (prefSnap.data() as ObservationPreference).assignedSlotId,
            slot.slotId,
          )
        ) {
          prefRefToRevert = prefRef;
        }
      }

      const windowCancelled = window.status === OBSERVATION_WINDOW_STATUS.cancelled;
      const freedStatus = windowCancelled
        ? OBSERVATION_SLOT_STATUS.blocked
        : OBSERVATION_SLOT_STATUS.available;

      tx.update(slotRef, {
        status: freedStatus,
        blockedReason: windowCancelled ? SLOT_BLOCKED_REASON.windowCancelled : null,
        bookedBy: null,
        bookedAt: null,
        observationId: null,
      });

      // Remove this slot's interval from the PE ledger.
      const remainingIntervals = window.peBusyIntervals.filter((iv) => iv.slotId !== slot.slotId);

      const invitees = window.invitees.map((inv) =>
        inv.bookedSlotId === slot.slotId ? { ...inv, bookedSlotId: null } : inv,
      );

      // Don't override an already-terminal window status (cancelled/expired).
      const updates: Record<string, unknown> = {
        peBusyIntervals: remainingIntervals,
        invitees,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (
        window.status === OBSERVATION_WINDOW_STATUS.open ||
        window.status === OBSERVATION_WINDOW_STATUS.partiallyBooked ||
        window.status === OBSERVATION_WINDOW_STATUS.fullyBooked
      ) {
        const next = nextWindowStatus(invitees);
        // If no invitee has a booking now, fall back to 'open'.
        updates['status'] = invitees.some((inv) => inv.bookedSlotId != null)
          ? next
          : OBSERVATION_WINDOW_STATUS.open;
      }
      tx.update(windowRef, updates);

      if (prefRefToRevert) {
        tx.update(prefRefToRevert, { assignedSlotId: null, assignedAt: null });
      }

      cancelledSlot = slot;
      cancelledWindow = window;
      cancelledObservationId = slot.observationId ?? null;
      cancelledStaffEmail = slot.bookedBy ?? null;
    });

    const slot = cancelledSlot as ObservationSlot | null;
    const window = cancelledWindow as ObservationWindow | null;
    if (!slot || !window) {
      throw new HttpsError('internal', 'Cancellation transaction did not complete');
    }
    const staffEmail = cancelledStaffEmail as string | null;
    const observationId = cancelledObservationId as string | null;

    await recomputeBlockedSlots(db, input.windowId).catch((err: unknown) =>
      logger.error('cancelBooking: recomputeBlockedSlots failed', err),
    );

    // Delete the Draft observation spawned by this booking (no-op if it's
    // already Finalized — that doc has a shared Drive folder to preserve).
    if (observationId) {
      try {
        await deleteDraftObservation(db, observationId);
      } catch (err) {
        logger.error('cancelBooking: observation delete failed', err);
      }
    }

    if (scheduling.cancellationEmailEnabled && staffEmail) {
      let buildingName = slot.buildingId;
      let observedName = staffEmail;
      try {
        const [bSnap, sSnap] = await Promise.all([
          db.collection(COLLECTIONS.buildings).doc(slot.buildingId).get(),
          db.collection(COLLECTIONS.staff).doc(staffEmail).get(),
        ]);
        if (bSnap.exists) buildingName = (bSnap.data() as Building).displayName;
        if (sSnap.exists) observedName = (sSnap.data() as Staff).name;
      } catch (err) {
        logger.warn('cancelBooking: lookup failed', err);
      }

      const slotStart = toDate(slot.startUTC);
      const slotEnd = toDate(slot.endUTC);
      await sendTemplatedEmail({
        db,
        triggerType: 'scheduling.bookingCancelled',
        to: [staffEmail, window.observerEmail].filter(Boolean),
        vars: {
          observerName: window.observerName,
          observerEmail: window.observerEmail,
          observedName,
          observedEmail: staffEmail,
          slotDateLocal: formatChicagoDate(slotStart),
          slotStartLocal: formatChicagoTime(slotStart),
          slotEndLocal: formatChicagoTime(slotEnd),
          slotPeriodName: slot.periodName,
          buildingName,
          cancellationReason: input.reason,
        },
        mailDocId: `scheduling.bookingCancelled-${input.windowId}-${input.slotId}-${Date.now().toString()}`,
        auditDetails: {
          windowId: input.windowId,
          slotId: input.slotId,
          triggerType: 'scheduling.bookingCancelled',
        },
      }).catch((err: unknown) => logger.error('cancelBooking: cancellation send failed', err));
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail: callerEmail,
      action: AUDIT_ACTIONS.slotCancelled,
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.slots}/${input.slotId}`,
      details: {
        windowId: input.windowId,
        slotId: input.slotId,
        reason: input.reason,
        observationId,
      },
    });

    return { ok: true };
  },
);
