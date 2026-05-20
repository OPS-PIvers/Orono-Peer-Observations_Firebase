import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type CalendarConnectionStatusResult } from '@ops/shared';

if (getApps().length === 0) initializeApp();

/**
 * Report the caller's Google Calendar connection status. Returns ONLY
 * `{ status, googleAccountEmail }` — never any token material. Absent doc maps
 * to 'disconnected'.
 */
export const getCalendarConnectionStatus = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30 },
  async (request): Promise<CalendarConnectionStatusResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();
    const snap = await db.collection(COLLECTIONS.userCalendarTokens).doc(callerEmail).get();
    if (!snap.exists) {
      return { status: 'disconnected', googleAccountEmail: null };
    }

    const data = snap.data() as Record<string, unknown>;
    const rawStatus = data['status'];
    const status: CalendarConnectionStatusResult['status'] =
      rawStatus === 'connected' || rawStatus === 'revoked' || rawStatus === 'error'
        ? rawStatus
        : 'disconnected';
    const googleAccountEmail =
      typeof data['googleAccountEmail'] === 'string' ? data['googleAccountEmail'] : null;

    return { status, googleAccountEmail };
  },
);
