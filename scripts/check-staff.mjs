import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId: 'peer-evaluator-rubric' });
}

const email = process.argv[2] ?? 'paul.ivers@orono.k12.mn.us';
const snap = await getFirestore().doc(`staff/${email}`).get();
if (!snap.exists) {
  console.log(`No /staff/${email} doc.`);
  process.exit(0);
}
console.log(JSON.stringify(snap.data(), null, 2));
