import { HttpsError } from 'firebase-functions/v2/https';
import { onCall } from '../lib/callable.js';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  saveTeacherResponseInput,
  type Observation,
} from '@ops/shared';
import { callerObservationAccess } from '../lib/observationAccess.js';

if (getApps().length === 0) initializeApp();

/**
 * Save the observed teacher's answers to their Planning / Reflection
 * questions and/or their Goals & Next Steps response.
 *
 * The teacher can't read a Draft (Draft privacy), and a rule letting them
 * write it would decide allow/deny on the merged document: re-sending a
 * hidden field (a rating, a deleteField() on absent notes) with its stored
 * value is "unchanged" and allowed, any other value denied — an equality
 * oracle on everything the teacher view withholds. Here only these two
 * fields are ever written, and the outcome depends only on who the caller
 * is, the observation's status and the input itself, all of which the
 * teacher already knows.
 */
export const saveTeacherResponse = onCall(
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

    const parsed = saveTeacherResponseInput.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { observationId, workProductAnswers, goalsResponse } = parsed.data;

    const db = getFirestore();
    const auth = request.auth;
    const obsRef = db.doc(`${COLLECTIONS.observations}/${observationId}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(obsRef);
      const raw = snap.data();
      // Missing and not-yours read the same, like the rules' denial.
      const access = raw
        ? await callerObservationAccess(db, raw as Observation, {
            email: userEmail,
            tokenRole: auth.token['role'] as string | undefined,
            auth,
          })
        : null;
      if (!raw || access !== 'observed') {
        throw new HttpsError(
          'permission-denied',
          'Only the observed staff member can answer these questions.',
        );
      }
      const status: unknown = raw['status'];
      if (status !== OBSERVATION_STATUS.draft && status !== OBSERVATION_STATUS.finalized) {
        throw new HttpsError('failed-precondition', 'This observation cannot be answered.');
      }

      tx.update(obsRef, {
        ...(workProductAnswers !== undefined ? { workProductAnswers } : {}),
        ...(goalsResponse !== undefined ? { goalsResponse } : {}),
        lastModifiedAt: FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  },
);
