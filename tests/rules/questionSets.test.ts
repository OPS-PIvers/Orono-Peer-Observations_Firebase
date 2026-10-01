import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

const ADMIN = 'principal@orono.k12.mn.us';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', ADMIN), { role: 'administrator', buildings: ['High School'] });
    await setDoc(doc(db, 'buildings', 'ohs'), { buildingId: 'ohs', displayName: 'High School' });
    await setDoc(doc(db, 'buildings', 'oms'), { buildingId: 'oms', displayName: 'Middle School' });
    await setDoc(doc(db, 'workProductQuestions', 'mine'), question('ohs'));
    await setDoc(doc(db, 'workProductQuestions', 'theirs'), question('oms'));
    await setDoc(doc(db, 'workProductQuestions', 'district'), {
      questionId: 'district',
      text: 'District question',
      type: 'standard',
      phase: 'pre',
      order: 0,
      isActive: true,
    });
  });
});

function question(buildingId: string, overrides: Record<string, unknown> = {}) {
  return {
    questionId: `q-${buildingId}`,
    text: 'What are you hoping to see?',
    type: 'standard',
    phase: 'pre',
    order: 0,
    isActive: true,
    setId: `building-${buildingId}`,
    buildingId,
    ...overrides,
  };
}

const adminDb = () => testEnv.authenticatedContext('admin', claims.admin(ADMIN)).firestore();

describe("workProductQuestions: building Administrators manage their buildings' sets", () => {
  it('can create, edit, deactivate and delete in their own building set', async () => {
    const db = adminDb();
    await assertSucceeds(setDoc(doc(db, 'workProductQuestions', 'new'), question('ohs')));
    await assertSucceeds(updateDoc(doc(db, 'workProductQuestions', 'mine'), { text: 'Edited' }));
    await assertSucceeds(updateDoc(doc(db, 'workProductQuestions', 'mine'), { isActive: false }));
    await assertSucceeds(deleteDoc(doc(db, 'workProductQuestions', 'mine')));
  });

  it("cannot touch another building's set or the district set", async () => {
    const db = adminDb();
    await assertFails(setDoc(doc(db, 'workProductQuestions', 'x'), question('oms')));
    await assertFails(updateDoc(doc(db, 'workProductQuestions', 'theirs'), { text: 'Nope' }));
    await assertFails(deleteDoc(doc(db, 'workProductQuestions', 'theirs')));
    await assertFails(updateDoc(doc(db, 'workProductQuestions', 'district'), { text: 'Nope' }));
  });

  it('cannot move a question into or out of their set, or change its type', async () => {
    const db = adminDb();
    await assertFails(
      updateDoc(doc(db, 'workProductQuestions', 'mine'), { setId: 'global', buildingId: '' }),
    );
    await assertFails(
      updateDoc(doc(db, 'workProductQuestions', 'theirs'), {
        setId: 'building-ohs',
        buildingId: 'ohs',
      }),
    );
    await assertFails(updateDoc(doc(db, 'workProductQuestions', 'mine'), { type: 'work-product' }));
    await assertFails(
      setDoc(doc(db, 'workProductQuestions', 'y'), question('ohs', { setId: 'district-admin' })),
    );
  });

  it('Peer Evaluators cannot write questions; everyone can read them', async () => {
    const pe = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(setDoc(doc(pe, 'workProductQuestions', 'z'), question('ohs')));
    await assertSucceeds(getDoc(doc(pe, 'workProductQuestions', 'mine')));
  });

  it('Full Access can write any set', async () => {
    const fa = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(updateDoc(doc(fa, 'workProductQuestions', 'theirs'), { text: 'OK' }));
  });
});
