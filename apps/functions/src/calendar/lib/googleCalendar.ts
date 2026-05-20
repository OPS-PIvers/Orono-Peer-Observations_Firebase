import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { google, type calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { COLLECTIONS, type Observation, type ObservationWindow } from '@ops/shared';
import { APP_URL } from '../../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * Per-user Google Calendar integration.
 *
 * Unlike Drive/Sheets (which use the runtime SA), calendar events are written
 * to each staff member's OWN calendar via the OAuth refresh token they granted
 * during connect. Tokens live in /userCalendarTokens/{lowercased email} and are
 * SERVER-ONLY — never logged, never returned to the client.
 *
 * Params:
 *   GOOGLE_OAUTH_CLIENT_ID     (defineString) — OAuth web client id
 *   GOOGLE_OAUTH_CLIENT_SECRET (defineSecret) — OAuth web client secret
 *
 * The frontend uses the same client id, exposed to Vite as
 * `VITE_GOOGLE_OAUTH_CLIENT_ID` (see the SDK auth flow on the web side).
 */
export const GOOGLE_OAUTH_CLIENT_ID = defineString('GOOGLE_OAUTH_CLIENT_ID');
export const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');

/** The Calendar scope we require to write events on a user's behalf. */
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Construct a fresh OAuth2 client. `redirectUri` is only needed for the
 *  authorization-code exchange; event operations don't use it. */
function buildOAuthClient(redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2({
    clientId: GOOGLE_OAUTH_CLIENT_ID.value(),
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET.value(),
    ...(redirectUri ? { redirectUri } : {}),
  });
}

function tokensRef(email: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTIONS.userCalendarTokens).doc(email.toLowerCase());
}

export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  scopes: string[];
  googleAccountEmail: string | null;
}

/**
 * Exchange an authorization code for tokens. Verifies the returned id_token
 * and surfaces the granting Google account's email. Throws on any failure;
 * callers translate to HttpsError.
 */
export async function exchangeCodeForTokens(
  authorizationCode: string,
  redirectUri: string,
): Promise<ExchangedTokens> {
  const client = buildOAuthClient(redirectUri);
  const { tokens } = await client.getToken(authorizationCode);

  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh_token returned — the consent request must use access_type=offline and prompt=consent.',
    );
  }

  let googleAccountEmail: string | null = null;
  if (tokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: GOOGLE_OAUTH_CLIENT_ID.value(),
      });
      googleAccountEmail = ticket.getPayload()?.email?.toLowerCase() ?? null;
    } catch (err) {
      logger.warn('exchangeCodeForTokens: id_token verification failed', err);
    }
  }

  const scopes =
    typeof tokens.scope === 'string' && tokens.scope.length > 0 ? tokens.scope.split(' ') : [];

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? null,
    accessTokenExpiresAt:
      typeof tokens.expiry_date === 'number'
        ? new Date(tokens.expiry_date).toISOString()
        : null,
    scopes,
    googleAccountEmail,
  };
}

/** Best-effort revoke of a refresh token at Google. Never throws. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    const client = buildOAuthClient();
    await client.revokeToken(refreshToken);
  } catch (err) {
    logger.warn('revokeRefreshToken: revoke failed (best-effort)', err);
  }
}

/** Narrow an unknown error to Google's `invalid_grant` (revoked/expired). */
function isInvalidGrant(err: unknown): boolean {
  const e = err as { response?: { data?: { error?: string } }; message?: string } | undefined;
  return (
    e?.response?.data?.error === 'invalid_grant' ||
    (typeof e?.message === 'string' && e.message.includes('invalid_grant'))
  );
}

/**
 * Build a Calendar client authenticated as `email`'s connected account.
 * Returns null (never throws) when:
 *   - no token doc exists, or status !== 'connected'
 *   - the refresh token is revoked (`invalid_grant`) — also marks the doc
 *     `status:'revoked'` so the next connect prompt is shown.
 * On a refreshed access token, persists it back to the doc.
 */
export async function getCalendarClientFor(
  email: string,
): Promise<calendar_v3.Calendar | null> {
  const ref = tokensRef(email);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as Record<string, unknown>;
  if (data['status'] !== 'connected') return null;
  const refreshToken = data['refreshToken'];
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) return null;

  const client = buildOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  // Persist refreshed access tokens so subsequent calls reuse them.
  client.on('tokens', (tokens) => {
    if (!tokens.access_token) return;
    ref
      .update({
        accessToken: tokens.access_token,
        accessTokenExpiresAt:
          typeof tokens.expiry_date === 'number'
            ? new Date(tokens.expiry_date).toISOString()
            : null,
        updatedAt: Timestamp.now().toDate().toISOString(),
      })
      .catch((err: unknown) =>
        logger.warn('getCalendarClientFor: failed to persist refreshed token', err),
      );
  });

  try {
    // Force a token refresh up front so an invalid_grant surfaces here (and
    // not mid-event-insert), letting us mark the doc revoked cleanly.
    await client.getAccessToken();
  } catch (err) {
    if (isInvalidGrant(err)) {
      await ref
        .update({
          status: 'revoked',
          lastError: 'invalid_grant',
          updatedAt: Timestamp.now().toDate().toISOString(),
        })
        .catch((updErr: unknown) =>
          logger.warn('getCalendarClientFor: failed to mark revoked', updErr),
        );
      logger.warn('getCalendarClientFor: refresh token revoked', { email: email.toLowerCase() });
      return null;
    }
    logger.warn('getCalendarClientFor: token refresh failed', err);
    return null;
  }

  return google.calendar({ version: 'v3', auth: client });
}

