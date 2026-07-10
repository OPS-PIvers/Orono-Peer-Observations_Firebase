import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_STATUS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  rescheduleBookingInput,
  type Building,
  type ObservationSlot,
  type ObservationWindow,
  type Staff,
} from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import { GOOGLE_OAUTH_CLIENT_SECRET } from '../calendar/lib/googleCalendar.js';
import { peConflicts } from './engine/timeWindows.js';
import { recomputeBlockedSlots } from './engine/blocking.js';
import { meetsLeadTime } from './engine/bookingRules.js';
import {
  loadSchedulingSettings,
  nextWindowStatus,
  observerCalendarBusy,
} from './bookObservationSlot.js';
import { formatChicagoDate, formatChicagoTime, toDate } from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

const RESCHEDULABLE_WINDOW_STATUSES: string[] = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
  OBSERVATION_WINDOW_STATUS.fullyBooked,
];

/**
 * Move an invitee's existing booking to a different slot in the same window
 * as ONE atomic action (no cancel-then-rebook, no re-entering signup answers).
 *
 * Validated exactly like bookObservationSlot (invite token, lead time,
 * PE-conflict — with the old slot's interval excluded since it's being freed).
 * The transaction frees the old slot, claims the new one, swaps the interval
 * on the peBusyIntervals ledger, repoints the invitee's bookedSlotId, and
 * moves the still-Draft observation's scheduled times — its signup answers,
 * notes, and Google Calendar event ids are untouched. After the transaction
 * it recomputes blocked slots and emails both parties. Google Calendar is
 * NOT patched here: the observation-doc write above re-fires
 * onObservationBooked, whose sync path owns patching (or first-creating)
 * both parties' events — patching here too would double the Calendar API
 * writes and, with gcalSendUpdates === 'all', double Google's own "event
 * updated" notifications.
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
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = rescheduleBookingInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();
    const scheduling = await loadSchedulingSettings(db);
    const nowMs = Date.now();

    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const newSlotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(input.newSlotId);

    // Real-calendar (freebusy) conflict gate for the DESTINATION slot — same
    // policy as bookObservationSlot, checked before the transaction and
    // soft-failing open on any Calendar outage.
    let calendarConflictWarning = false;
    if (scheduling.gcalConflictPolicy !== 'ignore') {
      const [preWindowSnap, preSlotSnap] = await Promise.all([windowRef.get(), newSlotRef.get()]);
      if (preWindowSnap.exists && preSlotSnap.exists) {
        const preWindow = preWindowSnap.data() as ObservationWindow;
        const preSlot = preSlotSnap.data() as ObservationSlot;
        const busy = await observerCalendarBusy(
          preWindow.observerEmail,
          preSlot.startUTC,
          preSlot.endUTC,
        );
        if (busy) {
          if (scheduling.gcalConflictPolicy === 'block') {
            throw new HttpsError(
              'failed-precondition',
              "That time conflicts with an event on your observer's Google Calendar. Please pick a different slot.",
            );
          }
          calendarConflictWarning = true;
        }
      }
    }

    let oldSlotData: ObservationSlot | null = null;
    let newSlotData: ObservationSlot | null = null;
    let windowData: ObservationWindow | null = null;
    let movedObservationId: string | null = null;

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const window = windowSnap.data() as ObservationWindow;

      if (!RESCHEDULABLE_WINDOW_STATUSES.includes(window.status)) {
        throw new HttpsError('failed-precondition', 'Window is not open for rescheduling');
      }
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(
        new Date(nowMs),
      );
      if (window.endDate < today) {
        throw new HttpsError('failed-precondition', 'Window booking period has ended');
      }

      const inviteeIdx = window.invitees.findIndex(
        (inv) => inv.email === userEmail && inv.inviteToken === input.inviteToken,
      );
      const invitee = inviteeIdx === -1 ? undefined : window.invitees[inviteeIdx];
      if (!invitee) {
        throw new HttpsError('permission-denied', 'Invalid invite token for this user');
      }
      if (invitee.bookedSlotId == null) {
        throw new HttpsError('failed-precondition', 'You have no booking in this window');
      }
      if (invitee.bookedSlotId === input.newSlotId) {
        throw new HttpsError('failed-precondition', 'That is already your booked time');
      }

      const oldSlotRef = windowRef
        .collection(WINDOW_SUBCOLLECTIONS.slots)
        .doc(invitee.bookedSlotId);
      const oldSlotSnap = await tx.get(oldSlotRef);
      if (!oldSlotSnap.exists) throw new HttpsError('not-found', 'Booked slot not found');
      const oldSlot = oldSlotSnap.data() as ObservationSlot;
      if (oldSlot.status !== OBSERVATION_SLOT_STATUS.booked || oldSlot.bookedBy !== userEmail) {
        throw new HttpsError('failed-precondition', 'Your booking is no longer active');
      }

      const newSlotSnap = await tx.get(newSlotRef);
      if (!newSlotSnap.exists) throw new HttpsError('not-found', 'Slot not found');
      const newSlot = newSlotSnap.data() as ObservationSlot;

      if (newSlot.status !== OBSERVATION_SLOT_STATUS.available) {
        throw new HttpsError('failed-precondition', 'Slot is no longer available');
      }
      if (newSlot.buildingId !== invitee.buildingId) {
        throw new HttpsError('failed-precondition', 'Slot is for a different building');
      }

      const newStart = toDate(newSlot.startUTC);
      const newEnd = toDate(newSlot.endUTC);
      if (!meetsLeadTime(newStart.getTime(), nowMs, scheduling.bookingLeadTimeHours)) {
        throw new HttpsError('failed-precondition', 'Slot is within the booking lead-time window');
      }
      // The old slot's interval is being freed by this same transaction, so
      // exclude it from the conflict check.
      const otherIntervals = window.peBusyIntervals.filter((iv) => iv.slotId !== oldSlot.slotId);
      if (peConflicts(newStart, newEnd, otherIntervals, window.travelBufferMinutes)) {
        throw new HttpsError('failed-precondition', 'Slot conflicts with another booking');
      }

      // The observation moves with the booking — reject once it's finalized.
      const observationId = oldSlot.observationId;
      let obsRef: FirebaseFirestore.DocumentReference | null = null;
      if (observationId) {
        obsRef = db.collection(COLLECTIONS.observations).doc(observationId);
        const obsSnap = await tx.get(obsRef);
        if (obsSnap.exists) {
          if (obsSnap.data()?.['status'] !== OBSERVATION_STATUS.draft) {
            throw new HttpsError(
              'failed-precondition',
              'This observation has been finalized and can no longer be rescheduled',
            );
          }
        } else {
          obsRef = null;
        }
      }

      const bookedAt = Timestamp.now();
      tx.update(oldSlotRef, {
        status: OBSERVATION_SLOT_STATUS.available,
        blockedReason: null,
        bookedBy: null,
        bookedAt: null,
        observationId: null,
      });
      tx.update(newSlotRef, {
        status: OBSERVATION_SLOT_STATUS.booked,
        bookedBy: userEmail,
        bookedAt,
        observationId: observationId ?? null,
      });

      const invitees = window.invitees.map((inv, i) =>
        i === inviteeIdx ? { ...inv, bookedSlotId: newSlot.slotId } : inv,
      );
      tx.update(windowRef, {
        peBusyIntervals: [
          ...otherIntervals,
          { startUTC: newSlot.startUTC, endUTC: newSlot.endUTC, slotId: newSlot.slotId },
        ],
        invitees,
        status: nextWindowStatus(invitees),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (obsRef) {
        tx.update(obsRef, {
          slotId: newSlot.slotId,
          observationDate: Timestamp.fromDate(newStart),
          scheduledStartAt: Timestamp.fromDate(newStart),
          scheduledEndAt: Timestamp.fromDate(newEnd),
          lastModifiedAt: FieldValue.serverTimestamp(),
        });
      }

      oldSlotData = oldSlot;
      newSlotData = { ...newSlot, status: OBSERVATION_SLOT_STATUS.booked, bookedBy: userEmail };
      windowData = window;
      movedObservationId = obsRef ? observationId : null;
    });

    // ── Post-transaction, best-effort side effects ───────────────────────
    const oldSlot = oldSlotData as ObservationSlot | null;
    const newSlot = newSlotData as ObservationSlot | null;
    const window = windowData as ObservationWindow | null;
    if (!oldSlot || !newSlot || !window) {
      throw new HttpsError('internal', 'Reschedule transaction did not complete');
    }
    const observationId = movedObservationId as string | null;

    await recomputeBlockedSlots(db, input.windowId).catch((err: unknown) =>
      logger.error('rescheduleBooking: recomputeBlockedSlots failed', err),
    );

    // Google Calendar events are intentionally NOT patched here — the
    // scheduledStartAt/scheduledEndAt write inside the transaction re-fires
    // onObservationBooked, whose syncObservationEvent path patches the
    // existing events (or creates them if they never existed). See the
    // function-level doc comment.
    const newStart = toDate(newSlot.startUTC);
    const newEnd = toDate(newSlot.endUTC);

    if (scheduling.confirmationEmailEnabled) {
      let buildingName = newSlot.buildingId;
      let observedName = userEmail;
      try {
        const [bSnap, sSnap] = await Promise.all([
          db.collection(COLLECTIONS.buildings).doc(newSlot.buildingId).get(),
          db.collection(COLLECTIONS.staff).doc(userEmail).get(),
        ]);
        if (bSnap.exists) buildingName = (bSnap.data() as Building).displayName;
        if (sSnap.exists) observedName = (sSnap.data() as Staff).name;
      } catch (err) {
        logger.warn('rescheduleBooking: lookup failed', err);
      }

      const oldStart = toDate(oldSlot.startUTC);
      await sendTemplatedEmail({
        db,
        triggerType: 'scheduling.bookingRescheduled',
        to: [userEmail, window.observerEmail].filter(Boolean),
        vars: {
          observerName: window.observerName,
          observerEmail: window.observerEmail,
          observedName,
          observedEmail: userEmail,
          slotDateLocal: formatChicagoDate(newStart),
          slotStartLocal: formatChicagoTime(newStart),
          slotEndLocal: formatChicagoTime(newEnd),
          slotPeriodName: newSlot.periodName,
          buildingName,
          previousSlotDateLocal: formatChicagoDate(oldStart),
          previousSlotStartLocal: formatChicagoTime(oldStart),
        },
        mailDocId: `scheduling.bookingRescheduled-${input.windowId}-${input.newSlotId}-${Date.now().toString()}`,
        auditDetails: {
          windowId: input.windowId,
          fromSlotId: oldSlot.slotId,
          toSlotId: input.newSlotId,
          triggerType: 'scheduling.bookingRescheduled',
        },
      }).catch((err: unknown) => logger.error('rescheduleBooking: reschedule send failed', err));
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: 'observationSlot.reschedule',
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.slots}/${input.newSlotId}`,
      details: {
        windowId: input.windowId,
        fromSlotId: oldSlot.slotId,
        toSlotId: input.newSlotId,
        observationId,
      },
    });

    return { observationId, calendarConflictWarning };
  },
);
