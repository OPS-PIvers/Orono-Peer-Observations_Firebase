import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shared rules-test harness — every rules test file uses these helpers so
 * the same Firestore emulator instance, projectId, and rules path are used
 * across the suite.
 */

export const PROJECT_ID = 'peer-evaluator-rubric-rules-test';

export async function setupTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}

/** Seeds the live staff doc behind `claims.fullAccess()`. Console access is
 *  checked against that doc, not the token, so a Full Access caller with no
 *  doc is refused (as a revoked one with a stale token must be). */
export async function seedFullAccessStaff(
  testEnv: RulesTestEnvironment,
  email = 'fullaccess@orono.k12.mn.us',
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'staff', email), { email, role: 'full-access' });
  });
}

/** Common token-claim shapes used in tests.
 *
 *  `email_verified: true` is set so `request.auth.token.email` is readable
 *  in the Firestore rules — the emulator otherwise treats the email as
 *  unverified and surfaces it as an empty string.
 */
const verified = { email_verified: true } as const;

export const claims = {
  outsider: { email: 'someone@gmail.com', ...verified },
  /** A district address on a token whose email isn't verified (e.g. an
   *  account that set an unclaimed roster address as its email). Carries
   *  Full Access claims to prove the rules ignore them. */
  unverifiedDistrict: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'full-access',
    hasSpecialAccess: true,
    isAdmin: true,
    email_verified: false,
    firebase: { sign_in_provider: 'google.com', identities: {} },
  }),
  /** A verified district address from a provider the app doesn't use
   *  (Email/Password), so not asserted by the district's Google identity. */
  passwordDistrict: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'full-access',
    hasSpecialAccess: true,
    isAdmin: true,
    ...verified,
    firebase: { sign_in_provider: 'password', identities: {} },
  }),
  /** A server-minted custom token (View As + Edit) for an Auth user whose
   *  email was never verified. */
  unverifiedCustom: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'full-access',
    hasSpecialAccess: true,
    isAdmin: true,
    email_verified: false,
    firebase: { sign_in_provider: 'custom', identities: {} },
  }),
  /** An anonymous sign-in that somehow carries a district address. */
  anonymousDistrict: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'full-access',
    hasSpecialAccess: true,
    isAdmin: true,
    ...verified,
    firebase: { sign_in_provider: 'anonymous', identities: {} },
  }),
  /** A View As + Edit custom token for a verified demo account. */
  customTeacher: (email = 'teacher@orono.k12.mn.us') => ({
    email,
    role: 'teacher',
    hasSpecialAccess: false,
    isAdmin: false,
    ...verified,
    demoEditBy: 'viewer@orono.k12.mn.us',
    firebase: { sign_in_provider: 'custom', identities: {} },
  }),
  /** A real Google sign-in for a teacher. */
  googleTeacher: (email = 'teacher@orono.k12.mn.us') => ({
    email,
    role: 'teacher',
    hasSpecialAccess: false,
    isAdmin: false,
    ...verified,
    firebase: { sign_in_provider: 'google.com', identities: {} },
  }),
  teacher: (email = 'teacher@orono.k12.mn.us') => ({
    email,
    role: 'teacher',
    hasSpecialAccess: false,
    isAdmin: false,
    ...verified,
  }),
  peerEval: (email = 'pe@orono.k12.mn.us') => ({
    email,
    role: 'peer-evaluator',
    hasSpecialAccess: true,
    isAdmin: false,
    ...verified,
  }),
  /** A Peer Evaluator who was also granted Admin Console access. */
  peerEvalConsole: (email = 'pe-console@orono.k12.mn.us') => ({
    email,
    role: 'peer-evaluator',
    hasSpecialAccess: true,
    isAdmin: true,
    ...verified,
  }),
  admin: (email = 'admin@orono.k12.mn.us') => ({
    email,
    role: 'administrator',
    hasSpecialAccess: true,
    isAdmin: true,
    ...verified,
  }),
  fullAccess: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'full-access',
    hasSpecialAccess: true,
    isAdmin: true,
    ...verified,
  }),
} as const;
