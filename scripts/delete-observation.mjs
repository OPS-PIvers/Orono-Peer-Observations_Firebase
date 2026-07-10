// One-off cleanup helper. Hard-deletes an /observations doc by ID via
// Admin SDK (bypasses Firestore rules). Used to scrub leftover smoke-test
// data without touching the rules-only audit trail of "PE deletes their
// own draft" (the app itself doesn't expose draft deletion).
//
// REQUIRES --confirm flag to proceed. Run without it to see what would be deleted.
//
//   node scripts/delete-observation.mjs --confirm <observationId>

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PROJECT_ID } from './lib/project-id.mjs';

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

const args = process.argv.slice(2);
const confirmIndex = args.indexOf('--confirm');
const hasConfirm = confirmIndex !== -1;
const id = hasConfirm ? args.find((_, i) => i !== confirmIndex) : args[0];

if (!id) {
  console.error('Usage: node delete-observation.mjs --confirm <observationId>');
  console.error('       (--confirm flag is required)');
  process.exit(1);
}

if (!hasConfirm) {
  console.error('Refusing to delete without --confirm flag. ' + 'This is a destructive operation.');
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
