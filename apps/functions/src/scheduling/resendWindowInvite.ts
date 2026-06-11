import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  isAdminRole,
  resendWindowInviteInput,
  type Building,
  type ObservationWindow,
  type WindowInvitee,
} from '@ops/shared';
import { APP_URL, resendWindowInviteMailDocId, sendTemplatedEmail } from '../lib/emailUtils.js';
import { inviteeEntryKey } from './createObservationWindow.js';
import { formatYMD } from './engine/schedulingEmail.js';

if (getApps().length === 0) initializeApp();

/**
 * Locate the invitee entry on a window for a given email + building. Returns
 * undefined when no matching entry exists (the same person can appear at two
 * buildings, so email alone is not unique — see {@link inviteeEntryKey}).
 */
export function findInvitee(
  invitees: WindowInvitee[],
  email: string,
  buildingId: string,
): WindowInvitee | undefined {
  const key = inviteeEntryKey(email, buildingId);
  return invitees.find((inv) => inviteeEntryKey(inv.email, inv.buildingId) === key);
}

/**
 * Stamp inviteSentAt on exactly the matching invitee entry (email + building),
 * leaving every other entry untouched and unmutated. Used after a successful
 * resend so the window detail view reflects the new send time.
 */
export function stampResentInvitee(
  invitees: WindowInvitee[],
  email: string,
  buildingId: string,
  sentAt: Date,
): WindowInvitee[] {
  const key = inviteeEntryKey(email, buildingId);
  return invitees.map((inv) =>
    inviteeEntryKey(inv.email, inv.buildingId) === key ? { ...inv, inviteSentAt: sentAt } : inv,
  );
}

/**
 * Resend a single invitee's window-invite email.
 *
 * Allowed for an admin or the window's own observer. Re-uses the
 * `scheduling.windowInvite` template (same booking link/token) but mints a
 * fresh, timestamped /mail doc id so the Trigger Email extension actually
 * re-sends (it only sends on doc creation). On success the invitee entry's
 * `inviteSentAt` is updated so the window detail view shows the new time.
 */
export const resendWindowInvite = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = resendWindowInviteInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { windowId } = parsed.data;
    const inviteeEmail = parsed.data.email.toLowerCase();
    const { buildingId } = parsed.data;

    const db = getFirestore();
    const windowRef = db.collection(COLLECTIONS.observationWindows).doc(windowId);
    const windowSnap = await windowRef.get();
    if (!windowSnap.exists) throw new HttpsError('not-found', 'Window not found');
    const window = windowSnap.data() as ObservationWindow;

    const callerRole = request.auth.token['role'] as string | undefined;
    const isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin && window.observerEmail !== callerEmail) {
      throw new HttpsError(
        'permission-denied',
        'Only the observer or an admin can resend invites.',
      );
    }

    const invitee = findInvitee(window.invitees, inviteeEmail, buildingId);
    if (!invitee) {
      throw new HttpsError('not-found', 'Invitee not found on this window.');
    }
    if (invitee.bookedSlotId) {
      throw new HttpsError(
        'failed-precondition',
        'This invitee has already booked — nothing to resend.',
      );
    }

    let buildingName = invitee.buildingId;
    try {
      const bSnap = await db.collection(COLLECTIONS.buildings).doc(invitee.buildingId).get();
      if (bSnap.exists) buildingName = (bSnap.data() as Building).displayName;
    } catch (err) {
      logger.warn('resendWindowInvite: building lookup failed', {
        buildingId: invitee.buildingId,
        err,
      });
    }

    const bookingLink = `${APP_URL}/book/${windowId}?token=${invitee.inviteToken}`;
    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'scheduling.windowInvite',
      to: invitee.email,
      vars: {
        observerName: window.observerName,
        observerEmail: window.observerEmail,
        observedName: invitee.name,
        observedEmail: invitee.email,
        staffName: invitee.name,
        staffEmail: invitee.email,
        staffRole: invitee.role,
        bookingLink,
        buildingName,
        windowStartLocal: formatYMD(window.startDate),
        windowEndLocal: formatYMD(window.endDate),
      },
      mailDocId: resendWindowInviteMailDocId(
        windowId,
        invitee.email,
        invitee.buildingId,
        Date.now(),
      ),
      auditDetails: {
        windowId,
        inviteeEmail: invitee.email,
        buildingId: invitee.buildingId,
        triggerType: 'scheduling.windowInvite',
        resent: true,
      },
    });

    if (!sent) {
      throw new HttpsError(
        'failed-precondition',
        'No active invite email template — enable one before resending.',
      );
    }

    // Reflect the resend on the window doc so the detail view shows the new time.
    const stamped = stampResentInvitee(
      window.invitees,
      invitee.email,
      invitee.buildingId,
      new Date(),
    );
    await windowRef
      .update({ invitees: stamped, updatedAt: FieldValue.serverTimestamp() })
      .catch((err: unknown) =>
        logger.error('resendWindowInvite: inviteSentAt update failed', { windowId, err }),
      );

    return { ok: true };
  },
);
