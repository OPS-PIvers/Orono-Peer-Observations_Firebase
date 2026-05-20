/**
 * Google Calendar OAuth — client-side consent kickoff.
 *
 * We use a full-page redirect to Google's OAuth 2.0 consent screen rather
 * than a popup so the flow survives third-party-cookie restrictions and
 * mobile browsers cleanly. Google redirects back to our callback route with
 * `?code=...&state=...`; `CalendarCallbackPage` exchanges the code via the
 * `connectGoogleCalendar` Cloud Function (the client never sees tokens).
 *
 * REQUIRED ENV VAR: `VITE_GOOGLE_OAUTH_CLIENT_ID` — the OAuth 2.0 web client
 * id from the Google Cloud console (set in apps/web/.env.local). The redirect
 * URI registered for that client must include
 * `${origin}/oauth/google-calendar/callback` for every origin we serve from.
 */

/** Scope we request — write access to the user's calendar events only. */
export const CALENDAR_OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Hosted-domain restriction passed to Google's account chooser. */
const HOSTED_DOMAIN = 'orono.k12.mn.us';

/** sessionStorage key holding the JSON-encoded `{ state, returnTo }` pair. */
const OAUTH_STATE_KEY = 'ops.calendarOAuth';

/** Path Google redirects back to after the consent screen. */
export const CALENDAR_CALLBACK_PATH = '/oauth/google-calendar/callback';

export interface StashedOAuthState {
  state: string;
  returnTo: string;
}

/** Canonical redirect URI for the current origin. */
export function calendarRedirectUri(): string {
  return `${window.location.origin}${CALENDAR_CALLBACK_PATH}`;
}

/** Generate a cryptographically random CSRF state token. */
function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Persist the CSRF state + return path so the callback can verify them. */
function stashState(value: StashedOAuthState): void {
  sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(value));
}

/** Read (without clearing) the stashed OAuth state, or null if absent/invalid. */
export function readStashedOAuthState(): StashedOAuthState | null {
  const raw = sessionStorage.getItem(OAUTH_STATE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'state' in parsed &&
      'returnTo' in parsed &&
      typeof (parsed as Record<string, unknown>)['state'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['returnTo'] === 'string'
    ) {
      const obj = parsed as Record<string, unknown>;
      return { state: obj['state'] as string, returnTo: obj['returnTo'] as string };
    }
  } catch {
    // fall through to null
  }
  return null;
}

/** Remove the stashed OAuth state (call once the callback has consumed it). */
export function clearStashedOAuthState(): void {
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

/**
 * Begin the Google Calendar connect flow: build the consent URL and perform
 * a full-page redirect. Throws (without redirecting) if the client id env var
 * is missing so callers can surface a clear error.
 */
export function beginCalendarConnect(email: string, returnTo = '/profile'): void {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'Google Calendar is not configured: VITE_GOOGLE_OAUTH_CLIENT_ID is missing. ' +
        'Set it in apps/web/.env.local.',
    );
  }

  const state = randomState();
  stashState({ state, returnTo });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: calendarRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: CALENDAR_OAUTH_SCOPE,
    login_hint: email,
    hd: HOSTED_DOMAIN,
    state,
  });

  window.location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
