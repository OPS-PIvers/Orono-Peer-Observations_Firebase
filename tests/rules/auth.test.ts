import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'peer-evaluator-rubric-rules-test';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('default-deny + domain check (Phase 1 skeleton)', () => {
  it('blocks unauthenticated reads of an arbitrary doc', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'random/whatever')));
  });

  it('blocks signed-in users from non-allowed email domains', async () => {
    const db = testEnv.authenticatedContext('outsider', { email: 'someone@gmail.com' }).firestore();
    await assertFails(getDoc(doc(db, 'staff/someone@gmail.com')));
  });

  it('lets a staff member read their own staff doc', async () => {
    const email = 'paul.ivers@orono.k12.mn.us';

    // Seed via admin context (rules bypass).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'staff', email), { name: 'Paul Ivers', role: 'Administrator' });
    });

    const db = testEnv.authenticatedContext('paul', { email }).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff', email)));
  });

  it('blocks a staff member from reading another staff doc', async () => {
    const me = 'paul.ivers@orono.k12.mn.us';
    const someoneElse = 'other.person@orono.k12.mn.us';

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'staff', someoneElse), { name: 'Other', role: 'Teacher' });
    });

    const db = testEnv.authenticatedContext('paul', { email: me }).firestore();
    await assertFails(getDoc(doc(db, 'staff', someoneElse)));
  });

  it('lets an Administrator read any staff doc', async () => {
    const me = 'paul.ivers@orono.k12.mn.us';
    const someoneElse = 'other.person@orono.k12.mn.us';

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'staff', someoneElse), { name: 'Other', role: 'Teacher' });
    });

    const db = testEnv
      .authenticatedContext('paul', {
        email: me,
        role: 'Administrator',
        hasSpecialAccess: true,
      })
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'staff', someoneElse)));
  });
});
