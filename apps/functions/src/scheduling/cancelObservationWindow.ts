import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_WINDOW_STATUS,
  SLOT_BLOCKED_REASON,
  WINDOW_SUBCOLLECTIONS,
  cancelObservationWindowInput,
  isAdminRole,
  type Building,
  type ObservationSlot,
  type ObservationWindow,
  type WindowInvitee,
} from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import { bookedSlotObservationIds } from './engine/bookingRules.js';
import { loadSchedulingSettings } from './bookObservationSlot.js';
import { deleteDraftObservation } from './draftCleanup.js';
import {
  formatChicagoDate,
  formatChicagoTime,
  formatYMD,
  toDate,
} from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

const MAX_BATCH_WRITES = 450;

/** The slots that hold a live booking — drives draft cleanup + cancellation emails. */
export function bookedSlots(slots: ObservationSlot[]): ObservationSlot[] {
  return slots.filter((slot) => slot.status === OBSERVATION_SLOT_STATUS.booked);
}

/** Invitees with their booking pointer cleared (non-mutating). */
export function clearInviteeBookings(invitees: WindowInvitee[]): WindowInvitee[] {
  return invitees.map((inv) => (inv.bookedSlotId === null ? inv : { ...inv, bookedSlotId: null }));
}

/** Invitees who never booked — they get the window-cancelled notice instead. */
export function nonBookedInvitees(invitees: WindowInvitee[]): WindowInvitee[] {
  return invitees.filter((inv) => inv.bookedSlotId === null);
}

/**
 * /mail doc id for the booking-cancelled email a window cancellation sends.
 *
 * Deterministic — a window cancels at most once and a retry must not
 * double-send (the Trigger Email extension only sends on doc *creation*).
 * The '-window-cancel' discriminator keeps it from ever colliding with
 * cancelBooking's Date.now()-suffixed ids for the same slot.
 */
export function windowCancelBookingMailDocId(windowId: string, slotId: string): string {
  return `scheduling.bookingCancelled-${windowId}-${slotId}-window-cancel`;
}

/**
 * /mail doc id for the window-cancelled notice to a non-booked invitee.
 * Includes the buildingId because one email may be invited at two buildings
 * (matching windowInviteMailDocId in createObservationWindow).
 */
export function windowCancelledNoticeMailDocId(
  windowId: string,
  email: string,
  buildingId: string,
): string {
  return `scheduling.windowCancelled-${windowId}-${email}-${buildingId}`;
}

