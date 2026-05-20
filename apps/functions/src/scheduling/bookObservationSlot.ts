import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DEFAULT_SCHEDULING_SETTINGS,
  OBSERVATION_SLOT_STATUS,
  OBSERVATION_STATUS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  bookObservationSlotInput,
  type Building,
  type ObservationSlot,
  type ObservationWindow,
  type SchedulingSettings,
  type SignupFieldAnswer,
  type Staff,
  type WindowInvitee,
} from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import { peConflicts } from './engine/timeWindows.js';
import { recomputeBlockedSlots } from './engine/blocking.js';
import { meetsLeadTime } from './engine/bookingRules.js';
import { formatChicagoDate, formatChicagoTime, toDate } from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

const BOOKABLE_WINDOW_STATUSES: string[] = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
];

/** Read /appSettings/global.scheduling, falling back to defaults. */
export async function loadSchedulingSettings(
  db: FirebaseFirestore.Firestore,
): Promise<SchedulingSettings> {
  const snap = await db.collection(COLLECTIONS.appSettings).doc(APP_SETTINGS_DOC_ID).get();
  const scheduling = snap.data()?.['scheduling'] as Partial<SchedulingSettings> | undefined;
  return { ...DEFAULT_SCHEDULING_SETTINGS, ...(scheduling ?? {}) };
}

/** Recompute window status from its invitees' booked state. */
export function nextWindowStatus(invitees: WindowInvitee[]): string {
  const allBooked = invitees.length > 0 && invitees.every((inv) => inv.bookedSlotId != null);
  return allBooked
    ? OBSERVATION_WINDOW_STATUS.fullyBooked
    : OBSERVATION_WINDOW_STATUS.partiallyBooked;
}

/**
 * Create the Draft observation for a booking + write `observationId` back onto
 * the slot, then (best-effort) send the confirmation email. Shared by
 * bookObservationSlot and assignObservationFromPreference.
 */
export async function createDraftObservationForBooking(args: {
  db: FirebaseFirestore.Firestore;
  window: ObservationWindow;
  slot: ObservationSlot;
  staffEmail: string;
  signupDetails: SignupFieldAnswer[];
  scheduling: SchedulingSettings;
  emailTrigger: 'scheduling.bookingConfirmation' | 'scheduling.assignmentNotice';
}): Promise<string> {
  const { db, window, slot, staffEmail, signupDetails, scheduling, emailTrigger } = args;

  const staffSnap = await db.collection(COLLECTIONS.staff).doc(staffEmail).get();
  const staff = staffSnap.exists ? (staffSnap.data() as Staff) : null;

  const slotStart = toDate(slot.startUTC);
  const slotEnd = toDate(slot.endUTC);

  const obsRef = db.collection(COLLECTIONS.observations).doc();
  const now = FieldValue.serverTimestamp();
  await obsRef.set({
    observationId: obsRef.id,
    observerEmail: window.observerEmail,
    observedEmail: staffEmail,
    observedName: staff?.name ?? staffEmail,
    observedRole: staff?.role ?? 'unknown',
    observedYear: staff?.year ?? 1,
    observedBuildings: staff?.buildings ?? [],
    status: OBSERVATION_STATUS.draft,
    type: window.defaultObservationType,
    observationName: window.defaultObservationName,
    observationData: {},
    componentNotes: {},
    evidenceLinks: {},
    componentTags: [],
    workProductAnswers: [],
    audioDriveFileIds: [],
    transcripts: {},
    driveFolderId: null,
    pdfDriveFileId: null,
    observationDate: Timestamp.fromDate(slotStart),
    windowId: window.windowId,
    slotId: slot.slotId,
    scheduledStartAt: Timestamp.fromDate(slotStart),
    scheduledEndAt: Timestamp.fromDate(slotEnd),
    gcalEventIds: {},
    signupDetails,
    createdAt: now,
    lastModifiedAt: now,
    finalizedAt: null,
    acknowledgedAt: null,
  });

  // Link the observation back onto the slot.
  await db
    .collection(COLLECTIONS.observationWindows)
    .doc(window.windowId)
    .collection(WINDOW_SUBCOLLECTIONS.slots)
    .doc(slot.slotId)
    .update({ observationId: obsRef.id });

  if (scheduling.confirmationEmailEnabled) {
    let buildingName = slot.buildingId;
    try {
      const bSnap = await db.collection(COLLECTIONS.buildings).doc(slot.buildingId).get();
      if (bSnap.exists) buildingName = (bSnap.data() as Building).displayName;
    } catch (err) {
      logger.warn('bookObservationSlot: building lookup failed', err);
    }

    const vars = {
      observerName: window.observerName,
      observerEmail: window.observerEmail,
      observedName: staff?.name ?? staffEmail,
      observedEmail: staffEmail,
      observedRole: staff?.role ?? '',
      observedYear: staff ? String(staff.year) : '',
      observationName: window.defaultObservationName,
      observationType: window.defaultObservationType,
      slotDateLocal: formatChicagoDate(slotStart),
      slotStartLocal: formatChicagoTime(slotStart),
      slotEndLocal: formatChicagoTime(slotEnd),
      slotPeriodName: slot.periodName,
      buildingName,
    };

    await sendTemplatedEmail({
      db,
      triggerType: emailTrigger,
      to: [staffEmail, window.observerEmail].filter(Boolean),
      vars,
      mailDocId: `${emailTrigger}-${obsRef.id}`,
      auditDetails: {
        windowId: window.windowId,
        slotId: slot.slotId,
        observationId: obsRef.id,
        triggerType: emailTrigger,
      },
    }).catch((err: unknown) => logger.error('bookObservationSlot: confirmation send failed', err));
  }

  return obsRef.id;
}

