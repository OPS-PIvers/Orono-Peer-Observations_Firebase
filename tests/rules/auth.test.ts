import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
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

  it("lets a teacher list active administrators (Profile 'My Administrators' card)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'staff/admin@orono.k12.mn.us'), {
        name: 'Admin',
        role: 'administrator',
        isActive: true,
        buildings: ['OMS'],
      });
    });
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'staff'),
          where('role', '==', 'administrator'),
          where('isActive', '==', true),
        ),
      ),
    );
  });

  it('blocks a teacher from listing administrators without the isActive filter', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(
      getDocs(query(collection(db, 'staff'), where('role', '==', 'administrator'))),
    );
  });

  it('blocks a teacher from listing staff filtered to a non-administrator role', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, 'staff'),
          where('role', '==', 'teacher'),
          where('isActive', '==', true),
        ),
      ),
    );
  });

  it('blocks an outsider from listing active administrators', async () => {
    const db = testEnv.authenticatedContext('outsider', claims.outsider).firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, 'staff'),
          where('role', '==', 'administrator'),
          where('isActive', '==', true),
        ),
      ),
    );
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

describe('archived staff (claims collapsed by computeClaims)', () => {
  // Archiving a staff member (isActive → false) makes syncMyClaims /
  // onStaffWritten collapse their custom claims to
  // { role: null, hasSpecialAccess: false, isAdmin: false }. These tests pin
  // that a token in that post-archive state has no elevated access left.
  const archived = (email = 'archived@orono.k12.mn.us') => ({
    email,
    role: null,
    hasSpecialAccess: false,
    isAdmin: false,
    email_verified: true,
  });

  it('blocks an archived former Peer Evaluator from listing staff', async () => {
    const db = testEnv.authenticatedContext('archived-pe', archived()).firestore();
    await assertFails(getDocs(collection(db, 'staff')));
  });

  it("blocks an archived former Peer Evaluator from reading another's staff doc", async () => {
    const other = 'b@orono.k12.mn.us';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'staff', other), { name: 'B' });
    });
    const db = testEnv.authenticatedContext('archived-pe', archived()).firestore();
    await assertFails(getDoc(doc(db, 'staff', other)));
  });

  it('blocks an archived former admin from writing staff docs', async () => {
    const db = testEnv.authenticatedContext('archived-admin', archived()).firestore();
    await assertFails(
      setDoc(doc(db, 'staff/x@orono.k12.mn.us'), { name: 'X', role: 'teacher', year: 1 }),
    );
  });

  it('still lets an archived staff member read their own staff doc', async () => {
    const email = 'archived@orono.k12.mn.us';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'staff', email), { name: 'Archived', isActive: false });
    });
    const db = testEnv.authenticatedContext('archived', archived(email)).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff', email)));
  });
});
