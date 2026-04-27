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

/** Common token-claim shapes used in tests. */
export const claims = {
  outsider: { email: 'someone@gmail.com' },
  teacher: (email = 'teacher@orono.k12.mn.us') => ({
    email,
    role: 'Teacher',
    hasSpecialAccess: false,
  }),
  peerEval: (email = 'pe@orono.k12.mn.us') => ({
    email,
    role: 'Peer Evaluator',
    hasSpecialAccess: true,
  }),
  admin: (email = 'admin@orono.k12.mn.us') => ({
    email,
    role: 'Administrator',
    hasSpecialAccess: true,
  }),
  fullAccess: (email = 'fullaccess@orono.k12.mn.us') => ({
    email,
    role: 'Full Access',
    hasSpecialAccess: true,
  }),
} as const;
