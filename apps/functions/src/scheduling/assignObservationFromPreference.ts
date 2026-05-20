import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  assignObservationFromPreferenceInput,
  isAdminRole,
  type ObservationPreference,
  type ObservationSlot,
  type ObservationWindow,
} from '@ops/shared';
import { peConflicts } from './engine/timeWindows.js';
import { recomputeBlockedSlots } from './engine/blocking.js';
import {
  createDraftObservationForBooking,
  loadSchedulingSettings,
  nextWindowStatus,
} from './bookObservationSlot.js';
import { toDate } from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

const BOOKABLE_WINDOW_STATUSES: string[] = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
];

/**
 * Assign an exact slot to a staff member from their day preference (booking
 * mode 'day-preference'). Callable by the window observer or an admin only.
 *
 * The PE books on behalf of the staff member: the same lead-time + PE-conflict
 * machinery as direct booking applies, the slot is reserved in a transaction,
 * the preference is marked assigned, and both parties are emailed. The UI loops
 * this callable for bulk assignment (one slot per call).
 */
export const assignObservationFromPreference = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');
    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);

    const parsed = assignObservationFromPreferenceInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;
    const staffEmail = input.email.toLowerCase();

    const db = getFirestore();
    const scheduling = await loadSchedulingSettings(db);

    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const slotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(input.slotId);
    const prefRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.preferences).doc(staffEmail);

    let bookedSlotData: ObservationSlot | null = null;
    let bookedWindowData: ObservationWindow | null = null;
    let detailAnswers: ObservationPreference['detailAnswers'] = [];

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const window = windowSnap.data() as ObservationWindow;

      if (!isAdmin && window.observerEmail !== callerEmail) {
        throw new HttpsError(
          'permission-denied',
          'Only the window observer or an admin may assign',
        );
      }
      if (!BOOKABLE_WINDOW_STATUSES.includes(window.status)) {
        throw new HttpsError('failed-precondition', 'Window is not open for assignment');
      }

      const prefSnap = await tx.get(prefRef);
      if (!prefSnap.exists) throw new HttpsError('not-found', 'No day preference for this staff');
      const preference = prefSnap.data() as ObservationPreference;
      if (preference.assignedSlotId != null) {
        throw new HttpsError('failed-precondition', 'This preference is already assigned');
      }

      const inviteeIdx = window.invitees.findIndex((inv) => inv.email === staffEmail);
      const invitee = inviteeIdx === -1 ? undefined : window.invitees[inviteeIdx];
      if (!invitee) {
        throw new HttpsError('not-found', 'Staff is not an invitee on this window');
      }
      if (invitee.bookedSlotId != null) {
        throw new HttpsError('failed-precondition', 'Staff already has a booking in this window');
      }

      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new HttpsError('not-found', 'Slot not found');
      const slot = slotSnap.data() as ObservationSlot;

      if (slot.status !== OBSERVATION_SLOT_STATUS.available) {
        throw new HttpsError('failed-precondition', 'Slot is no longer available');
      }
      if (slot.buildingId !== preference.buildingId) {
        throw new HttpsError('failed-precondition', 'Slot is for a different building');
      }

      const slotStart = toDate(slot.startUTC);
      const slotEnd = toDate(slot.endUTC);
      if (peConflicts(slotStart, slotEnd, window.peBusyIntervals, window.travelBufferMinutes)) {
        throw new HttpsError('failed-precondition', 'Slot conflicts with another booking');
      }

      const assignedAt = Timestamp.now();
      tx.update(slotRef, {
        status: OBSERVATION_SLOT_STATUS.booked,
        bookedBy: staffEmail,
        bookedAt: assignedAt,
      });
      tx.update(prefRef, { assignedSlotId: slot.slotId, assignedAt });

      const invitees = window.invitees.map((inv, i) =>
        i === inviteeIdx ? { ...inv, bookedSlotId: slot.slotId } : inv,
      );
      tx.update(windowRef, {
        peBusyIntervals: FieldValue.arrayUnion({
          startUTC: slot.startUTC,
          endUTC: slot.endUTC,
          slotId: slot.slotId,
        }),
        invitees,
        status: nextWindowStatus(invitees),
        updatedAt: FieldValue.serverTimestamp(),
      });

      bookedSlotData = { ...slot, status: OBSERVATION_SLOT_STATUS.booked, bookedBy: staffEmail };
      bookedWindowData = window;
      detailAnswers = preference.detailAnswers;
    });

    const slot = bookedSlotData as ObservationSlot | null;
    const window = bookedWindowData as ObservationWindow | null;
    if (!slot || !window) {
      throw new HttpsError('internal', 'Assignment transaction did not complete');
    }

    await recomputeBlockedSlots(db, input.windowId).catch((err: unknown) =>
      logger.error('assignObservationFromPreference: recomputeBlockedSlots failed', err),
    );

    const observationId = await createDraftObservationForBooking({
      db,
      window,
      slot,
      staffEmail,
      signupDetails: detailAnswers,
      scheduling,
      emailTrigger: 'scheduling.assignmentNotice',
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail: callerEmail,
      action: 'observationWindow.assignFromPreference',
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.slots}/${input.slotId}`,
      details: { windowId: input.windowId, slotId: input.slotId, staffEmail, observationId },
    });

    return { observationId };
  },
);