/**
 * Cancel an observation window.
 *
 * Allowed for an admin or the window's own observer. Marks the window
 * `cancelled`, clears every invitee's booking pointer and the evaluator-time
 * ledger, flips every slot (booked included) to `blocked`/`window-cancelled`,
 * and tears down the Draft observations the window's bookings spawned
 * (Finalized observations are preserved — their Drive folder is shared with
 * the observed staff member). When cancellation emails are enabled, every
 * invitee with a booking (plus the observer) gets a bookingCancelled email
 * and every non-booked invitee gets a windowCancelled notice.
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

    const scheduling = await loadSchedulingSettings(db);
    const now = FieldValue.serverTimestamp();

    // Capture every slot BEFORE the teardown so booked slots stay visible to
    // the draft cleanup and cancellation emails below.
    const slotsSnap = await windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).get();
    const slots = slotsSnap.docs.map((d) => d.data() as ObservationSlot);
    const booked = bookedSlots(slots);

    await windowRef.update({
      status: OBSERVATION_WINDOW_STATUS.cancelled,
      cancelledAt: now,
      cancelledBy: userEmail,
      cancellationReason: reason,
      // Tear down the booking state with the window: no invitee keeps a
      // booking pointer and the evaluator-time ledger empties.
      invitees: clearInviteeBookings(window.invitees),
      peBusyIntervals: [],
      updatedAt: now,
    });

    // Block every slot — booked ones included, with their booking fields
    // cleared so the subcollection agrees with the window doc above.
    for (let i = 0; i < slotsSnap.docs.length; i += MAX_BATCH_WRITES) {
      const batch = db.batch();
      for (const slotDoc of slotsSnap.docs.slice(i, i + MAX_BATCH_WRITES)) {
        const wasBooked =
          (slotDoc.data() as ObservationSlot).status === OBSERVATION_SLOT_STATUS.booked;
        batch.update(slotDoc.ref, {
          status: OBSERVATION_SLOT_STATUS.blocked,
          blockedReason: SLOT_BLOCKED_REASON.windowCancelled,
          ...(wasBooked ? { bookedBy: null, bookedAt: null, observationId: null } : {}),
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

    // Cancellation notices — best-effort, after the teardown so a send
    // failure never leaves booking state behind.
    let bookingCancelledSends = 0;
    let windowCancelledSends = 0;
    if (scheduling.cancellationEmailEnabled) {
      // Building display names for the booked-slot emails, one read each.
      const buildingNames = new Map<string, string>();
      for (const buildingId of new Set(booked.map((slot) => slot.buildingId))) {
        try {
          const bSnap = await db.collection(COLLECTIONS.buildings).doc(buildingId).get();
          buildingNames.set(
            buildingId,
            bSnap.exists ? (bSnap.data() as Building).displayName : buildingId,
          );
        } catch (err) {
          logger.warn('cancelObservationWindow: building lookup failed', { buildingId, err });
          buildingNames.set(buildingId, buildingId);
        }
      }

      for (const slot of booked) {
        const staffEmail = slot.bookedBy;
        if (!staffEmail) continue;
        // The invitee snapshot (matched by booked slot) carries the display
        // name; fall back to the email if it's somehow missing.
        const invitee = window.invitees.find((inv) => inv.bookedSlotId === slot.slotId);
        const slotStart = toDate(slot.startUTC);
        const slotEnd = toDate(slot.endUTC);
        try {
          const sent = await sendTemplatedEmail({
            db,
            triggerType: 'scheduling.bookingCancelled',
            to: [staffEmail, window.observerEmail].filter(Boolean),
            vars: {
              observerName: window.observerName,
              observerEmail: window.observerEmail,
              observedName: invitee?.name ?? staffEmail,
              observedEmail: staffEmail,
              slotDateLocal: formatChicagoDate(slotStart),
              slotStartLocal: formatChicagoTime(slotStart),
              slotEndLocal: formatChicagoTime(slotEnd),
              slotPeriodName: slot.periodName,
              buildingName: buildingNames.get(slot.buildingId) ?? slot.buildingId,
              cancellationReason: reason,
            },
            mailDocId: windowCancelBookingMailDocId(windowId, slot.slotId),
            auditDetails: {
              windowId,
              slotId: slot.slotId,
              triggerType: 'scheduling.bookingCancelled',
            },
          });
          if (sent) bookingCancelledSends += 1;
        } catch (err) {
          logger.error('cancelObservationWindow: booking-cancelled send failed', {
            windowId,
            slotId: slot.slotId,
            err,
          });
        }
      }

      for (const invitee of nonBookedInvitees(window.invitees)) {
        try {
          const sent = await sendTemplatedEmail({
            db,
            triggerType: 'scheduling.windowCancelled',
            to: invitee.email,
            vars: {
              observerName: window.observerName,
              observerEmail: window.observerEmail,
              observedName: invitee.name,
              observedEmail: invitee.email,
              windowStartLocal: formatYMD(window.startDate),
              windowEndLocal: formatYMD(window.endDate),
              cancellationReason: reason,
            },
            mailDocId: windowCancelledNoticeMailDocId(windowId, invitee.email, invitee.buildingId),
            auditDetails: {
              windowId,
              inviteeEmail: invitee.email,
              triggerType: 'scheduling.windowCancelled',
            },
          });
          if (sent) windowCancelledSends += 1;
        } catch (err) {
          logger.error('cancelObservationWindow: window-cancelled send failed', {
            windowId,
            email: invitee.email,
            err,
          });
        }
      }
    }

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: now,
      userEmail,
      action: AUDIT_ACTIONS.windowCancelled,
      target: `${COLLECTIONS.observationWindows}/${windowId}`,
      details: {
        reason,
        blockedSlotCount: slots.length,
        bookedSlotCount: booked.length,
        cleanedDraftCount,
        bookingCancelledSends,
        windowCancelledSends,
      },
    });

    return { ok: true };
  },
);
