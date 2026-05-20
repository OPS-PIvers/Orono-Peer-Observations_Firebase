import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type CalendarConnectionStatusResult } from '@ops/shared';
import { GOOGLE_OAUTH_CLIENT_SECRET, revokeRefreshToken } from '../lib/googleCalendar.js';

if (getApps().length === 0) initializeApp();

/**
 * Disconnect the caller's Google Calendar: revoke the refresh token at Google
 * (best-effort) and delete the token doc. Returns the disconnected status.
 */
export const disconnectGoogleCalendar = onCall(
  {
    region: 'us-central1',
    secrets: [GOOGLE_OAUTH_CLIENT_SECRET],
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request): Promise<CalendarConnectionStatusResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const callerEmail = request.auth.token.email?.toLowerCase();
    if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.userCalendarTokens).doc(callerEmail);
    const snap = await ref.get();

    if (snap.exists) {
      const data = snap.data() ?? {};
      const refreshToken: unknown = data['refreshToken'];
      if (typeof refreshToken === 'string' && refreshToken.length > 0) {
        await revokeRefreshToken(refreshToken);
      }
      await ref.delete();
      await db.collection(COLLECTIONS.auditLog).add({
        timestamp: Timestamp.now(),
        userEmail: callerEmail,
        action: 'calendar.disconnect',
        target: `${COLLECTIONS.userCalendarTokens}/${callerEmail}`,
        details: {},
      });
    }

    return { status: 'disconnected', googleAccountEmail: null };
  },
);
