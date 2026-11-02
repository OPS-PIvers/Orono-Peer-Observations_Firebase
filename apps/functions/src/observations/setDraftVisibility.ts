import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DRAFT_VISIBILITY_HIDDEN,
  OBSERVATION_STATUS,
  canManageObservation,
  setDraftVisibilityInput,
  teacherViewOf,
  type DraftVisibility,
  type Observation,
} from '@ops/shared';
import { callerObservationAccess } from '../lib/observationAccess.js';

if (getApps().length === 0) initializeApp();

/**
 * Turn one Draft sharing switch on or off (owner or oversight only, the same
 * people the rules let write `draftVisibility`).
 *
 * The observed teacher reads a Draft only through `/teacherViews`, which
 * onObservationTeacherView rewrites a moment after each observation write.
 * For a switch turned off, that moment is too long: the hidden content would
 * stay readable until the trigger ran. This writes the switch and the
 * teacher's copy in one transaction, so when the call returns the content is
 * already gone from the teacher's copy (and from their open page, which
 * listens to it). The trigger still runs afterwards and writes the same view.
 */
export const setDraftVisibility = onCall(
  {
    // Demo-edit sessions allowed; callerObservationAccess confines them to
    // demo staff's observations, matching the rule's notDemoEdit() clause.
    allowDemoEdit: true,
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const userEmail = request.auth.token.email?.toLowerCase();
    if (!userEmail) throw new HttpsError('unauthenticated', 'Token has no email');

    const parsed = setDraftVisibilityInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId, key, value } = parsed.data;

    const db = getFirestore();
    const auth = request.auth;
    const callerRole = auth.token['role'] as string | undefined;
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);
    const viewRef = db.doc(`${COLLECTIONS.teacherViews}/${observationId}`);

    const next = await db.runTransaction(async (tx) => {
      const snap = await tx.get(obsRef);
      const raw = snap.data();
      if (!snap.exists || !raw) throw new HttpsError('not-found', 'Observation not found');
      const obs = raw as Observation;
      if (obs.status !== OBSERVATION_STATUS.draft) {
        throw new HttpsError(
          'failed-precondition',
          'Sharing can only be changed while the observation is a Draft.',
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
          'Only the observer who created this observation can change what is shared.',
        );
      }

      // Raw reads skip schema defaults: keep only real booleans.
      const stored: unknown = raw['draftVisibility'];
      const flags: DraftVisibility = { ...DRAFT_VISIBILITY_HIDDEN };
      for (const k of Object.keys(flags) as (keyof DraftVisibility)[]) {
        flags[k] = !!stored && typeof stored === 'object' && Reflect.get(stored, k) === true;
      }
      flags[key] = value;

      tx.update(obsRef, {
        draftVisibility: flags,
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
      tx.set(viewRef, {
        ...teacherViewOf({ ...raw, draftVisibility: flags }, observationId),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return flags;
    });

    return { ok: true, draftVisibility: next };
  },
);