/**
 * Book an exact slot for a signed-in staff member (booking mode 'direct').
 *
 * Validates the invite token against the matching window invitee, enforces
 * lead time + PE-conflict rules, then reserves the slot in a Firestore
 * transaction that also pushes onto the window's peBusyIntervals ledger and
 * recomputes the window status. After the transaction it recomputes blocked
 * slots, creates the Draft observation, and (best-effort) emails both parties.
 */
export const bookObservationSlot = onCall(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = bookObservationSlotInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();
    const scheduling = await loadSchedulingSettings(db);
    const nowMs = Date.now();

    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const slotRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.slots).doc(input.slotId);

    let bookedSlotData: ObservationSlot | null = null;
    let bookedWindowData: ObservationWindow | null = null;

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const window = windowSnap.data() as ObservationWindow;

      if (!BOOKABLE_WINDOW_STATUSES.includes(window.status)) {
        throw new HttpsError('failed-precondition', 'Window is not open for booking');
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
      if (invitee.bookedSlotId != null) {
        throw new HttpsError('failed-precondition', 'You already have a booking in this window');
      }

      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new HttpsError('not-found', 'Slot not found');
      const slot = slotSnap.data() as ObservationSlot;

      if (slot.status !== OBSERVATION_SLOT_STATUS.available) {
        throw new HttpsError('failed-precondition', 'Slot is no longer available');
      }
      if (slot.buildingId !== invitee.buildingId) {
        throw new HttpsError('failed-precondition', 'Slot is for a different building');
      }

      const slotStart = toDate(slot.startUTC);
      const slotEnd = toDate(slot.endUTC);
      if (!meetsLeadTime(slotStart.getTime(), nowMs, scheduling.bookingLeadTimeHours)) {
        throw new HttpsError('failed-precondition', 'Slot is within the booking lead-time window');
      }
      if (peConflicts(slotStart, slotEnd, window.peBusyIntervals, window.travelBufferMinutes)) {
        throw new HttpsError('failed-precondition', 'Slot conflicts with another booking');
      }

      const bookedAt = Timestamp.now();
      tx.update(slotRef, {
        status: OBSERVATION_SLOT_STATUS.booked,
        bookedBy: userEmail,
        bookedAt,
      });

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

      bookedSlotData = { ...slot, status: OBSERVATION_SLOT_STATUS.booked, bookedBy: userEmail };
      bookedWindowData = window;
    });

    // ── Post-transaction, best-effort side effects ───────────────────────
    const slot = bookedSlotData as ObservationSlot | null;
    const window = bookedWindowData as ObservationWindow | null;
    if (!slot || !window) {
      throw new HttpsError('internal', 'Booking transaction did not complete');
    }

    await recomputeBlockedSlots(db, input.windowId).catch((err: unknown) =>
      logger.error('bookObservationSlot: recomputeBlockedSlots failed', err),
    );

    const observationId = await createDraftObservationForBooking({
      db,
      window,
      slot,
      staffEmail: userEmail,
      signupDetails: input.detailAnswers,
      scheduling,
      emailTrigger: 'scheduling.bookingConfirmation',
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: 'observationSlot.book',
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.slots}/${input.slotId}`,
      details: { windowId: input.windowId, slotId: input.slotId, observationId },
    });

    return { observationId };
  },
);
