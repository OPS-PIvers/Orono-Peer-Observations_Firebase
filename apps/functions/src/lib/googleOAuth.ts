import { defineSecret, defineString } from 'firebase-functions/params';

/**
 * The project's Google OAuth web client. Shared by the per-user Calendar
 * integration (calendar/lib/googleCalendar.ts) and the Drive client
 * (lib/drive.ts), which acts as the observations folder owner.
 *
 * Params:
 *   GOOGLE_OAUTH_CLIENT_ID     (defineString) — OAuth web client id
 *   GOOGLE_OAUTH_CLIENT_SECRET (defineSecret) — OAuth web client secret
 *
 * The frontend uses the same client id, exposed to Vite as
 * `VITE_GOOGLE_OAUTH_CLIENT_ID`.
 */
export const GOOGLE_OAUTH_CLIENT_ID = defineString('GOOGLE_OAUTH_CLIENT_ID');
export const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
