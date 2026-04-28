// Idempotent: creates or updates /staff/{email} with role=Administrator,
// so when that user signs in via the dev sign-in flow, syncMyClaims sets
// admin custom claims and the route guards / Firestore rules let them
// hit the admin section + observation list.
//
//   node scripts/seed-admin-staff.mjs paul.ivers@orono.k12.mn.us

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId: 'peer-evaluator-rubric' });
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: node seed-admin-staff.mjs <email>');
  process.exit(1);
}

const ref = getFirestore().doc(`staff/${email}`);
const existing = await ref.get();
const now = FieldValue.serverTimestamp();

const next = {
  email,
  name: existing.exists ? existing.data().name : email.split('@')[0],
  role: 'Administrator',
  year: 1,
  buildings: [],
  isActive: true,
  summativeYear: false,
  updatedAt: now,
  ...(existing.exists ? {} : { createdAt: now }),
};

await ref.set(next, { merge: true });
console.log(`Seeded /staff/${email} with role=Administrator (${existing.exists ? 'updated' : 'created'})`);
