/**
 * Authorization helpers for callable functions.
 *
 * The privilege model has two layers:
 *
 *   1. **Custom claims** — `isAdmin` and `hasSpecialAccess` are minted by
 *      `syncMyClaims` / `onStaffWritten` and stored in the ID token. They are
 *      the canonical source of truth for Firestore security rules, storage
 *      rules, and the web UI.
 *
 *   2. **Role slug** — `token.role` is also a custom claim, but it is a
 *      human-readable slug (`"administrator"`, `"peer-evaluator"`, etc.) that
 *      was sufficient as the sole privilege signal before `hasAdminAccess` was
 *      introduced. Legacy callers whose tokens predate a claim refresh still
 *      carry the slug but may not yet have `isAdmin`/`hasSpecialAccess`
 *      populated.
 *
 * These helpers apply both layers: claims-first, role-slug fallback. A staff
 * member with `hasAdminAccess=true` and a non-special role (the "dev user"
 * pattern in `DevModeContext.tsx`) must not be denied at the function layer
 * when rules and the UI already treat them as an admin.
 *
 * All helpers take the token sub-object from `request.auth` directly so they
 * are trivially unit-testable without a full `CallableRequest` stub.
 */

import { isAdminRole, isSpecialRole } from '@ops/shared';

/** Minimum token shape this module needs — subset of `DecodedIdToken`. */
export interface AuthToken {
  readonly email?: string | undefined;
  readonly [key: string]: unknown;
}

/**
 * Return the caller's email (lower-cased) from the token, or `null` if absent.
 */
export function callerEmail(token: AuthToken): string | null {
  const email = token['email'];
  if (typeof email === 'string' && email.length > 0) {
    return email.toLowerCase();
  }
  return null;
}

/**
 * True when the caller should be treated as an admin.
 *
 * Primary: `token.isAdmin === true` (the custom claim).
 * Fallback: role slug is `"administrator"` or `"full-access"` (legacy tokens
 * whose claims haven't been refreshed yet).
 */
export function callerIsAdmin(token: AuthToken): boolean {
  if (token['isAdmin'] === true) return true;
  const role = token['role'];
  return isAdminRole(typeof role === 'string' ? role : null);
}

/**
 * True when the caller has special access (filter UI, view all observations,
 * create/manage windows, send manual emails, etc.).
 *
 * Primary: `token.hasSpecialAccess === true` (the custom claim).
 * Fallback: role slug is one of the three built-in special roles
 * (`"administrator"`, `"peer-evaluator"`, `"full-access"`).
 *
 * Admin access is a strict superset of special access, so
 * `callerHasSpecialAccess` also returns `true` for admins.
 */
export function callerHasSpecialAccess(token: AuthToken): boolean {
  if (token['hasSpecialAccess'] === true) return true;
  const role = token['role'];
  const roleStr = typeof role === 'string' ? role : null;
  return isSpecialRole(roleStr) || isAdminRole(roleStr);
}
