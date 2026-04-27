import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
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

describe('default-deny + domain check', () => {
  it('blocks unauthenticated reads', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'random/whatever')));
  });

  it('blocks signed-in users from outside the domain', async () => {
    const db = testEnv.authenticatedContext('outsider', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'staff/someone@gmail.com')));
  });
});

describe('/staff', () => {
  it('lets a staff member read their own staff doc', async () => {
    const email = 'paul.ivers@orono.k12.mn.us';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'staff', email), { name: 'Paul', role: 'Teacher' });
    });
    const db = testEnv.authenticatedContext('paul', claims.teacher(email)).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff', email)));
  });

  it('blocks a teacher from reading another staff doc', async () => {
    const me = 'a@orono.k12.mn.us';
    const other = 'b@orono.k12.mn.us';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'staff', other), { name: 'B' });
    });
    const db = testEnv.authenticatedContext('a', claims.teacher(me)).firestore();
    await assertFails(getDoc(doc(db, 'staff', other)));
  });

  it('lets a Peer Evaluator list/read all staff', async () => {
    const me = 'pe@orono.k12.mn.us';
    const other = 'b@orono.k12.mn.us';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'staff', other), { name: 'B' });
    });
    const db = testEnv.authenticatedContext('pe', claims.peerEval(me)).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff', other)));
    await assertSucceeds(getDocs(collection(db, 'staff')));
  });

  it('blocks teachers from listing staff', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(getDocs(collection(db, 'staff')));
  });

  it('lets admins create + update staff', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'staff/new@orono.k12.mn.us'), {
        name: 'New',
        role: 'Teacher',
        year: 1,
        buildings: ['OMS'],
        summativeYear: false,
        isActive: true,
      }),
    );
    await assertSucceeds(updateDoc(doc(db, 'staff/new@orono.k12.mn.us'), { isActive: false }));
  });

  it('blocks PEs from writing staff', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(
      setDoc(doc(db, 'staff/x@orono.k12.mn.us'), { name: 'X', role: 'Teacher', year: 1 }),
    );
  });
});
