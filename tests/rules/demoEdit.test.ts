import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

/** A demo Administrator: the only kind of account View As + Edit drives. */
const ADMIN = 'demo.principal@orono.k12.mn.us';
const DEMO = 'spartan.teacher@orono.k12.mn.us';
const REAL = 'real.teacher@orono.k12.mn.us';
const REAL_ADMIN = 'principal@orono.k12.mn.us';
const VIEWER = 'viewer@orono.k12.mn.us';

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
    await setDoc(doc(db, 'staff', ADMIN), staff(ADMIN, { role: 'administrator', isDemo: true }));
    await setDoc(doc(db, 'staff', REAL_ADMIN), staff(REAL_ADMIN, { role: 'administrator' }));
    await setDoc(doc(db, 'staff', VIEWER), staff(VIEWER, { canViewAs: true, canViewAsEdit: true }));
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
    await setDoc(doc(db, 'observations', 'realAdminObs'), {
      observerEmail: REAL_ADMIN,
      observedEmail: REAL,
      status: 'Draft',
      type: 'Standard',
    });
  });
});

/** The demo admin's account, driven by someone else's View As + Edit grant. */
const demoSession = () =>
  testEnv.authenticatedContext('admin', { ...claims.admin(ADMIN), demoEditBy: VIEWER }).firestore();

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

  it("ends once the driver's View As + Edit grant is removed", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'staff', VIEWER), { canViewAsEdit: false });
    });
    const db = demoSession();
    await assertFails(updateDoc(doc(db, 'observations', 'demoObs'), { observationName: 'x' }));
    await assertFails(getDocs(collection(db, 'staff')));
  });

  it('gives a demo account signed in without View As + Edit nothing', async () => {
    // e.g. a Google identity linked to the demo account's Auth user.
    const db = testEnv.authenticatedContext('admin', claims.admin(ADMIN)).firestore();
    await assertFails(updateDoc(doc(db, 'observations', 'demoObs'), { observationName: 'x' }));
    await assertFails(getDocs(collection(db, 'staff')));
  });

  it('gives a demo-edit session on a real account nothing', async () => {
    const db = testEnv
      .authenticatedContext('real', { ...claims.admin(REAL_ADMIN), demoEditBy: VIEWER })
      .firestore();
    await assertFails(updateDoc(doc(db, 'observations', 'realAdminObs'), { observationName: 'x' }));
    await assertFails(getDocs(collection(db, 'staff')));
  });

  it("leaves a real Administrator's own session unrestricted", async () => {
    const db = testEnv.authenticatedContext('real', claims.admin(REAL_ADMIN)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations', 'realAdminObs'), { observationName: 'x' }),
    );
    await assertSucceeds(getDocs(collection(db, 'staff')));
  });
});
