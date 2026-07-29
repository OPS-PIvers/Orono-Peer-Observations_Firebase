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
 *  - Admin-only: any caller whose role is an admin role (isAdminRole), OR
 *    whose live /staff doc has `hasAdminAccess: true`, may trigger this —
 *    mirroring the isAdmin computation in syncMyClaims.ts (`isAdminRole(role)
 *    || hasAdminAccess`). We check the live staff doc rather than trusting
 *    only the `isAdmin` token claim: a hasAdminAccess grant made mid-session
 *    isn't reflected in the caller's current token until they force a
 *    refresh (see reopenObservation.ts / migrateRolesToSlugs.ts for the same
 *    pattern), so relying on the claim alone would still latent-fail for a
 *    freshly-granted hasAdminAccess admin.
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
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();

    // Admin-only. Check the live staff doc rather than only the token role
    // claim so hasAdminAccess grants (which rules honor via the isAdmin
    // claim) work here too — see the design note above.
    const callerRole = request.auth.token['role'] as string | undefined;
    let isAdmin = isAdminRole(callerRole ?? null);
    if (!isAdmin) {
      const callerSnap = await db.doc(`${COLLECTIONS.staff}/${callerEmail}`).get();
      const caller = callerSnap.exists ? (callerSnap.data() as Staff) : null;
      isAdmin = !!caller && (isAdminRole(caller.role) || caller.hasAdminAccess);
    }
    if (!isAdmin) {
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
