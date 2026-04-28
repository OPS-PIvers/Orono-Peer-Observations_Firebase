// One-off cleanup helper. Hard-deletes an /observations doc by ID via
// Admin SDK (bypasses Firestore rules). Used to scrub leftover smoke-test
// data without touching the rules-only audit trail of "PE deletes their
// own draft" (the app itself doesn't expose draft deletion).
//
//   node scripts/delete-observation.mjs <observationId>

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId: 'peer-evaluator-rubric' });
}

const id = process.argv[2];
if (!id) {
  console.error('Usage: node delete-observation.mjs <observationId>');
  process.exit(1);
}

const ref = getFirestore().doc(`observations/${id}`);
const snap = await ref.get();
if (!snap.exists) {
  console.log(`No /observations/${id}; nothing to delete.`);
  process.exit(0);
}
await ref.delete();
console.log(`Deleted /observations/${id}`);
