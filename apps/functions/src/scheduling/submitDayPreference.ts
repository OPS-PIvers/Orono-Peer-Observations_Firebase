import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  submitDayPreferenceInput,
  type ObservationPreference,
  type ObservationWindow,
} from '@ops/shared';
import {
  applyDayCountChange,
  dayHasCapacity,
  isWindowBookingClosed,
  unknownAnswerFieldIds,
} from './engine/bookingRules.js';

if (getApps().length === 0) initializeApp();

const BOOKABLE_WINDOW_STATUSES: string[] = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
];

/** UTC weekday (0=Sun..6=Sat) for a building-local YYYY-MM-DD. */
function weekdayOfYMD(ymd: string): number {
  const parts = ymd.split('-').map(Number);
  const [y, m, d] = parts as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Submit (or change) a day preference for booking mode 'day-preference'.
 *
 * Validates the invite token, that the chosen date is inside the window and
 * on an included weekday, and that the day still has capacity under the cap.
 * Runs in a transaction so dayCounts accounting stays consistent when an
 * invitee moves their preference between days.
 */
export const submitDayPreference = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = submitDayPreferenceInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();
    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const prefRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.preferences).doc(userEmail);

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const window = windowSnap.data() as ObservationWindow;

      if (window.bookingMode !== 'day-preference') {
        throw new HttpsError('failed-precondition', 'Window is not in day-preference mode');
      }
      if (!BOOKABLE_WINDOW_STATUSES.includes(window.status)) {
        throw new HttpsError('failed-precondition', 'Window is not open for booking');
      }
      if (isWindowBookingClosed(window.endDate, new Date())) {
        throw new HttpsError('failed-precondition', 'Window booking period has ended');
      }

      const invitee = window.invitees.find(
        (inv) => inv.email === userEmail && inv.inviteToken === input.inviteToken,
      );
      if (!invitee) {
        throw new HttpsError('permission-denied', 'Invalid invite token for this user');
      }
      if (invitee.bookedSlotId != null) {
        throw new HttpsError('failed-precondition', 'You already have a booking in this window');
      }

      const ymd = input.preferredDateYMD;
      if (ymd < window.startDate || ymd > window.endDate) {
        throw new HttpsError('invalid-argument', 'Preferred date is outside the window');
      }
      if (!window.weekdaysIncluded.includes(weekdayOfYMD(ymd))) {
        throw new HttpsError('invalid-argument', 'Preferred date is not an included weekday');
      }

      // Validate every answer references a field configured on the window.
      const unknownFields = unknownAnswerFieldIds(input.detailAnswers, window.signupFieldIds);
      if (unknownFields.length > 0) {
        throw new HttpsError(
          'invalid-argument',
          `Unknown signup field: ${unknownFields.join(', ')}`,
        );
      }

      const prefSnap = await tx.get(prefRef);
      const previousYMD = prefSnap.exists
        ? (prefSnap.data() as ObservationPreference).preferredDateYMD
        : null;

      // Capacity check applies only to days the invitee is newly occupying.
      if (previousYMD !== ymd) {
        const currentCount = window.dayCounts[ymd] ?? 0;
        if (!dayHasCapacity(currentCount, window.perDayCap)) {
          throw new HttpsError('failed-precondition', 'That day is full');
        }
      }

      const now = FieldValue.serverTimestamp();
      const preference: Record<string, unknown> = {
        email: userEmail,
        name: invitee.name,
        buildingId: invitee.buildingId,
        preferredDateYMD: ymd,
        detailAnswers: input.detailAnswers,
        submittedAt: now,
        assignedSlotId: prefSnap.exists
          ? ((prefSnap.data() as ObservationPreference).assignedSlotId ?? null)
          : null,
        assignedAt: prefSnap.exists
          ? ((prefSnap.data() as ObservationPreference).assignedAt ?? null)
          : null,
      };
      tx.set(prefRef, preference);

      const dayCounts = applyDayCountChange(window.dayCounts, ymd, previousYMD);
      tx.update(windowRef, { dayCounts, updatedAt: now });
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: AUDIT_ACTIONS.dayPreferenceSubmitted,
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.preferences}/${userEmail}`,
      details: { windowId: input.windowId, preferredDateYMD: input.preferredDateYMD },
    });

    return { ok: true };
  },
);
