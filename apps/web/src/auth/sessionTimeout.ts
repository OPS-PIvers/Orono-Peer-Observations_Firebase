/**
 * Pure logic for PLAT-09 — enforcing the admin-configured
 * `appSettings.sessionDurationHours` window client-side.
 *
 * This is a SOFT, client-side timeout. Firebase ID tokens already have their
 * own refresh/expiry lifecycle managed by the SDK; nothing here changes how
 * long a refresh token is valid server-side. A true hard cutoff would
 * additionally require configuring session duration in Identity Platform
 * (a project-level Firebase Auth setting, outside this app's deploy
 * surface) — see AuthProvider.tsx for the enforcement wiring.
 *
 * Design: warn-then-sign-out, never a silent kick. A staff member scripting
 * a live classroom observation must see a countdown and get a chance to
 * extend before being signed out, not discover mid-keystroke that they've
 * been bounced to /sign-in.
 */

/** Show the warning this long before the deadline. */
export const SESSION_WARNING_WINDOW_MS = 5 * 60 * 1000;

/** How often the interval poll re-evaluates the deadline (also re-checked
 *  on window focus / tab visibility change, so a backgrounded tab can't
 *  drift past the deadline unnoticed until the user comes back to it). */
export const SESSION_CHECK_INTERVAL_MS = 15 * 1000;

/** Matches `appSettings.sessionDurationHours`'s Zod default (see
 *  packages/shared/src/schema/settings.ts) — used when the settings doc
 *  hasn't loaded yet or predates the field (raw Firestore reads bypass Zod
 *  defaults). */
export const DEFAULT_SESSION_DURATION_HOURS = 24;

export interface SessionTimeoutInput {
  /** The signed-in ID token's `auth_time` claim, as epoch ms. This is the
   *  ONE source of truth for the deadline specifically because it's minted
   *  server-side at sign-in (or re-authentication) and can't be rewound by
   *  a user clearing localStorage, nor advanced without genuinely
   *  re-proving identity. There is deliberately no separate client-tracked
   *  "extended until" anchor — see AuthProvider.tsx's `staySignedIn`, which
   *  uses `reauthenticateWithPopup` precisely so this field is the only
   *  thing that ever moves the deadline. */
  authTimeMs: number;
  /** `appSettings.sessionDurationHours * 3_600_000`. */
  sessionDurationMs: number;
  nowMs: number;
}

export type SessionTimeoutStatus =
  | { kind: 'ok' }
  | { kind: 'warning'; remainingMs: number }
  | { kind: 'expired' };

export function computeSessionTimeoutStatus(input: SessionTimeoutInput): SessionTimeoutStatus {
  const deadlineMs = input.authTimeMs + input.sessionDurationMs;
  const remainingMs = deadlineMs - input.nowMs;
  if (remainingMs <= 0) {
    return { kind: 'expired' };
  }
  if (remainingMs <= SESSION_WARNING_WINDOW_MS) {
    return { kind: 'warning', remainingMs };
  }
  return { kind: 'ok' };
}

/** "less than a minute" / "1 minute" / "4 minutes" — deliberately coarse
 *  (whole minutes) since the poll interval (15s) doesn't justify a
 *  second-precision ticker. */
export function formatRemaining(remainingMs: number): string {
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes <= 1) {
    return 'less than a minute';
  }
  return `${minutes.toString()} minutes`;
}
