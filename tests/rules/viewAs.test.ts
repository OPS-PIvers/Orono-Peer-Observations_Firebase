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

const VIEWER = 'viewer@orono.k12.mn.us';
const PRINCIPAL = 'principal@orono.k12.mn.us';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', VIEWER), { role: 'teacher', canViewAs: true, isActive: true });
    await setDoc(doc(db, 'staff', 'former@orono.k12.mn.us'), {
      role: 'teacher',
      canViewAs: true,
      isActive: false,
    });
    await setDoc(doc(db, 'staff', PRINCIPAL), {
      email: PRINCIPAL,
      role: 'administrator',
      buildings: ['High School'],
    });
    await setDoc(doc(db, 'observations', 'obs1'), {
      observerEmail: 'pe@orono.k12.mn.us',
      observedEmail: 'teacher@orono.k12.mn.us',
      status: 'Draft',
      type: 'Standard',
    });
  });
});

describe('View As grant (canViewAs)', () => {
  it('lets a granted viewer read observations and staff, but not write', async () => {
    const db = testEnv.authenticatedContext('v', claims.teacher(VIEWER)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
    await assertSucceeds(getDocs(collection(db, 'observations')));
    await assertSucceeds(getDocs(collection(db, 'staff')));
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observationName: 'x' }));
  });

  it('does nothing for archived staff or people without the grant', async () => {
    const former = testEnv
      .authenticatedContext('f', claims.teacher('former@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(former, 'observations/obs1')));
    const other = testEnv.authenticatedContext('o', claims.teacher()).firestore();
    await assertFails(getDocs(collection(other, 'staff')));
  });

  it('building Administrators cannot hand it out', async () => {
    const db = testEnv.authenticatedContext('p', claims.admin(PRINCIPAL)).firestore();
    await assertFails(
      setDoc(doc(db, 'staff', 'new@orono.k12.mn.us'), {
        email: 'new@orono.k12.mn.us',
        name: 'New',
        role: 'teacher',
        buildings: ['High School'],
        canViewAs: true,
      }),
    );
  });
});
