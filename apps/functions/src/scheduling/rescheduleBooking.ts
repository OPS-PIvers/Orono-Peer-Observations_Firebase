import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_STATUS,
  WINDOW_SUBCOLLECTIONS,
  isAdminRole,
  rescheduleBookingInput,
  type Building,
  type Observation,
  type ObservationSlot,
  type ObservationWindow,
  type Staff,
} from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import { mergeBusyIntervals, peConflicts } from './engine/timeWindows.js';
import {
  normalizeLedger,
  recomputeBlockedSlotsForObserver,
  siblingBusyIntervalsInTx,
} from './engine/blocking.js';
import {
  meetsLeadTime,
  rescheduleTargetRejection,
  swapLedgerInterval,
} from './engine/bookingRules.js';
import { loadSchedulingSettings } from './bookObservationSlot.js';
import { formatChicagoDate, formatChicagoTime, toDate } from './engine/schedulingEmail.js';
import {
  GOOGLE_OAUTH_CLIENT_SECRET,
  updateObservationEvent,
} from '../calendar/lib/googleCalendar.js';

if (getApps().length === 0) initializeApp();

/**
 * Audit action for a slot reschedule. Kept local (a plain snake_case literal,
 * matching the AUDIT_ACTIONS convention) because audit writes are constructed
 * directly and never run through the Zod enum at write time. Slot booked /
 * cancelled stay in @ops/shared; this one is reschedule-specific.
 */
const SLOT_RESCHEDULED_ACTION = 'slot_rescheduled';

/** Slot statuses whose booking may be moved. Only a live booking reschedules. */
function isReschedulableSlot(slot: ObservationSlot): boolean {
  return slot.status === OBSERVATION_SLOT_STATUS.booked;
}

/**
 * Move an existing booking to another available slot in the same window.
 *
 * Allowed for an admin, the window observer, or the staff member who booked
 * the slot. The transaction revalidates the target slot exactly like a fresh
 * booking would (available, same building, lead time, PE-conflicts ignoring the
 * OLD slot's own interval), then atomically:
 *   - frees the old slot back to `available`
 *   - reserves the target slot as `booked`
 *   - swaps the busy-ledger interval and repoints the invitee's bookedSlotId
 *   - repoints the observation's slotId/scheduledStartAt/End/observationDate
 *
 * After the transaction it best-effort recomputes blocked slots, patches both
 * Google Calendar events to the new time, and emails both parties.
 */
