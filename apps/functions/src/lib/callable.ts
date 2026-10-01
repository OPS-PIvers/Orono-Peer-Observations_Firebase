import {
  HttpsError,
  onCall as baseOnCall,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DEMO_EDIT_CLAIM } from '@ops/shared';

/** A demo-edit session: someone driving this account via View As + Edit. */
export function isDemoEditSession(
  auth: { token: Record<string, unknown> } | null | undefined,
): boolean {
  return typeof auth?.token[DEMO_EDIT_CLAIM] === 'string';
}

/**
 * Every callable goes through this instead of firebase-functions' onCall.
 * Demo-edit sessions are refused unless the callable opts in with
 * `allowDemoEdit` — and those that do must themselves confine the session
 * to demo staff (callerObservationAccess / assertDemoEditTarget). Default
 * deny, so a new callable can't accidentally let a demo session change
 * real data.
 */
export function onCall<T = unknown>(
  opts: CallableOptions & { allowDemoEdit?: boolean },
  handler: (request: CallableRequest<T>) => unknown,
) {
  const { allowDemoEdit = false, ...rest } = opts;
  return baseOnCall<T>(rest, (request: CallableRequest<T>) => {
    if (!allowDemoEdit && isDemoEditSession(request.auth)) {
      throw new HttpsError(
        'permission-denied',
        'Not available while editing as someone else (demo). Only demo staff can be changed.',
      );
    }
    return handler(request);
  });
}

/**
 * In a demo-edit session, refuse unless `staffEmail` is a demo person
 * (isDemo on their staff doc). No-op for every other session. Call from
 * each `allowDemoEdit` callable with the staff member being changed.
 */
export async function assertDemoEditTarget(
  db: Firestore,
  auth: { token: Record<string, unknown> } | null | undefined,
  staffEmail: string | null | undefined,
): Promise<void> {
  if (!isDemoEditSession(auth)) return;
  if (!staffEmail || !(await isDemoStaff(db, staffEmail))) {
    throw new HttpsError(
      'permission-denied',
      'While editing as someone else (demo), only demo staff can be changed.',
    );
  }
}

export async function isDemoStaff(db: Firestore, email: string): Promise<boolean> {
  const snap = await db.doc(`${COLLECTIONS.staff}/${email.toLowerCase()}`).get();
  return snap.exists && (snap.data() as { isDemo?: unknown } | undefined)?.isDemo === true;
}
