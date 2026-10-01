import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { AUDIT_ACTIONS, COLLECTIONS, isSpecialRole, type Staff } from '@ops/shared';

if (getApps().length === 0) initializeApp();

export interface ViewAsCaller {
  token: { email?: string | undefined; role?: unknown; isAdmin?: unknown };
}

/**
 * Audit-logs the start of a read-only "view as" session (the web app calls
 * this when someone picks a person in the View As picker). Only callers who
 * may view as someone are logged — anyone else is refused, mirroring the
 * web gate in DevModeProvider: canViewAs on their active staff doc, or the
 * developer escape hatch (isAdmin claim without a special role).
 */
export async function handleRecordViewAs(
  db: Firestore,
  caller: ViewAsCaller | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required');
  const callerEmail = caller.token.email?.toLowerCase();
  if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');
  const viewedEmail =
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { email?: unknown }).email === 'string'
      ? (data as { email: string }).email.trim().toLowerCase()
      : '';
  if (!viewedEmail.includes('@')) throw new HttpsError('invalid-argument', 'email required');

  const callerSnap = await db.doc(`${COLLECTIONS.staff}/${callerEmail}`).get();
  const callerStaff = callerSnap.exists ? (callerSnap.data() as Partial<Staff>) : null;
  const role = typeof caller.token.role === 'string' ? caller.token.role : null;
  const granted = callerStaff?.canViewAs === true && callerStaff.isActive !== false;
  const devHatch = caller.token.isAdmin === true && !isSpecialRole(role);
  if (!granted && !devHatch) {
    throw new HttpsError('permission-denied', 'View As is not enabled for your account.');
  }

  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: callerEmail,
    action: AUDIT_ACTIONS.viewAsStarted,
    target: `${COLLECTIONS.staff}/${viewedEmail}`,
    details: { viewedEmail },
  });
  return { ok: true };
}

export const recordViewAs = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30 },
  (request) => handleRecordViewAs(getFirestore(), request.auth, request.data),
);
