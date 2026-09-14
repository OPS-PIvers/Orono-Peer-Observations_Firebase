import { beforeEach, describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { AUDIT_ACTIONS, DEFAULT_STEPS } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in setStepCheck.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { handleSetStepCheck } = await import('./setStepCheck.js');
const { clearStaffStepChecks } = await import('./clearStaffStepChecks.js');

const PE = 'pe@orono.k12.mn.us';
const TEACHER = 'teacher@orono.k12.mn.us';

/**
 * Minimal in-memory Firestore: doc get/set/delete, collection add (audit
 * log) and listDocuments + batch delete (rollover). Only what the handler
 * and the rollover helper touch.
 */
function fakeDb(seed: Record<string, Record<string, unknown>>) {
  const docs = new Map(Object.entries(seed));
  const added: { collection: string; data: Record<string, unknown> }[] = [];
  const docRef = (path: string) => ({
    path,
    get: () => Promise.resolve({ exists: docs.has(path), data: () => docs.get(path) }),
    set: (data: Record<string, unknown>) => {
      docs.set(path, data);
      return Promise.resolve();
    },
    delete: () => {
      docs.delete(path);
      return Promise.resolve();
    },
  });
  const db = {
    doc: docRef,
    collection: (path: string) => ({
      add: (data: Record<string, unknown>) => {
        added.push({ collection: path, data });
        return Promise.resolve();
      },
      listDocuments: () =>
        Promise.resolve(
          [...docs.keys()]
            .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
            .map(docRef),
        ),
    }),
    batch: () => {
      const ops: (() => void)[] = [];
      return {
        delete: (ref: { path: string }) => ops.push(() => docs.delete(ref.path)),
        commit: () => {
          for (const op of ops) op();
          return Promise.resolve();
        },
      };
    },
  };
  return { db: db as unknown as Firestore, docs, added };
}

const peCaller = { token: { email: PE, role: 'peer-evaluator' } };
const teacherCaller = { token: { email: TEACHER, role: 'teacher' } };

/** Built-in steps with Planning manual, sign-up either, and the rest auto. */
function configWithModes() {
  return {
    steps: DEFAULT_STEPS.map((s) =>
      s.id === 'preObs'
        ? { ...s, completionMode: 'manual' }
        : s.id === 'signup'
          ? { ...s, completionMode: 'either' }
          : s,
    ),
  };
}

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof HttpsError ? err.code : 'not-https-error';
  }
}

let env: ReturnType<typeof fakeDb>;
beforeEach(() => {
  env = fakeDb({
    'appSettings/dashboard': configWithModes(),
    [`staff/${PE}`]: { role: 'peer-evaluator', name: 'Pat Evaluator' },
    [`staff/${TEACHER}`]: { role: 'teacher', name: 'Terry Teacher' },
    'observations/obs-1': { observedEmail: TEACHER, status: 'Finalized' },
    'observations/obs-other': { observedEmail: 'someone@orono.k12.mn.us', status: 'Draft' },
  });
});

describe('handleSetStepCheck — authorization', () => {
  it('rejects an unauthenticated call', async () => {
    expect(await codeOf(handleSetStepCheck(env.db, undefined, {}))).toBe('unauthenticated');
  });

  it('rejects a teacher, even for their own step', async () => {
    const input = { staffEmail: TEACHER, stepId: 'preObs', observationId: 'obs-1', checked: true };
    expect(await codeOf(handleSetStepCheck(env.db, teacherCaller, input))).toBe(
      'permission-denied',
    );
    expect(env.docs.has('observations/obs-1/stepChecks/preObs')).toBe(false);
  });

  it('accepts a hasAdminAccess grant via the live staff doc', async () => {
    env.docs.set(`staff/${TEACHER}`, { role: 'teacher', hasAdminAccess: true, name: 'T' });
    const input = { staffEmail: TEACHER, stepId: 'signup', checked: true };
    expect(await codeOf(handleSetStepCheck(env.db, teacherCaller, input))).toBeNull();
  });
});

