import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  connectGoogleCalendarInput,
  type CalendarConnectionStatusResult,
} from '@ops/shared';
import {
  CALENDAR_EVENTS_SCOPE,
  GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET,
  exchangeCodeForTokens,
} from '../lib/googleCalendar.js';

if (getApps().length === 0) initializeApp();

/**
 * Connect the caller's Google Calendar.
 *
 * The web client runs the OAuth consent flow and sends us the one-time
 * authorization code. We exchange it server-side (the client secret never
 * leaves the function), require the calendar.events scope, then persist the
 * refresh token to /userCalendarTokens/{caller email}. Tokens are never
 * logged or returned.
 *
 * If the granting Google account differs from the caller's app email we still
 * store the connection, recording the actual `googleAccountEmail`.
 */
export const connectGoogleCalendar = onCall(
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

    if (!GOOGLE_OAUTH_CLIENT_ID.value()) {
      throw new HttpsError('failed-precondition', 'GOOGLE_OAUTH_CLIENT_ID is not configured.');
    }

    const parsed = connectGoogleCalendarInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const input = parsed.data;

    let tokens;
    try {
      tokens = await exchangeCodeForTokens(input.authorizationCode, input.redirectUri);
    } catch (err) {
      // Don't surface token internals; log without the code.
      logger.error('connectGoogleCalendar: code exchange failed', {
        callerEmail,
        message: (err as { message?: string }).message,
      });
      throw new HttpsError('failed-precondition', 'Authorization code exchange failed.');
    }

    // Require the calendar.events scope — without it we can't create events.
    const grantedScopes = tokens.scopes.length > 0 ? tokens.scopes : input.scopesGranted;
    if (!grantedScopes.includes(CALENDAR_EVENTS_SCOPE)) {
      throw new HttpsError(
        'failed-precondition',
        'The calendar.events scope was not granted. Re-run the consent flow and approve calendar access.',
      );
    }

    if (tokens.googleAccountEmail && tokens.googleAccountEmail !== callerEmail) {
      // Allowed, but record the mismatch so admins can see whose calendar this is.
      logger.warn('connectGoogleCalendar: granting Google account differs from app email', {
        callerEmail,
        googleAccountEmail: tokens.googleAccountEmail,
      });
    }

    const nowIso = Timestamp.now().toDate().toISOString();
    const db = getFirestore();
    await db.collection(COLLECTIONS.userCalendarTokens).doc(callerEmail).set({
      email: callerEmail,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      scopes: grantedScopes,
      googleAccountEmail: tokens.googleAccountEmail,
      status: 'connected',
      lastError: null,
      primaryCalendarId: 'primary',
      connectedAt: nowIso,
      updatedAt: nowIso,
    });

    await db.collection(COLLECTIONS.auditLog).add({
      timestamp: Timestamp.now(),
      userEmail: callerEmail,
      action: 'calendar.connect',
      target: `${COLLECTIONS.userCalendarTokens}/${callerEmail}`,
      details: { googleAccountEmail: tokens.googleAccountEmail },
    });

    return { status: 'connected', googleAccountEmail: tokens.googleAccountEmail };
  },
);