export const rescheduleBooking = onCall(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: [GOOGLE_OAUTH_CLIENT_SECRET],
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');
    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);

    const parsed = rescheduleBookingInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;
    if (input.fromSlotId === input.toSlotId) {
      throw new HttpsError('invalid-argument', 'Choose a different time to reschedule to');
    }

    const db = getFirestore();
    const scheduling = await loadSchedulingSettings(db);
    const nowMs = Date.now();

    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const fromSlotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(input.fromSlotId);
    const toSlotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(input.toSlotId);

    let movedWindow: ObservationWindow | null = null;
    let fromSlotData: ObservationSlot | null = null;
    let toSlotData: ObservationSlot | null = null;
    let movedObservationId: string | null = null;
    let movedStaffEmail: string | null = null;

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const window = windowSnap.data() as ObservationWindow;

      const fromSnap = await tx.get(fromSlotRef);
      if (!fromSnap.exists) throw new HttpsError('not-found', 'Current booking slot not found');
      const fromSlot = fromSnap.data() as ObservationSlot;
      if (!isReschedulableSlot(fromSlot)) {
        throw new HttpsError('failed-precondition', 'That slot is not currently booked');
      }

      const allowed =
        isAdmin || window.observerEmail === callerEmail || fromSlot.bookedBy === callerEmail;
      if (!allowed) {
        throw new HttpsError('permission-denied', 'Not allowed to reschedule this booking');
      }

      const staffEmail = fromSlot.bookedBy;
      if (!staffEmail) {
        throw new HttpsError('failed-precondition', 'Booking has no staff member to move');
      }

      const inviteeIdx = window.invitees.findIndex((inv) => inv.email === staffEmail);
      const invitee = inviteeIdx === -1 ? undefined : window.invitees[inviteeIdx];
      if (!invitee) {
        throw new HttpsError('failed-precondition', 'Booking invitee is no longer on this window');
      }

      const toSnap = await tx.get(toSlotRef);
      if (!toSnap.exists) throw new HttpsError('not-found', 'Target slot not found');
      const toSlot = toSnap.data() as ObservationSlot;

      const rejection = rescheduleTargetRejection(fromSlot.slotId, toSlot, invitee.buildingId);
      if (rejection === 'same-slot') {
        throw new HttpsError('invalid-argument', 'Choose a different time to reschedule to');
      }
      if (rejection === 'not-available') {
        throw new HttpsError('failed-precondition', 'That time is no longer available');
      }
      if (rejection === 'wrong-building') {
        throw new HttpsError('failed-precondition', 'Slot is for a different building');
      }

      // Sibling-window ledgers (all reads must precede writes). The target is
      // checked against the evaluator's whole schedule, but the OLD slot's own
      // interval is ignored so a reschedule to an adjacent slot doesn't conflict
      // with the booking it is replacing.
      const siblingBusy = await siblingBusyIntervalsInTx(
        db,
        tx,
        window.observerEmail,
        input.windowId,
      );
      const mergedBusy = mergeBusyIntervals(normalizeLedger(window.peBusyIntervals), siblingBusy);

      const toStart = toDate(toSlot.startUTC);
      const toEnd = toDate(toSlot.endUTC);
      if (!meetsLeadTime(toStart.getTime(), nowMs, scheduling.bookingLeadTimeHours)) {
        throw new HttpsError(
          'failed-precondition',
          'That time is within the booking lead-time window',
        );
      }
      if (peConflicts(toStart, toEnd, mergedBusy, window.travelBufferMinutes, fromSlot.slotId)) {
        throw new HttpsError('failed-precondition', 'That time conflicts with another booking');
      }

      const observationId = fromSlot.observationId;

      // Free the old slot.
      tx.update(fromSlotRef, {
        status: OBSERVATION_SLOT_STATUS.available,
        blockedReason: null,
        bookedBy: null,
        bookedAt: null,
        observationId: null,
      });

      // Reserve the target slot, carrying the booking over.
      const bookedAt = Timestamp.now();
      tx.update(toSlotRef, {
        status: OBSERVATION_SLOT_STATUS.booked,
        bookedBy: staffEmail,
        bookedAt,
        observationId: observationId ?? null,
      });

      // Swap the ledger entry and repoint the invitee's bookedSlotId.
      const nextLedger = swapLedgerInterval(window.peBusyIntervals, fromSlot.slotId, {
        startUTC: toSlot.startUTC,
        endUTC: toSlot.endUTC,
        slotId: toSlot.slotId,
      });
      const invitees = window.invitees.map((inv, i) =>
        i === inviteeIdx ? { ...inv, bookedSlotId: toSlot.slotId } : inv,
      );
      tx.update(windowRef, {
        peBusyIntervals: nextLedger,
        invitees,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Repoint the observation so its scheduled time, date, and slot linkage
      // match the new slot (this is exactly what the editor could previously
      // desync). Only a still-Draft observation is moved; a Finalized one keeps
      // its frozen times.
      if (observationId) {
        const obsRef = db.collection(COLLECTIONS.observations).doc(observationId);
        const obsSnap = await tx.get(obsRef);
        if (obsSnap.exists) {
          const obs = obsSnap.data() as Observation;
          if (obs.status !== OBSERVATION_STATUS.finalized) {
            tx.update(obsRef, {
              slotId: toSlot.slotId,
              scheduledStartAt: Timestamp.fromDate(toStart),
              scheduledEndAt: Timestamp.fromDate(toEnd),
              observationDate: Timestamp.fromDate(toStart),
              lastModifiedAt: FieldValue.serverTimestamp(),
            });
          }
        }
      }

      movedWindow = window;
      fromSlotData = fromSlot;
      toSlotData = { ...toSlot, status: OBSERVATION_SLOT_STATUS.booked, bookedBy: staffEmail };
      movedObservationId = observationId ?? null;
      movedStaffEmail = staffEmail;
    });

    const window = movedWindow as ObservationWindow | null;
    const fromSlot = fromSlotData as ObservationSlot | null;
    const toSlot = toSlotData as ObservationSlot | null;
    if (!window || !fromSlot || !toSlot) {
      throw new HttpsError('internal', 'Reschedule transaction did not complete');
    }
    const staffEmail = movedStaffEmail as string | null;
    const observationId = movedObservationId as string | null;

    // Recompute blocking across every active window this evaluator owns so the
    // freed slot re-opens conflicting slots and the newly-booked time blocks
    // overlapping slots in sibling windows.
    await recomputeBlockedSlotsForObserver(db, window.observerEmail).catch((err: unknown) =>
      logger.error('rescheduleBooking: recomputeBlockedSlotsForObserver failed', err),
    );

    // Patch the Google Calendar events to the new time. The window's
    // gcalSendUpdates controls whether Google notifies attendees.
    if (observationId && staffEmail) {
      try {
        const obsSnap = await db.collection(COLLECTIONS.observations).doc(observationId).get();
        const obs = obsSnap.exists ? (obsSnap.data() as Observation) : null;
        const eventIds = obs?.gcalEventIds ?? {};
        const sendUpdates: 'none' | 'all' = window.gcalSendUpdates === 'all' ? 'all' : 'none';
        const toStart = toDate(toSlot.startUTC);
        const toEnd = toDate(toSlot.endUTC);
        const patch = {
          start: { dateTime: toStart.toISOString() },
          end: { dateTime: toEnd.toISOString() },
        };
        await Promise.all([
          eventIds.observer
            ? updateObservationEvent(window.observerEmail, eventIds.observer, patch, sendUpdates)
            : Promise.resolve(),
          eventIds.observed
            ? updateObservationEvent(staffEmail, eventIds.observed, patch, sendUpdates)
            : Promise.resolve(),
        ]);
      } catch (err) {
        logger.error('rescheduleBooking: calendar patch failed (non-fatal)', err);
      }
    }

    if (scheduling.confirmationEmailEnabled && staffEmail) {
      let buildingName = toSlot.buildingId;
      let observedName = staffEmail;
      try {
        const [bSnap, sSnap] = await Promise.all([
          db.collection(COLLECTIONS.buildings).doc(toSlot.buildingId).get(),
          db.collection(COLLECTIONS.staff).doc(staffEmail).get(),
        ]);
        if (bSnap.exists) buildingName = (bSnap.data() as Building).displayName;
        if (sSnap.exists) observedName = (sSnap.data() as Staff).name;
      } catch (err) {
        logger.warn('rescheduleBooking: lookup failed', err);
      }

      const toStart = toDate(toSlot.startUTC);
      const toEnd = toDate(toSlot.endUTC);
      await sendTemplatedEmail({
        db,
        triggerType: 'scheduling.bookingRescheduled',
        to: [staffEmail, window.observerEmail].filter(Boolean),
        vars: {
          observerName: window.observerName,
          observerEmail: window.observerEmail,
          observedName,
          observedEmail: staffEmail,
          slotDateLocal: formatChicagoDate(toStart),
          slotStartLocal: formatChicagoTime(toStart),
          slotEndLocal: formatChicagoTime(toEnd),
          slotPeriodName: toSlot.periodName,
          buildingName,
        },
        mailDocId: `scheduling.bookingRescheduled-${input.windowId}-${input.toSlotId}-${Date.now().toString()}`,
        auditDetails: {
          windowId: input.windowId,
          fromSlotId: input.fromSlotId,
          toSlotId: input.toSlotId,
          observationId,
          triggerType: 'scheduling.bookingRescheduled',
        },
      }).catch((err: unknown) => logger.error('rescheduleBooking: email send failed', err));
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail: callerEmail,
      action: SLOT_RESCHEDULED_ACTION,
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.slots}/${input.toSlotId}`,
      details: {
        windowId: input.windowId,
        fromSlotId: input.fromSlotId,
        toSlotId: input.toSlotId,
        observationId,
      },
    });

    return { observationId };
  },
);
