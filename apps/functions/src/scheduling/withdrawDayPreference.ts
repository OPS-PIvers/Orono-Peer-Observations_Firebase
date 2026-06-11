import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  OBSERVATION_WINDOW_STATUS,
  WINDOW_SUBCOLLECTIONS,
  withdrawDayPreferenceInput,
  type ObservationPreference,
  type ObservationWindow,
} from '@ops/shared';
import { removeDayCount } from './engine/bookingRules.js';

if (getApps().length === 0) initializeApp();

const BOOKABLE_WINDOW_STATUSES: string[] = [
  OBSERVATION_WINDOW_STATUS.open,
  OBSERVATION_WINDOW_STATUS.partiallyBooked,
];

/**
 * Withdraw an unassigned day preference in day-preference booking mode.
 *
 * Validates the invite token and that the preference is not yet assigned to
 * a slot. Runs in a transaction so the preference doc is deleted and the
 * day's dayCounts entry is decremented atomically.
 *
 * An already-assigned preference must be cancelled via `cancelBooking` instead
 * (which handles slot, ledger, and observation teardown). Attempting to
 * withdraw an assigned preference returns `failed-precondition`.
 */
export const withdrawDayPreference = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = withdrawDayPreferenceInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    const db = getFirestore();

    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(input.windowId);
    const prefRef = windowRef.collection(WINDOW_SUBCOLLECTIONS.preferences).doc(userEmail);

    let withdrawnYMD: string | null = null;

    await db.runTransaction(async (tx) => {
      const windowSnap = await tx.get(windowRef);
      if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
      const windowData = windowSnap.data() as ObservationWindow;

      if (windowData.bookingMode !== 'day-preference') {
        throw new HttpsError('failed-precondition', 'Window is not in day-preference mode');
      }
      if (!BOOKABLE_WINDOW_STATUSES.includes(windowData.status)) {
        throw new HttpsError('failed-precondition', 'Window is not open for booking');
      }

      const invitee = windowData.invitees.find(
        (inv) => inv.email === userEmail && inv.inviteToken === input.inviteToken,
      );
      if (!invitee) {
        throw new HttpsError('permission-denied', 'Invalid invite token for this user');
      }
      if (invitee.bookedSlotId != null) {
        throw new HttpsError(
          'failed-precondition',
          'Your booking has already been assigned. Use Cancel booking instead.',
        );
      }

      const prefSnap = await tx.get(prefRef);
      if (!prefSnap.exists) {
        throw new HttpsError('not-found', 'No preference found to withdraw');
      }
      const pref = prefSnap.data() as ObservationPreference;

      if (pref.assignedSlotId != null) {
        throw new HttpsError(
          'failed-precondition',
          'Your booking has already been assigned. Use Cancel booking instead.',
        );
      }

      withdrawnYMD = pref.preferredDateYMD;

      tx.delete(prefRef);

      const dayCounts = removeDayCount(windowData.dayCounts, pref.preferredDateYMD);
      tx.update(windowRef, { dayCounts, updatedAt: FieldValue.serverTimestamp() });
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: FieldValue.serverTimestamp(),
      userEmail,
      action: AUDIT_ACTIONS.dayPreferenceWithdrawn,
      target: `${COLLECTIONS.observationWindows}/${input.windowId}/${WINDOW_SUBCOLLECTIONS.preferences}/${userEmail}`,
      details: { windowId: input.windowId, preferredDateYMD: withdrawnYMD },
    });

    return { ok: true };
  },
);
