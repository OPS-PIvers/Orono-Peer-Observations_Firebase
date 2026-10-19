import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  deleteDoc,
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
  await seedView('obs1');
});

const PE_EMAIL = 'pe@orono.k12.mn.us';
const OBSERVED_EMAIL = 'teacher@orono.k12.mn.us';
const OTHER_TEACHER_EMAIL = 'teacher2@orono.k12.mn.us';

/** A view as onObservationTeacherView writes it (all sharing off). */
async function seedView(id: string, overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'teacherViews', id), {
      observationId: id,
      observerEmail: PE_EMAIL,
      observedEmail: OBSERVED_EMAIL,
      observedName: 'Test Teacher',
      status: 'Draft',
      type: 'Standard',
      createdAt: new Date(),
      ...overrides,
    });
  });
}

const teacherDb = () =>
  testEnv.authenticatedContext('teacher', claims.teacher(OBSERVED_EMAIL)).firestore();

describe('teacherViews: read access', () => {
  it('observed teacher can get their view', async () => {
    await assertSucceeds(getDoc(doc(teacherDb(), 'teacherViews/obs1')));
  });

  it('observed teacher can list their views filtered to themselves', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(teacherDb(), 'teacherViews'),
          where('observedEmail', '==', OBSERVED_EMAIL),
          where('status', '==', 'Draft'),
        ),
      ),
    );
  });

  it('observed teacher cannot list views without the observedEmail filter', async () => {
    await assertFails(getDocs(collection(teacherDb(), 'teacherViews')));
  });

  it('another teacher cannot get or list it', async () => {
    const db = testEnv.authenticatedContext('t2', claims.teacher(OTHER_TEACHER_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, 'teacherViews/obs1')));
    await assertFails(
      getDocs(query(collection(db, 'teacherViews'), where('observedEmail', '==', OBSERVED_EMAIL))),
    );
  });

  it('the observer cannot read it (they read the observation itself)', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, 'teacherViews/obs1')));
  });

  it('Full Access cannot read it (views are for the observed teacher only)', async () => {
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertFails(getDoc(doc(db, 'teacherViews/obs1')));
  });

  it('an outside-domain account cannot read it', async () => {
    const db = testEnv.authenticatedContext('out', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'teacherViews/obs1')));
  });

  it('an unauthenticated client cannot read it', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'teacherViews/obs1')));
  });
});

describe('teacherViews: writes are server-only', () => {
  it('observed teacher cannot create, update or delete their view', async () => {
    const db = teacherDb();
    await assertFails(
      setDoc(doc(db, 'teacherViews/obs2'), { observedEmail: OBSERVED_EMAIL, status: 'Draft' }),
    );
    await assertFails(updateDoc(doc(db, 'teacherViews/obs1'), { observationData: {} }));
    await assertFails(deleteDoc(doc(db, 'teacherViews/obs1')));
  });

  it('the observer cannot write it', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'teacherViews/obs1'), { status: 'Finalized' }));
    await assertFails(deleteDoc(doc(db, 'teacherViews/obs1')));
  });

  it('Full Access cannot write it', async () => {
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertFails(
      setDoc(doc(db, 'teacherViews/obs3'), { observedEmail: OBSERVED_EMAIL, status: 'Draft' }),
    );
    await assertFails(deleteDoc(doc(db, 'teacherViews/obs1')));
  });
});
