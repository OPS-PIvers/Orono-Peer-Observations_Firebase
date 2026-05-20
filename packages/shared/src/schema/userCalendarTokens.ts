import { z } from 'zod';
import { email, isoDate } from './common.js';

/**
 * /userCalendarTokens/{email} — per-user Google Calendar OAuth credentials.
 *
 * SERVER-ONLY. Firestore rules deny all client read/write; only Cloud
 * Functions (Admin SDK) touch this collection. Refresh tokens are sensitive —
 * never log them and never expose them to the client. The connection-status
 * callable returns only `{ status, googleAccountEmail }`, never token material.
 *
 * Doc id is the app user's email (lowercased), matching /staff/{email}.
 */
export const calendarConnectionStatus = z.enum(['connected', 'revoked', 'error']);
export type CalendarConnectionStatus = z.infer<typeof calendarConnectionStatus>;

export const userCalendarTokens = z.object({
  email,
  refreshToken: z.string().min(1),
  accessToken: z.string().nullable().default(null),
  accessTokenExpiresAt: isoDate.nullable().default(null),
  scopes: z.array(z.string()).default([]),
  /** The Google account that granted access (may differ from the app email). */
  googleAccountEmail: email.nullable().default(null),
  status: calendarConnectionStatus.default('connected'),
  lastError: z.string().nullable().default(null),
  primaryCalendarId: z.string().default('primary'),
  connectedAt: isoDate,
  updatedAt: isoDate,
});
export type UserCalendarTokens = z.infer<typeof userCalendarTokens>;

// --- Callable contracts (shared by Cloud Functions + web client) ---------

export const connectGoogleCalendarInput = z.object({
  authorizationCode: z.string().min(1),
  redirectUri: z.string().min(1),
  scopesGranted: z.array(z.string()).default([]),
});
export type ConnectGoogleCalendarInput = z.infer<typeof connectGoogleCalendarInput>;

/** What the status callable returns — deliberately free of token material. */
export const calendarConnectionStatusResult = z.object({
  status: z.enum(['connected', 'revoked', 'error', 'disconnected']),
  googleAccountEmail: email.nullable().default(null),
});
export type CalendarConnectionStatusResult = z.infer<typeof calendarConnectionStatusResult>;
