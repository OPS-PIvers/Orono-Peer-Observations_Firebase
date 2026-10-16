import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  canCreateObservations,
  canManageObservation,
  setCoObserversInput,
  type Observation,
} from '@ops/shared';
import { callerObservationAccess } from '../lib/observationAccess.js';

if (getApps().length === 0) initializeApp();

/** The /staff fields checked for an added co-observer. Raw Admin SDK reads
 *  skip the Zod defaults, so each may be missing. */
interface CoObserverStaffFields {
  role?: string;
  isActive?: boolean;
}

/**
 * Set who co-observes a Draft observation (owner or oversight only).
 *
 * Co-observers read and edit the Draft and get the Drive folder shared with
 * them (onObservationWritten), so they must hold an observer role: a Peer
 * Evaluator, Administrator or Full Access. Firestore rules can't check the
 * role of every address in a list, so this callable is the only writer of
 * `coObserverEmails`; the owner's direct write is blocked in firestore.rules.
 *
 * Only *added* addresses are checked. Ones already on the list stay even if
 * they no longer qualify (role change, deactivation), so the owner can still
 * remove them one at a time and saving never fails on a legacy entry.
 */
export const setCoObservers = onCall(
  {
    // Demo-edit sessions allowed; callerObservationAccess confines them to
    // demo staff's observations, matching the rule's notDemoEdit() clause.
    allowDemoEdit: true,
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = setCoObserversInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId } = parsed.data;
    const next = [...new Set(parsed.data.coObserverEmails)];

    const db = getFirestore();
    const auth = request.auth;
    const callerRole = auth.token['role'] as string | undefined;
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(obsRef);
      if (!snap.exists) throw new HttpsError('not-found', 'Observation not found');
      const obs = snap.data() as Observation;
      if (obs.status !== OBSERVATION_STATUS.draft) {
        throw new HttpsError(
          'failed-precondition',
          'Co-observers can only be changed while the observation is a Draft.',
        );
      }

      // Owner, or oversight on someone else's observation (never their own).
      const access = await callerObservationAccess(db, obs, {
        email: userEmail,
        tokenRole: callerRole,
        auth,
      });
      if (!canManageObservation(access)) {
        throw new HttpsError(
          'permission-denied',
          'Only the observer who created this observation can change its co-observers.',
        );
      }

      const ownerEmail = obs.observerEmail.toLowerCase();
      const observedEmail = obs.observedEmail.toLowerCase();
      if (next.includes(ownerEmail)) {
        throw new HttpsError('invalid-argument', "The observer can't also be a co-observer.");
      }
      if (next.includes(observedEmail)) {
        throw new HttpsError(
          'invalid-argument',
          "The person being observed can't be a co-observer.",
        );
      }

      // Raw reads skip schema defaults, so don't trust the field's shape.
      const stored: unknown = obs.coObserverEmails;
      const current = new Set(
        Array.isArray(stored)
          ? stored.filter((e): e is string => typeof e === 'string').map((e) => e.toLowerCase())
          : [],
      );
      const added = next.filter((email) => !current.has(email));
      const staffSnaps = await Promise.all(
        added.map((email) => tx.get(db.doc(`${COLLECTIONS.staff}/${email}`))),
      );
      added.forEach((email, i) => {
        const staffSnap = staffSnaps[i];
        const staff = staffSnap?.exists
          ? (staffSnap.data() as CoObserverStaffFields | undefined)
          : undefined;
        if (!staff || staff.isActive === false || !canCreateObservations(staff.role)) {
          throw new HttpsError(
            'invalid-argument',
            `${email} can't co-observe: only Peer Evaluators, Administrators and Full Access staff can.`,
          );
        }
      });

      tx.update(obsRef, {
        coObserverEmails: next,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  },
);