/** Resolve the primary calendar id stored for a user (defaults to 'primary'). */
async function primaryCalendarId(email: string): Promise<string> {
  const snap = await tokensRef(email).get();
  const id = snap.data()?.['primaryCalendarId'];
  return typeof id === 'string' && id.length > 0 ? id : 'primary';
}

/** Coerce a Firestore Timestamp / Date / ISO string into a JS Date. */
function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return d instanceof Date ? d : null;
    } catch {
      return null;
    }
  }
  return null;
}

export interface CreateObservationEventArgs {
  observation: Observation;
  window: ObservationWindow;
  /** Calendar client for the observer, or null when not connected. */
  observerCal: calendar_v3.Calendar | null;
  /** Calendar client for the observed staff, or null when not connected. */
  observedCal: calendar_v3.Calendar | null;
}

export interface ObservationEventIds {
  observer?: string;
  observed?: string;
}

/**
 * Insert ONE logical observation event onto whichever party calendars are
 * available. A shared `iCalUID` links the two copies so Google treats them as
 * the same meeting. Best-effort per calendar — a missing/revoked token for one
 * party never blocks the other. Returns the created event ids per calendar.
 */
export async function createObservationEvent(
  args: CreateObservationEventArgs,
): Promise<ObservationEventIds> {
  const { observation, window, observerCal, observedCal } = args;

  const start = toDate(observation.scheduledStartAt);
  const end = toDate(observation.scheduledEndAt);
  if (!start || !end) {
    logger.warn('createObservationEvent: observation missing scheduled times', {
      observationId: observation.observationId,
    });
    return {};
  }

  const summary =
    window.calendarEventTitle && window.calendarEventTitle.length > 0
      ? window.calendarEventTitle
      : observation.observationName || 'Peer Observation';

  const link = `${APP_URL}/observations/${observation.observationId}`;
  const baseDescription = window.calendarEventDescription ?? '';
  const description = baseDescription ? `${baseDescription}\n\n${link}` : link;

  const iCalUID = `observation-${observation.observationId}@orono.k12.mn.us`;
  const sendUpdates: 'none' | 'all' = window.gcalSendUpdates === 'all' ? 'all' : 'none';

  const requestBody: calendar_v3.Schema$Event = {
    iCalUID,
    summary,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: [{ email: observation.observerEmail }, { email: observation.observedEmail }],
  };

  const result: ObservationEventIds = {};

  if (observerCal) {
    const id = await insertEvent(
      observerCal,
      await primaryCalendarId(observation.observerEmail),
      requestBody,
      sendUpdates,
      'observer',
      observation.observationId,
    );
    if (id) result.observer = id;
  }

  if (observedCal) {
    const id = await insertEvent(
      observedCal,
      await primaryCalendarId(observation.observedEmail),
      requestBody,
      sendUpdates,
      'observed',
      observation.observationId,
    );
    if (id) result.observed = id;
  }

  return result;
}

async function insertEvent(
  cal: calendar_v3.Calendar,
  calendarId: string,
  requestBody: calendar_v3.Schema$Event,
  sendUpdates: 'none' | 'all',
  who: 'observer' | 'observed',
  observationId: string,
): Promise<string | null> {
  try {
    const res = await cal.events.insert({
      calendarId,
      sendUpdates,
      requestBody,
    });
    return res.data.id ?? null;
  } catch (err) {
    logger.warn('createObservationEvent: insert failed (best-effort)', {
      who,
      observationId,
      err,
    });
    return null;
  }
}

/** Best-effort delete of a previously created event. Never throws. */
export async function deleteObservationEvent(email: string, eventId: string): Promise<void> {
  if (!eventId) return;
  try {
    const cal = await getCalendarClientFor(email);
    if (!cal) return;
    await cal.events.delete({
      calendarId: await primaryCalendarId(email),
      eventId,
      sendUpdates: 'none',
    });
  } catch (err) {
    const status = (err as { code?: number })?.code;
    // 404/410 — already gone; treat as success.
    if (status === 404 || status === 410) return;
    logger.warn('deleteObservationEvent: delete failed (best-effort)', { email: email.toLowerCase(), err });
  }
}

/** Best-effort patch of a previously created event. Never throws. */
export async function updateObservationEvent(
  email: string,
  eventId: string,
  patch: calendar_v3.Schema$Event,
  sendUpdates: 'none' | 'all' = 'none',
): Promise<void> {
  if (!eventId) return;
  try {
    const cal = await getCalendarClientFor(email);
    if (!cal) return;
    await cal.events.patch({
      calendarId: await primaryCalendarId(email),
      eventId,
      sendUpdates,
      requestBody: patch,
    });
  } catch (err) {
    logger.warn('updateObservationEvent: patch failed (best-effort)', { email: email.toLowerCase(), err });
  }
}
