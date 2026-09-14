import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import {
  AUDIT_ACTIONS,
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  OBSERVATION_SUBCOLLECTIONS,
  STAFF_SUBCOLLECTIONS,
  resolveSteps,
  setStepCheckInput,
  stepAllowsEvaluatorCheck,
  stepCheckScope,
  stepCompletionMode,
  type DashboardConfig,
  type Observation,
  type StepCheck,
} from '@ops/shared';
import { callerMeetsAccessLevel } from '../lib/callerAccess.js';

if (getApps().length === 0) initializeApp();

/** The slice of `request.auth` the handler reads — kept structural so tests
 *  can call the handler without a real callable request. */
export interface StepCheckCaller {
  token: { email?: string | undefined; role?: unknown };
}

/**
 * Check or un-check one dashboard step for one staff member (special access
 * only — peer evaluators, administrators, full access, hasAdminAccess).
 *
 *   1. Re-verify special access against the live /staff doc (see
 *      callerAccess.ts), so a revoked grant stops working immediately.
 *   2. Resolve the step from the saved dashboard config (or the built-in
 *      defaults) and refuse steps whose completion mode is `auto` — those
 *      complete only from their `doneWhen` event.
 *   3. Pick the storage location with `stepCheckScope`: observation-tied
 *      steps need an `observationId` whose observed staff member is
 *      `staffEmail` (any status — a Finalized observation can still have a
 *      step checked); other steps live under the staff doc.
 *   4. Write (checked) or delete (un-checked) the check doc and record the
 *      change in /auditLog. Any special-access user may clear anyone's check.
 */
export async function handleSetStepCheck(
  db: Firestore,
  caller: StepCheckCaller | undefined,
  data: unknown,
): Promise<{ ok: true; path: string }> {
  if (!caller) throw new HttpsError('unauthenticated', 'Sign in required');
  const callerEmail = caller.token.email?.toLowerCase();
  if (!callerEmail) throw new HttpsError('unauthenticated', 'Token has no email');

  const parsed = setStepCheckInput.safeParse(data);
  if (!parsed.success) {
    throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  const { staffEmail, stepId, observationId, checked } = parsed.data;

  const tokenRole = typeof caller.token.role === 'string' ? caller.token.role : undefined;
  const allowed = await callerMeetsAccessLevel(db, {
    email: callerEmail,
    tokenRole,
    level: 'special',
  });
  if (!allowed) {
    throw new HttpsError(
      'permission-denied',
      'Only peer evaluators and administrators can check off steps.',
    );
  }

  const configSnap = await db.doc(`${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`).get();
  const config = configSnap.exists ? (configSnap.data() as DashboardConfig) : null;
  const step = resolveSteps(config).find((s) => s.id === stepId);
  if (!step) throw new HttpsError('not-found', 'That dashboard step no longer exists.');
  if (!stepAllowsEvaluatorCheck(step)) {
    throw new HttpsError(
      'failed-precondition',
      'This step completes automatically and cannot be checked off.',
    );
  }

  const scope = stepCheckScope(step);
  let path: string;
  if (scope === 'observation') {
    if (!observationId) {
      throw new HttpsError('invalid-argument', 'This step is tied to an observation.');
    }
    const obsSnap = await db.doc(`${COLLECTIONS.observations}/${observationId}`).get();
    if (!obsSnap.exists) throw new HttpsError('not-found', 'Observation not found');
    const obs = obsSnap.data() as Observation;
    if (obs.observedEmail.toLowerCase() !== staffEmail) {
      throw new HttpsError(
        'failed-precondition',
        'That observation belongs to a different staff member.',
      );
    }
    path = `${COLLECTIONS.observations}/${observationId}/${OBSERVATION_SUBCOLLECTIONS.stepChecks}/${stepId}`;
  } else {
    if (observationId) {
      throw new HttpsError('invalid-argument', 'This step is not tied to an observation.');
    }
    const staffSnap = await db.doc(`${COLLECTIONS.staff}/${staffEmail}`).get();
    if (!staffSnap.exists) throw new HttpsError('not-found', 'Staff member not found');
    path = `${COLLECTIONS.staff}/${staffEmail}/${STAFF_SUBCOLLECTIONS.stepChecks}/${stepId}`;
  }

  const checkRef = db.doc(path);
  const previousSnap = await checkRef.get();
  const previous = previousSnap.exists ? (previousSnap.data() as StepCheck) : null;

  if (checked) {
    const callerSnap = await db.doc(`${COLLECTIONS.staff}/${callerEmail}`).get();
    const callerName = callerSnap.exists
      ? ((callerSnap.data() as { name?: string } | undefined)?.name ?? '')
      : '';
    await checkRef.set({
      stepId,
      checkedBy: callerEmail,
      checkedByName: callerName || (callerEmail.split('@')[0] ?? callerEmail),
      checkedAt: FieldValue.serverTimestamp(),
    });
  } else {
    await checkRef.delete();
  }

  await db.collection(COLLECTIONS.auditLog).add({
    timestamp: FieldValue.serverTimestamp(),
    userEmail: callerEmail,
    action: checked ? AUDIT_ACTIONS.stepCheckSet : AUDIT_ACTIONS.stepCheckCleared,
    target: path,
    details: {
      staffEmail,
      stepId,
      stepTitle: step.title,
      observationId: observationId ?? null,
      completionMode: stepCompletionMode(step),
      // On a clear, who had checked it — any evaluator may clear anyone's.
      previousCheckedBy: previous?.checkedBy ?? null,
    },
  });

  return { ok: true, path };
}

export const setStepCheck = onCall(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 },
  (request) => handleSetStepCheck(getFirestore(), request.auth, request.data),
);
