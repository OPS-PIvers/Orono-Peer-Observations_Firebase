import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import type { ObservationWindow } from '@ops/shared';
import { callerMeetsAccessLevel } from '../lib/callerAccess.js';

/**
 * Who may manage (edit, resend invites for, cancel, assign within) a
 * scheduling window: its observer, or district oversight (Full Access; not
 * hasAdminAccess). Building Administrators manage their own windows only,
 * like any observer.
 *
 * Throws `permission-denied` otherwise. Callers run this before reading
 * anything about the people on the request, so an unauthorized caller gets
 * the same answer whatever they asked about. Returns whether the caller has
 * oversight, for callers that need it later.
 */
export async function assertCanManageWindow(
  db: Firestore,
  args: {
    callerEmail: string;
    tokenRole: string | null | undefined;
    window: Pick<ObservationWindow, 'observerEmail'>;
    message: string;
  },
): Promise<boolean> {
  const { callerEmail, tokenRole, window, message } = args;
  const isOversight = await callerMeetsAccessLevel(db, {
    email: callerEmail,
    tokenRole,
    level: 'oversight',
  });
  if (!isOversight && window.observerEmail !== callerEmail) {
    throw new HttpsError('permission-denied', message);
  }
  return isOversight;
}
