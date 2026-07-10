import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  emailPreferences,
  updateEmailPreferencesInput,
  type EmailPreferences,
  type UpdateEmailPreferencesInput,
} from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Self-service callable: the signed-in caller patches their own
 * /staff/{email}.emailPreferences. Firestore rules only allow admins to
 * write /staff/{email} directly (StaffDialog etc.), so this narrow callable
 * is the one path a non-admin staff member has to change their own
 * preferences from the Profile page.
 */
export const updateEmailPreferences = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30 },
  async (request): Promise<EmailPreferences> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = updateEmailPreferencesInput.safeParse(request.data ?? {});
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'Invalid email preferences payload');
    }
    const patch: UpdateEmailPreferencesInput = parsed.data;

    const db = getFirestore();
    const ref = db.doc(`${COLLECTIONS.staff}/${callerEmail}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No staff record for this account');

    const current = snap.data()?.['emailPreferences'] as Partial<EmailPreferences> | undefined;
    // emailPreferences.parse fills any still-missing key with its zod
    // default (true) — safe even if `current`/`patch` are empty or partial.
    const next: EmailPreferences = emailPreferences.parse({ ...current, ...patch });

    await ref.update({ emailPreferences: next, updatedAt: Timestamp.now() });
    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: Timestamp.now(),
      userEmail: callerEmail,
      action: AUDIT_ACTIONS.emailPreferencesUpdated,
      target: `staff/${callerEmail}`,
      details: { emailPreferences: next },
    });

    return next;
  },
);
