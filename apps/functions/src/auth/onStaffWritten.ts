import { onDocumentWritten, type FirestoreEvent } from 'firebase-functions/v2/firestore';
import type { Change, DocumentSnapshot } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, isCanonicalStaffEmail, type Role } from '@ops/shared';
import { sendTemplatedEmail } from '../lib/emailUtils.js';
import { claimsForStaff } from './staffClaims.js';

if (getApps().length === 0) initializeApp();

/**
 * Re-syncs an auth user's custom claims when their /staff/{email} doc
 * changes. Covers:
 *   - admin promotes someone (Teacher → Peer Evaluator) — claims updated
 *     so the next token refresh picks up new permissions
 *   - admin archives a staff member (isActive: false) — role goes to null,
 *     hasSpecialAccess and isAdmin to false even though the doc keeps its
 *     role (they can still sign in, but rules block sensitive ops)
 *   - staff doc deleted entirely — claims cleared
 *
 * If the matching auth user doesn't exist yet (admin pre-provisioned a
 * staff member who hasn't signed in yet), claims wait for first sign-in via
 * syncMyClaims, but the new-staff invite still goes out on creation.
 *
 * Note: existing tokens still carry old claims until they refresh. The
 * web client's AuthProvider exposes `refreshClaims()` for promote-then-
 * test cases.
 */
export const onStaffWritten = onDocumentWritten(
  { document: 'staff/{email}', region: 'us-central1', memory: '256MiB' },
  (event) => handleStaffWritten(event),
);

/**
 * Core handler for the /staff/{email} write trigger, extracted from the
 * onDocumentWritten wrapper so it can be unit-tested with a plain event object
 * (the wrapper itself reconstructs the event from a raw CloudEvent envelope,
 * which is impractical to fake).
 */
export async function handleStaffWritten(
  event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { email: string }>,
): Promise<void> {
  const email = event.params.email;
  // Only the canonical (lowercase, district) doc speaks for a person.
  // getUserByEmail ignores case, so acting on a case-variant doc would
  // overwrite the real user's claims from a record that isn't theirs, and
  // an off-domain id would get a district invite.
  if (!isCanonicalStaffEmail(email)) {
    logger.warn('onStaffWritten: ignoring non-canonical staff doc id', { email });
    return;
  }
  const after = event.data?.after.data() as
    | {
        role?: string;
        hasAdminAccess?: boolean;
        isActive?: boolean;
        name?: string;
        year?: number;
      }
    | undefined;
  const { role, hasSpecialAccess, isAdmin } = claimsForStaff(after);

  let user: UserRecord | null;
  try {
    user = await getAuth().getUserByEmail(email);
  } catch (err) {
    // user-not-found is the common case (staff doc created before the
    // person ever signed in). Skip claims, but fall through so a brand-new
    // staff member still gets their invite.
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : null;
    if (code !== 'auth/user-not-found') throw err;
    logger.info('onStaffWritten: no auth user yet for', { email });
    user = null;
  }

  if (user) {
    await getAuth().setCustomUserClaims(user.uid, { role, hasSpecialAccess, isAdmin });
    logger.info('onStaffWritten: claims synced', { email, role, hasSpecialAccess, isAdmin });
  }

  // New staff invite email — only on creation (before=null) for active staff
  const isNewStaff = !event.data?.before.exists && event.data?.after.exists;
  if (isNewStaff && after?.isActive) {
    try {
      const db = getFirestore();
      // Resolve role slug → displayName for the invite email so the
      // recipient sees a human-readable role.
      let roleLabel = after.role ?? '';
      if (after.role) {
        const roleDoc = await db.doc(`${COLLECTIONS.roles}/${after.role}`).get();
        if (roleDoc.exists) {
          roleLabel = (roleDoc.data() as Role).displayName;
        }
      }
      await sendTemplatedEmail({
        db,
        triggerType: 'staff.created',
        to: email,
        vars: {
          staffName: after.name ?? email.split('@')[0],
          staffEmail: email,
          staffRole: roleLabel,
          staffYear: String(after.year ?? 1),
          observedName: after.name ?? email.split('@')[0],
          observedEmail: email,
        },
        mailDocId: `invite-${email.replace('@', '-at-')}`,
        auditDetails: { email, triggerType: 'staff.created' },
      });
    } catch (emailErr) {
      logger.error('onStaffWritten: invite email failed (non-fatal)', emailErr);
    }
  }
}
