import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

/**
 * Evaluator step check-offs. Readable by the staff member they belong to and
 * by special access; never client-writable (the setStepCheck callable writes
 * them with the Admin SDK) — not even by an admin.
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

const PE_EMAIL = 'pe@orono.k12.mn.us';
const TEACHER_EMAIL = 'teacher@orono.k12.mn.us';
const OTHER_TEACHER_EMAIL = 'other@orono.k12.mn.us';
const CHECK = { stepId: 'preObs', checkedBy: PE_EMAIL, checkedByName: 'PE', checkedAt: new Date() };

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'observations/obs1'), {
      observerEmail: PE_EMAIL,
      observedEmail: TEACHER_EMAIL,
      status: 'Finalized',
      type: 'Standard',
    });
    await setDoc(doc(db, 'observations/obs1/stepChecks/preObs'), CHECK);
    await setDoc(doc(db, `staff/${TEACHER_EMAIL}/stepChecks/signup`), {
      ...CHECK,
      stepId: 'signup',
    });
  });
});

function asTeacher(email = TEACHER_EMAIL) {
  return testEnv.authenticatedContext('t', claims.teacher(email)).firestore();
}
function asPe() {
  return testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
}
function asAdmin() {
  return testEnv.authenticatedContext('admin', claims.admin()).firestore();
}

describe('observations/{id}/stepChecks', () => {
  it('the observed staff member can read (get and list) their checks', async () => {
    const db = asTeacher();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1/stepChecks/preObs')));
    await assertSucceeds(getDocs(collection(db, 'observations/obs1/stepChecks')));
  });

  it('a different staff member cannot read them', async () => {
    const db = asTeacher(OTHER_TEACHER_EMAIL);
    await assertFails(getDoc(doc(db, 'observations/obs1/stepChecks/preObs')));
    await assertFails(getDocs(collection(db, 'observations/obs1/stepChecks')));
  });

  it('special access can read them', async () => {
    await assertSucceeds(getDocs(collection(asPe(), 'observations/obs1/stepChecks')));
  });

  it('nobody writes from the client — teacher, evaluator, or admin', async () => {
    for (const db of [asTeacher(), asPe(), asAdmin()]) {
      await assertFails(setDoc(doc(db, 'observations/obs1/stepChecks/postObs'), CHECK));
      await assertFails(deleteDoc(doc(db, 'observations/obs1/stepChecks/preObs')));
    }
  });

  it('an outsider cannot read', async () => {
    const db = testEnv.authenticatedContext('x', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'observations/obs1/stepChecks/preObs')));
  });
});

describe('staff/{email}/stepChecks', () => {
  it('the staff member can read their own checks', async () => {
    await assertSucceeds(getDocs(collection(asTeacher(), `staff/${TEACHER_EMAIL}/stepChecks`)));
  });

  it("another staff member cannot read someone else's checks", async () => {
    await assertFails(
      getDocs(collection(asTeacher(OTHER_TEACHER_EMAIL), `staff/${TEACHER_EMAIL}/stepChecks`)),
    );
  });

  it('special access can read any staff member’s checks', async () => {
    await assertSucceeds(getDoc(doc(asPe(), `staff/${TEACHER_EMAIL}/stepChecks/signup`)));
  });

  it('nobody writes from the client — including the staff member and an admin', async () => {
    for (const db of [asTeacher(), asPe(), asAdmin()]) {
      await assertFails(setDoc(doc(db, `staff/${TEACHER_EMAIL}/stepChecks/other`), CHECK));
      await assertFails(deleteDoc(doc(db, `staff/${TEACHER_EMAIL}/stepChecks/signup`)));
    }
  });
});

describe('dashboard window query (sign-up fix)', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'observationWindows/w1'), {
        observerEmail: PE_EMAIL,
        invitedEmails: [TEACHER_EMAIL],
        status: 'fully-booked',
        endDate: '2026-03-10',
        invitees: [],
      });
    });
  });

  // Mirrors useStaffCheckpoints' query (DASHBOARD_WINDOW_STATUSES), run by
  // the teacher on their dashboard and by an evaluator on StaffPersonPage.
  const dashboardWindowQuery = (db: ReturnType<typeof asTeacher>) =>
    query(
      collection(db, 'observationWindows'),
      where('invitedEmails', 'array-contains', TEACHER_EMAIL),
      where('status', 'in', ['open', 'partially-booked', 'fully-booked', 'expired']),
    );

  it('an invited teacher can run the dashboard window query, fully-booked included', async () => {
    await assertSucceeds(getDocs(dashboardWindowQuery(asTeacher())));
  });

  it('an evaluator can run the same query for that teacher', async () => {
    await assertSucceeds(getDocs(dashboardWindowQuery(asPe())));
  });

  it('another teacher cannot', async () => {
    await assertFails(getDocs(dashboardWindowQuery(asTeacher(OTHER_TEACHER_EMAIL))));
  });
});
