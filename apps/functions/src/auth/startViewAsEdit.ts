import { HttpsError } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  DEMO_EDIT_CLAIM,
  SPECIAL_ROLES,
  type Staff,
} from '@ops/shared';
import { isDemoEditSession, onCall } from '../lib/callable.js';

if (getApps().length === 0) initializeApp();

/** Roles a demo-edit session may sign in as: the observers whose workflows
 *  the walkthrough videos show. Never Full Access (the Admin Console). */
const EDITABLE_ROLES: readonly string[] = [
  SPECIAL_ROLES.administrator,
  SPECIAL_ROLES.peerEvaluator,
];

/**
 * View As + Edit: returns a custom token that signs the caller's browser in
 * as `email` (an Administrator or Peer Evaluator) for a demo walkthrough.
 * The token carries DEMO_EDIT_CLAIM = the caller, which firestore.rules and
 * the callable wrapper use to confine every write to demo staff (isDemo).
 * Only staff granted canViewAsEdit (active) may start one; each start is
 * audit-logged. Ending the session is just signing out.
 */
export async function handleStartViewAsEdit(
  db: Firestore,
  auth: Auth,
  caller: { token: Record<string, unknown> } | undefined,
  data: unknown,
): Promise<{ token: string }> {
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required');
  if (isDemoEditSession(caller)) {
    throw new HttpsError('failed-precondition', 'Already editing as someone else.');
  }
  const rawCallerEmail = caller.token['email'];
  const callerEmail = typeof rawCallerEmail === 'string' ? rawCallerEmail.toLowerCase() : '';
  if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');
  const rawEmail = (data as { email?: unknown } | null)?.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!email.includes('@')) throw new HttpsError('invalid-argument', 'email required');
  if (email === callerEmail) {
    throw new HttpsError('invalid-argument', 'You are already signed in as yourself.');
  }

  const [callerSnap, targetSnap] = await Promise.all([
    db.doc(`${COLLECTIONS.staff}/${callerEmail}`).get(),
    db.doc(`${COLLECTIONS.staff}/${email}`).get(),
  ]);
  const callerStaff = callerSnap.exists ? (callerSnap.data() as Partial<Staff>) : null;
  if (callerStaff?.canViewAsEdit !== true || callerStaff.isActive === false) {
    throw new HttpsError('permission-denied', 'View As + Edit is not enabled for your account.');
  }
  const target = targetSnap.exists ? (targetSnap.data() as Partial<Staff>) : null;
  if (!target || target.isActive === false) {
    throw new HttpsError('not-found', 'That staff member is not active.');
  }
  if (!EDITABLE_ROLES.includes(target.role ?? '') || target.hasAdminAccess === true) {
    throw new HttpsError(
      'failed-precondition',
      'Edits are only available while viewing as an Administrator or Peer Evaluator.',
    );
  }

  let uid: string;
  try {
    uid = (await auth.getUserByEmail(email)).uid;
  } catch {
    throw new HttpsError(
      'failed-precondition',
      `${target.name ?? email} has never signed in, so there is no account to edit as yet.`,
    );
  }

  let token: string;
  try {
    token = await auth.createCustomToken(uid, { [DEMO_EDIT_CLAIM]: callerEmail });
  } catch (err) {
    // Usually the functions service account lacking
    // iam.serviceAccounts.signBlob (Service Account Token Creator).
    throw new HttpsError(
      'internal',
      `Could not start an edit session: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: callerEmail,
    action: AUDIT_ACTIONS.viewAsEditStarted,
    target: `${COLLECTIONS.staff}/${email}`,
    details: { viewedEmail: email },
  });
  return { token };
}

export const startViewAsEdit = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30 },
  (request) => handleStartViewAsEdit(getFirestore(), getAuth(), request.auth, request.data),
);
