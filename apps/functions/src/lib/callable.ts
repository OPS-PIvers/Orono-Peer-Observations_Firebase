import {
  HttpsError,
  onCall as baseOnCall,
  type CallableOptions,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  CLAIMS_EMAIL_CLAIM,
  COLLECTIONS,
  DEMO_EDIT_CLAIM,
  isSpecialRole,
  type Staff,
} from '@ops/shared';
import { claimsForStaff } from '../auth/staffClaims.js';

/** A demo-edit session: someone driving this account via View As + Edit. */
export function isDemoEditSession(
  auth: { token: Record<string, unknown> } | null | undefined,
): boolean {
  return typeof auth?.token[DEMO_EDIT_CLAIM] === 'string';
}

/** Whether the token carries a privileged claim (a special role,
 *  hasSpecialAccess or isAdmin) that something downstream authorizes on. */
function hasPrivilegedClaims(token: Record<string, unknown> | undefined): boolean {
  return (
    isSpecialRole(typeof token?.['role'] === 'string' ? token['role'] : null) ||
    token?.['hasSpecialAccess'] === true ||
    token?.['isAdmin'] === true
  );
}

/** Whether the token's privileged claims match what the live /staff doc
 *  grants now (claimsForStaff). A demotion is revoked by email too, so a uid
 *  that was away from that email when it happened can come back to it with
 *  the old claims; this catches that, and an ordinary not-yet-refreshed
 *  demotion, on the next call. */
function claimsMatchStaffDoc(token: Record<string, unknown>, self: Partial<Staff>): boolean {
  const live = claimsForStaff(self);
  return (
    (token['role'] ?? null) === live.role &&
    (token['isAdmin'] !== true || live.isAdmin) &&
    (token['hasSpecialAccess'] !== true || live.hasSpecialAccess)
  );
}

/** Whether the token's role claims were issued for the email it now carries
 *  (CLAIMS_EMAIL_CLAIM). Claims sit on the uid but are issued and revoked by
 *  email, so after the account's email changes they belong to no one. */
export function claimsBoundToToken(
  auth: { token: Record<string, unknown> } | null | undefined,
): boolean {
  const email = auth?.token['email'];
  const bound = auth?.token[CLAIMS_EMAIL_CLAIM];
  return typeof email === 'string' && typeof bound === 'string' && bound === email.toLowerCase();
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
 * so this one check covers them all. The same check refuses a token whose
 * role claims no longer belong to its email (see isArchivedCaller).
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
    if (allowArchived || !request.auth) return handler(request);
    return assertNotArchived(getFirestore(), request.auth).then(() => handler(request));
  });
}

/** Whether the caller is archived, or otherwise must be refused like one.
 *  A missing field counts as active (the schema default). A token carrying
 *  privileged claims is refused unless those claims were issued for its
 *  current email (claimsBoundToToken), that email has a /staff doc, and the
 *  doc still grants them: otherwise they may be left over from an address
 *  that has since been archived or demoted, which revocation
 *  (onStaffWritten, keyed by email) can't reach. In a
 *  demo-edit session the driver (demoEditBy) counts too: archiving them or
 *  removing their canViewAsEdit grant ends the session. A demo account
 *  (isDemo) is only usable through View As + Edit, so it's refused without
 *  the claim (e.g. via a Google identity linked to it), and a demo-edit
 *  session on a non-demo account is refused. Mirrors isActiveStaff in
 *  firestore.rules. */
export async function isArchivedCaller(
  db: Firestore,
  auth: { token: Record<string, unknown> } | null | undefined,
): Promise<boolean> {
  const [self, driver] = await Promise.all(
    [auth?.token['email'], auth?.token[DEMO_EDIT_CLAIM]].map(
      async (e): Promise<Partial<Staff> | undefined> => {
        if (typeof e !== 'string' || e === '') return undefined;
        const snap = await db.doc(`${COLLECTIONS.staff}/${e.toLowerCase()}`).get();
        return snap.exists ? snap.data() : undefined;
      },
    ),
  );
  if (self?.isActive === false) return true;
  if (
    auth &&
    hasPrivilegedClaims(auth.token) &&
    (!claimsBoundToToken(auth) || self === undefined || !claimsMatchStaffDoc(auth.token, self))
  ) {
    return true;
  }
  if (!isDemoEditSession(auth)) return self?.isDemo === true;
  return self?.isDemo !== true || driver?.isActive === false || driver?.canViewAsEdit !== true;
}

/** Refuse an archived caller, whatever their token claims. */
export async function assertNotArchived(
  db: Firestore,
  auth: { token: Record<string, unknown> } | null | undefined,
): Promise<void> {
  if (await isArchivedCaller(db, auth)) {
    throw new HttpsError(
      'permission-denied',
      'Your staff account is archived, your access needs refreshing, or this View As + Edit session is no longer allowed.',
    );
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
