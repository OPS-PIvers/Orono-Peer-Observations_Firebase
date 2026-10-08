import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { getBytes, ref, uploadString } from 'firebase/storage';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

const STAGED = 'admin-uploads/staging/roster.csv';
const BRANDING = 'admin-uploads/branding/logo.png';

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadString(ref(ctx.storage(), STAGED), 'staff,pii');
    await uploadString(ref(ctx.storage(), BRANDING), 'logo');
  });
});

const storageAs = (uid: string, token: Record<string, unknown>) =>
  testEnv.authenticatedContext(uid, token).storage();

describe('admin-uploads', () => {
  it('lets a Peer Evaluator with console access read and write', async () => {
    const s = storageAs('pe', claims.peerEvalConsole());
    await assertSucceeds(getBytes(ref(s, STAGED)));
    await assertSucceeds(uploadString(ref(s, STAGED), 'new'));
    await assertSucceeds(uploadString(ref(s, BRANDING), 'new'));
  });

  it('refuses a View As + Edit session as that Peer Evaluator', async () => {
    const s = storageAs('pe', {
      ...claims.peerEvalConsole(),
      demoEditBy: 'viewer@orono.k12.mn.us',
    });
    await assertFails(getBytes(ref(s, STAGED)));
    await assertFails(uploadString(ref(s, STAGED), 'new'));
    await assertFails(uploadString(ref(s, BRANDING), 'new'));
  });

  it('still lets a View As + Edit session read branding like any signed-in user', async () => {
    const s = storageAs('pe', {
      ...claims.peerEvalConsole(),
      demoEditBy: 'viewer@orono.k12.mn.us',
    });
    await assertSucceeds(getBytes(ref(s, BRANDING)));
  });

  it('refuses Administrators and non-admins', async () => {
    for (const token of [claims.admin(), claims.peerEval(), claims.teacher()]) {
      const s = storageAs('u', token);
      await assertFails(getBytes(ref(s, STAGED)));
      await assertFails(uploadString(ref(s, STAGED), 'new'));
    }
  });
});
