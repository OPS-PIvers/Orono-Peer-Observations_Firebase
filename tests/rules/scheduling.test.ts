import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe('buildingSchedules rules', () => {
  beforeEach(async () => {
    await seed('buildingSchedules/high-school', {
      buildingId: 'high-school',
      timeZone: 'America/Chicago',
      dayTypes: [],
      isActive: true,
    });
  });

  it('domain teacher can read a schedule', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'buildingSchedules/high-school')));
  });

  it('outsider cannot read', async () => {
    const db = testEnv.authenticatedContext('o', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'buildingSchedules/high-school')));
  });

  it('admin can write a schedule', async () => {
    const db = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'buildingSchedules/middle-school'), {
        buildingId: 'middle-school',
        timeZone: 'America/Chicago',
        dayTypes: [],
        isActive: true,
      }),
    );
  });

  it('peer evaluator (non-admin) cannot write a schedule', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(
      setDoc(doc(db, 'buildingSchedules/high-school'), { isActive: false }, { merge: true }),
    );
  });

  it('teacher cannot write a schedule', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertFails(
      setDoc(doc(db, 'buildingSchedules/high-school'), { isActive: false }, { merge: true }),
    );
  });
});

describe('signupFields rules', () => {
  beforeEach(async () => {
    await seed('signupFields/f-1', {
      fieldId: 'f-1',
      label: 'Prep period',
      type: 'period-picker',
      options: [],
      appliesTo: 'both',
      required: false,
      order: 0,
      isActive: true,
    });
  });

  it('domain teacher can read fields', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'signupFields/f-1')));
  });

  it('admin can create a field', async () => {
    const db = testEnv.authenticatedContext('a', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'signupFields/f-2'), {
        fieldId: 'f-2',
        label: 'Before or after school',
        type: 'before-after',
        options: [],
        appliesTo: 'both',
        required: false,
        order: 1,
        isActive: true,
      }),
    );
  });

  it('teacher cannot write a field', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertFails(
      setDoc(doc(db, 'signupFields/f-1'), { isActive: false }, { merge: true }),
    );
  });
});
