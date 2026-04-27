import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
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
  teacher: (email = 'teacher@orono.k12.mn.us') => ({
    email,
    role: 'Teacher',
    hasSpecialAccess: false,
    ...verified,
  }),
  peerEval: (email = 'pe@orono.k12.mn.us') => ({
    email,
    role: 'Peer Evaluator',
    hasSpecialAccess: true,
    ...verified,
  }),
  admin: (email = 'admin@orono.k12.mn.us') => ({
    email,
    role: 'Administrator',
    hasSpecialAccess: true,
    ...verified,
  }),
  fullAccess: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'Full Access',
    hasSpecialAccess: true,
    ...verified,
  }),
} as const;
