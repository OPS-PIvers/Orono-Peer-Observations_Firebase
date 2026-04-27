import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';

export type ImportTarget = 'emulator' | 'prod';

export const FIREBASE_PROJECT_ID = 'peer-evaluator-rubric';

/**
 * Initialize Firebase Admin SDK for the chosen target.
 *
 * - emulator: connects to Firestore emulator on localhost:8080. Set
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 if not already set. The admin
 *   SDK auto-detects this env var and routes all calls to the emulator.
 *   No real credentials needed.
 *
 * - prod: uses Application Default Credentials (gcloud auth
 *   application-default login) OR GOOGLE_APPLICATION_CREDENTIALS pointing
 *   at a service account key with Firestore write access.
 */
export function initFirestore(target: ImportTarget): Firestore {
  if (target === 'emulator') {
    process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
    process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??= '127.0.0.1:9099';
  }

  if (getApps().length === 0) {
    const credPath = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
    if (target === 'prod' && credPath && existsSync(credPath)) {
      const credsRaw: unknown = JSON.parse(readFileSync(credPath, 'utf8'));
      if (typeof credsRaw !== 'object' || credsRaw === null) {
        throw new Error(`Invalid credentials JSON at ${credPath}`);
      }
      initializeApp({
        credential: cert(credsRaw),
        projectId: FIREBASE_PROJECT_ID,
      });
    } else {
      initializeApp({ projectId: FIREBASE_PROJECT_ID });
    }
  }

  return getFirestore();
}
