import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

const ADMIN = 'principal@orono.k12.mn.us';
const DEMO = 'spartan.teacher@orono.k12.mn.us';
const REAL = 'real.teacher@orono.k12.mn.us';

const staff = (email: string, extra: Record<string, unknown> = {}) => ({
  email,
  name: email,
  role: 'teacher',
  year: 2,
  buildings: ['High School'],
  cycleStatus: 'high',
  isActive: true,
  ...extra,
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', ADMIN), staff(ADMIN, { role: 'administrator' }));
    await setDoc(doc(db, 'staff', DEMO), staff(DEMO, { isDemo: true }));
    await setDoc(doc(db, 'staff', REAL), staff(REAL));
    for (const [id, observed] of [
      ['demoObs', DEMO],
      ['realObs', REAL],
    ] as const) {
      await setDoc(doc(db, 'observations', id), {
        observerEmail: ADMIN,
        observedEmail: observed,
        status: 'Draft',
        type: 'Standard',
      });
    }
  });
});

/** The admin's account, driven by someone else's View As + Edit grant. */
const demoSession = () =>
  testEnv
    .authenticatedContext('admin', { ...claims.admin(ADMIN), demoEditBy: 'viewer@orono.k12.mn.us' })
    .firestore();
const realSession = () => testEnv.authenticatedContext('admin', claims.admin(ADMIN)).firestore();

const newObs = (observedEmail: string) => ({
  observerEmail: ADMIN,
  observedEmail,
  status: 'Draft',
  type: 'Standard',
});

describe('demo-edit sessions (View As + Edit)', () => {
  it("can create, edit and delete demo staff's observations", async () => {
    const db = demoSession();
    await assertSucceeds(setDoc(doc(db, 'observations', 'n1'), newObs(DEMO)));
    await assertSucceeds(updateDoc(doc(db, 'observations', 'demoObs'), { observationName: 'x' }));
    await assertSucceeds(deleteDoc(doc(db, 'observations', 'demoObs')));
  });

  it("cannot touch a real teacher's observations", async () => {
    const db = demoSession();
    await assertFails(setDoc(doc(db, 'observations', 'n2'), newObs(REAL)));
    await assertFails(updateDoc(doc(db, 'observations', 'realObs'), { observationName: 'x' }));
    await assertFails(deleteDoc(doc(db, 'observations', 'realObs')));
  });

  it('can edit the demo staff record but no one else, and nothing else', async () => {
    const db = demoSession();
    await assertSucceeds(updateDoc(doc(db, 'staff', DEMO), { year: 3 }));
    await assertFails(updateDoc(doc(db, 'staff', REAL), { year: 3 }));
    await assertFails(
      setDoc(doc(db, 'workProductQuestions', 'q'), {
        questionId: 'q',
        text: 'x',
        type: 'standard',
        phase: 'pre',
        order: 0,
        isActive: true,
        setId: 'building-ohs',
        buildingId: 'ohs',
      }),
    );
  });

  it('leaves the same account unrestricted outside a demo session', async () => {
    const db = realSession();
    await assertSucceeds(updateDoc(doc(db, 'observations', 'realObs'), { observationName: 'x' }));
  });
});
