import {
  HttpsError,
  onCall as baseOnCall,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS, DEMO_EDIT_CLAIM } from '@ops/shared';

/** A demo-edit session: someone driving this account via View As + Edit. */
export function isDemoEditSession(
  auth: { token: Record<string, unknown> } | null | undefined,
): boolean {
  return typeof auth?.token[DEMO_EDIT_CLAIM] === 'string';
}

/**
 * Every callable goes through this instead of firebase-functions' onCall.
 *
 * Demo-edit sessions are refused unless the callable opts in with
 * `allowDemoEdit` — and those that do must themselves confine the session
 * to demo staff (callerObservationAccess / assertDemoEditTarget). Default
 * deny, so a new callable can't accidentally let a demo session change
 * real data.
 *
 * Archived staff (`isActive: false` on their live /staff doc) are refused
 * too, unless the callable opts in with `allowArchived` (only syncMyClaims,
 * which downgrades their claims). Their ID token can still carry the role
 * and isAdmin claims they held before archiving until it refreshes, and
 * several callables authorize on those claims or on the live doc's role,
 * so this one check covers them all.
 */
export function onCall<T = unknown>(
  opts: CallableOptions & { allowDemoEdit?: boolean; allowArchived?: boolean },
  handler: (request: CallableRequest<T>) => unknown,
) {
  const { allowDemoEdit = false, allowArchived = false, ...rest } = opts;
  return baseOnCall<T>(rest, (request: CallableRequest<T>) => {
    if (!allowDemoEdit && isDemoEditSession(request.auth)) {
      throw new HttpsError(
        'permission-denied',
        'Not available while editing as someone else (demo). Only demo staff can be changed.',
      );
    }
    if (allowArchived || typeof request.auth?.token.email !== 'string') return handler(request);
    return assertNotArchived(getFirestore(), request.auth).then(() => handler(request));
  });
}

/** Whether `email`'s live /staff doc is archived. A missing doc or one
 *  without the field counts as active (the schema default). */
export async function isArchivedStaff(db: Firestore, email: string): Promise<boolean> {
  const snap = await db.doc(`${COLLECTIONS.staff}/${email.toLowerCase()}`).get();
  return snap.exists && (snap.data() as { isActive?: unknown } | undefined)?.isActive === false;
}

/** Whether the caller is archived. In a demo-edit session the driver
 *  (demoEditBy) counts too, or archiving them wouldn't end the session. */
export async function isArchivedCaller(
  db: Firestore,
  auth: { token: Record<string, unknown> } | null | undefined,
): Promise<boolean> {
  const emails = [auth?.token['email'], auth?.token[DEMO_EDIT_CLAIM]].filter(
    (e): e is string => typeof e === 'string' && e !== '',
  );
  const archived = await Promise.all(emails.map((e) => isArchivedStaff(db, e)));
  return archived.includes(true);
}

/** Refuse an archived caller, whatever their token claims. */
export async function assertNotArchived(
  db: Firestore,
  auth: { token: Record<string, unknown> } | null | undefined,
): Promise<void> {
  if (await isArchivedCaller(db, auth)) {
    throw new HttpsError('permission-denied', 'Your staff account is archived.');
  }
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