describe('handleSetStepCheck — validation', () => {
  it('refuses a step whose mode is auto', async () => {
    const input = {
      staffEmail: TEACHER,
      stepId: 'observation',
      observationId: 'obs-1',
      checked: true,
    };
    expect(await codeOf(handleSetStepCheck(env.db, peCaller, input))).toBe('failed-precondition');
  });

  it('refuses an unknown step', async () => {
    const input = { staffEmail: TEACHER, stepId: 'nope', checked: true };
    expect(await codeOf(handleSetStepCheck(env.db, peCaller, input))).toBe('not-found');
  });

  it('treats every built-in step as auto when no config is saved', async () => {
    env.docs.delete('appSettings/dashboard');
    const input = { staffEmail: TEACHER, stepId: 'signup', checked: true };
    expect(await codeOf(handleSetStepCheck(env.db, peCaller, input))).toBe('failed-precondition');
  });

  it('requires an observation for an observation-tied step', async () => {
    const input = { staffEmail: TEACHER, stepId: 'preObs', checked: true };
    expect(await codeOf(handleSetStepCheck(env.db, peCaller, input))).toBe('invalid-argument');
  });

  it('refuses an observation that belongs to someone else', async () => {
    const input = {
      staffEmail: TEACHER,
      stepId: 'preObs',
      observationId: 'obs-other',
      checked: true,
    };
    expect(await codeOf(handleSetStepCheck(env.db, peCaller, input))).toBe('failed-precondition');
  });

  it('refuses an observationId for a staff-scoped step', async () => {
    const input = { staffEmail: TEACHER, stepId: 'signup', observationId: 'obs-1', checked: true };
    expect(await codeOf(handleSetStepCheck(env.db, peCaller, input))).toBe('invalid-argument');
  });

  it('rejects malformed input', async () => {
    expect(
      await codeOf(handleSetStepCheck(env.db, peCaller, { staffEmail: 'nope', stepId: 'x' })),
    ).toBe('invalid-argument');
  });
});

describe('handleSetStepCheck — writes', () => {
  it('checks an observation-tied step on a Finalized observation and audits it', async () => {
    const result = await handleSetStepCheck(env.db, peCaller, {
      staffEmail: 'Teacher@Orono.k12.mn.us',
      stepId: 'preObs',
      observationId: 'obs-1',
      checked: true,
    });
    expect(result.path).toBe('observations/obs-1/stepChecks/preObs');
    expect(env.docs.get('observations/obs-1/stepChecks/preObs')).toMatchObject({
      stepId: 'preObs',
      checkedBy: PE,
      checkedByName: 'Pat Evaluator',
    });
    expect(env.added).toHaveLength(1);
    expect(env.added[0]?.collection).toBe('auditLog');
    expect(env.added[0]?.data).toMatchObject({
      userEmail: PE,
      action: AUDIT_ACTIONS.stepCheckSet,
      target: 'observations/obs-1/stepChecks/preObs',
      details: { staffEmail: TEACHER, stepId: 'preObs', observationId: 'obs-1' },
    });
  });

  it('stores a staff-scoped step under the staff doc', async () => {
    await handleSetStepCheck(env.db, peCaller, {
      staffEmail: TEACHER,
      stepId: 'signup',
      checked: true,
    });
    expect(env.docs.has(`staff/${TEACHER}/stepChecks/signup`)).toBe(true);
  });

  it("lets any evaluator clear another evaluator's check, recording who had checked it", async () => {
    env.docs.set('observations/obs-1/stepChecks/preObs', {
      stepId: 'preObs',
      checkedBy: 'pe2@orono.k12.mn.us',
      checkedByName: 'Other PE',
    });
    await handleSetStepCheck(env.db, peCaller, {
      staffEmail: TEACHER,
      stepId: 'preObs',
      observationId: 'obs-1',
      checked: false,
    });
    expect(env.docs.has('observations/obs-1/stepChecks/preObs')).toBe(false);
    expect(env.added[0]?.data).toMatchObject({
      action: AUDIT_ACTIONS.stepCheckCleared,
      details: { previousCheckedBy: 'pe2@orono.k12.mn.us' },
    });
  });

  it('falls back to the email prefix when the caller has no staff name', async () => {
    env.docs.set(`staff/${PE}`, { role: 'peer-evaluator' });
    await handleSetStepCheck(env.db, peCaller, {
      staffEmail: TEACHER,
      stepId: 'signup',
      checked: true,
    });
    expect(env.docs.get(`staff/${TEACHER}/stepChecks/signup`)).toMatchObject({
      checkedByName: 'pe',
    });
  });
});

describe('clearStaffStepChecks', () => {
  it("removes only the listed staff members' staff-scoped checks", async () => {
    env.docs.set(`staff/${TEACHER}/stepChecks/signup`, { stepId: 'signup' });
    env.docs.set(`staff/${PE}/stepChecks/signup`, { stepId: 'signup' });
    env.docs.set('observations/obs-1/stepChecks/preObs', { stepId: 'preObs' });
    expect(await clearStaffStepChecks(env.db, [TEACHER])).toBe(1);
    expect(env.docs.has(`staff/${TEACHER}/stepChecks/signup`)).toBe(false);
    expect(env.docs.has(`staff/${PE}/stepChecks/signup`)).toBe(true);
    expect(env.docs.has('observations/obs-1/stepChecks/preObs')).toBe(true);
    expect(env.docs.has(`staff/${TEACHER}`)).toBe(true);
  });
});
