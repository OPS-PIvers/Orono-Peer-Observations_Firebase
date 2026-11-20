import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { claims, setupTestEnv } from './harness.js';

/**
 * The token email is user-changeable. An account that sets an unclaimed
 * roster address as its email (unverified, or via a provider other than
 * Google) must not pass as that staff member anywhere in the rules.
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

const VICTIM = 'teacher@orono.k12.mn.us';
const BRANDING = 'admin-uploads/branding/logo.png';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'appSettings', 'general'), { appName: 'OPS' });
    await setDoc(doc(db, 'staff', VICTIM), { email: VICTIM, role: 'teacher', modules: ['mentor'] });
    await setDoc(doc(db, 'observations', 'obs1'), {
      observerEmail: 'pe@orono.k12.mn.us',
      observedEmail: VICTIM,
      status: 'Finalized',
      finalizedAt: new Date(),
    });
    await setDoc(doc(db, 'windowInviteViews', `w1_${VICTIM}`), { email: VICTIM });
    await uploadString(ref(ctx.storage(), BRANDING), 'logo');
  });
});

const untrusted = [
  ['an unverified email', claims.unverifiedDistrict(VICTIM)],
  ['a password-provider email', claims.passwordDistrict(VICTIM)],
  ['an unverified custom-token email', claims.unverifiedCustom(VICTIM)],
  ['an anonymous-provider email', claims.anonymousDistrict(VICTIM)],
] as const;

describe('untrusted token email', () => {
  it.each(untrusted)('%s is refused everywhere the real owner is allowed', async (_who, token) => {
    const ctx = testEnv.authenticatedContext('attacker', token);
    const db = ctx.firestore();
    await assertFails(getDoc(doc(db, 'appSettings', 'general')));
    await assertFails(getDoc(doc(db, 'staff', VICTIM)));
    await assertFails(getDoc(doc(db, 'observations', 'obs1')));
    await assertFails(getDoc(doc(db, 'windowInviteViews', `w1_${VICTIM}`)));
    await assertFails(
      setDoc(doc(db, `staff/${VICTIM}/moduleProgress/i1`), {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
      }),
    );
    await assertFails(getBytes(ref(ctx.storage(), BRANDING)));
    await assertFails(uploadString(ref(ctx.storage(), BRANDING), 'new'));
  });

  it('the same reads and writes succeed for the Google-signed-in owner', async () => {
    const ctx = testEnv.authenticatedContext('teacher', claims.googleTeacher(VICTIM));
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, 'appSettings', 'general')));
    await assertSucceeds(getDoc(doc(db, 'staff', VICTIM)));
    await assertSucceeds(getDoc(doc(db, 'observations', 'obs1')));
    await assertSucceeds(getDoc(doc(db, 'windowInviteViews', `w1_${VICTIM}`)));
    await assertSucceeds(
      setDoc(doc(db, `staff/${VICTIM}/moduleProgress/i1`), {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
      }),
    );
    await assertSucceeds(getBytes(ref(ctx.storage(), BRANDING)));
  });

  it('a verified View As + Edit custom token can still read as that account', async () => {
    const ctx = testEnv.authenticatedContext('teacher', claims.customTeacher(VICTIM));
    const db = ctx.firestore();
    await assertSucceeds(getDoc(doc(db, 'appSettings', 'general')));
    await assertSucceeds(getDoc(doc(db, 'staff', VICTIM)));
    await assertSucceeds(getDoc(doc(db, 'observations', 'obs1')));
    await assertSucceeds(getBytes(ref(ctx.storage(), BRANDING)));
  });
});
