import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isAdminRole, type Role, type Staff } from '@ops/shared';
import { sendTemplatedEmail, staffInviteMailDocId } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

interface ResendStaffInviteRequest {
  email?: string;
}

/**
 * Admin-only callable that re-sends the staff.created invite email to an
 * existing staff member.
 *
 * Design notes:
 *  - Admin-only: only callers with an admin role may trigger this.
 *  - Reuses the same `sendTemplatedEmail` + `staffInviteMailDocId` helpers as
 *    the `onStaffWritten` trigger so the email template and mail-doc naming
 *    stay in sync.
 *  - A fresh timestamp in the mail doc id guarantees a new /mail document is
 *    created each time (the Trigger Email extension only sends on *creation*).
 *  - Returns `{ sent: boolean }` — false means no active staff.created
 *    template is configured, which is fine (admin can fix the template first).
 */
export const resendStaffInvite = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const callerRole = request.auth.token['role'] as string | undefined;
    if (!isAdminRole(callerRole ?? null)) {
      throw new HttpsError('permission-denied', 'Only admins can resend invite emails');
    }

    const { email } = (request.data ?? {}) as ResendStaffInviteRequest;
    if (!email || typeof email !== 'string' || email.trim() === '') {
      throw new HttpsError('invalid-argument', 'email is required');
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new HttpsError('invalid-argument', 'email is not a valid email address');
    }

    const db = getFirestore();

    // Load the staff doc to build template vars.
    const staffSnap = await db.collection(COLLECTIONS.staff).doc(normalizedEmail).get();
    if (!staffSnap.exists) {
      throw new HttpsError('not-found', `No staff doc found for ${normalizedEmail}`);
    }
    const staffData = staffSnap.data() as Staff;
    if (!staffData.isActive) {
      throw new HttpsError(
        'failed-precondition',
        `Staff member ${normalizedEmail} is archived — restore them before resending an invite`,
      );
    }

    // Resolve role slug → displayName for the invite email body.
    let roleLabel = staffData.role;
    const roleDoc = await db.doc(`${COLLECTIONS.roles}/${staffData.role}`).get();
    if (roleDoc.exists) {
      roleLabel = (roleDoc.data() as Role).displayName;
    }

    const nowMs = Date.now();
    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'staff.created',
      to: normalizedEmail,
      vars: {
        staffName: staffData.name,
        staffEmail: normalizedEmail,
        staffRole: roleLabel,
        staffYear: String(staffData.year),
        observedName: staffData.name,
        observedEmail: normalizedEmail,
      },
      mailDocId: staffInviteMailDocId(normalizedEmail, nowMs),
      auditDetails: {
        email: normalizedEmail,
        triggerType: 'staff.created',
        callerEmail: request.auth.token.email,
        resend: true,
      },
    });

    logger.info('resendStaffInvite: processed', { email: normalizedEmail, sent });
    return { sent };
  },
);
