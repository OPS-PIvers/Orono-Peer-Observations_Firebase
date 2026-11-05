import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  doc,
  getDoc,
  deleteDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

/**
 * Archived staff (isActive: false on their live staff doc) keep the role and
 * isAdmin claims they held until their token refreshes. Every claim-based
 * tier (hasSpecialAccess, isAdmin, isConsoleAdmin, hasObservationOversight)
 * must refuse them anyway. See isActiveStaff in firestore.rules.
 */

let testEnv: RulesTestEnvironment;

const FA = 'fullaccess@orono.k12.mn.us';
const PE = 'pe@orono.k12.mn.us';
const CONSOLE_PE = 'consolepe@orono.k12.mn.us';
const PRINCIPAL = 'principal@orono.k12.mn.us';
const TEACHER = 'teacher@orono.k12.mn.us';

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(`staff/${TEACHER}`, {
    email: TEACHER,
    role: 'teacher',
    buildings: ['OMS'],
    isActive: true,
  });
  await seed('observations/obs1', {
    observerEmail: 'other-pe@orono.k12.mn.us',
    observedEmail: TEACHER,
    observedName: 'Test Teacher',
    observedRole: 'Teacher',
    observedYear: 1,
    status: 'Draft',
    type: 'Standard',
    observationName: 'Sample',
    createdAt: new Date(),
    lastModifiedAt: new Date(),
  });
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

async function staff(email: string, role: string, isActive: boolean | undefined, extra = {}) {
  await seed(`staff/${email}`, {
    email,
    role,
    buildings: ['OMS'],
    ...(isActive === undefined ? {} : { isActive }),
    ...extra,
  });
}

const faDb = () => testEnv.authenticatedContext('fa', claims.fullAccess(FA)).firestore();

describe('archived Full Access caller whose token still says full-access', () => {
  beforeEach(async () => {
    await staff(FA, 'full-access', false, { hasAdminAccess: true });
  });

  it("can't read others' observations, including drafts", async () => {
    const db = faDb();
    await assertFails(getDoc(doc(db, 'observations/obs1')));
    await assertFails(getDocs(collection(db, 'observations')));
  });

  it("can't read the roster or another staff doc", async () => {
    const db = faDb();
    await assertFails(getDocs(collection(db, 'staff')));
    await assertFails(getDoc(doc(db, `staff/${TEACHER}`)));
  });

  it("can't restore their own isActive or edit other staff", async () => {
    const db = faDb();
    await assertFails(updateDoc(doc(db, `staff/${FA}`), { isActive: true }));
    await assertFails(updateDoc(doc(db, `staff/${TEACHER}`), { role: 'full-access' }));
  });

  it("can't write Admin Console data", async () => {
    await assertFails(setDoc(doc(faDb(), 'roles/new-role'), { displayName: 'New' }));
  });

  it('can still read their own staff doc', async () => {
    await assertSucceeds(getDoc(doc(faDb(), `staff/${FA}`)));
  });
});

describe('active and legacy Full Access callers keep oversight', () => {
  it('active (isActive: true)', async () => {
    await staff(FA, 'full-access', true);
    const db = faDb();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
    await assertSucceeds(updateDoc(doc(db, `staff/${TEACHER}`), { name: 'Renamed' }));
  });

  // Every claim-tier check now reads the caller's staff doc. The Admin
  // Console's bulk edits commit up to 500 writes per batch (bulkWrite.ts),
  // so that read must not count against the per-request access limit once
  // per write.
  it('a full 500-write Admin Console batch still commits', async () => {
    await staff(FA, 'full-access', true);
    const db = faDb();
    const batch = writeBatch(db);
    for (let i = 0; i < 500; i++) {
      batch.set(doc(db, `staff/bulk${i}@orono.k12.mn.us`), { name: `Bulk ${i}` }, { merge: true });
    }
    await assertSucceeds(batch.commit());
  });

  it('a 500-write batch from a hasAdminAccess Administrator still commits', async () => {
    await staff(PRINCIPAL, 'administrator', true, { hasAdminAccess: true });
    const db = testEnv.authenticatedContext('principal', claims.admin(PRINCIPAL)).firestore();
    const batch = writeBatch(db);
    for (let i = 0; i < 500; i++) {
      batch.set(doc(db, `roles/role${i}`), { displayName: `Role ${i}` }, { merge: true });
    }
    await assertSucceeds(batch.commit());
  });

  it('legacy doc without isActive (schema default is true)', async () => {
    await staff(FA, 'full-access', undefined);
    await assertSucceeds(getDoc(doc(faDb(), 'observations/obs1')));
  });
});

describe('other archived elevated callers', () => {
  it('a Peer Evaluator loses roster reads and observation create', async () => {
    await staff(PE, 'peer-evaluator', false);
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE)).firestore();
    await assertFails(getDocs(collection(db, 'staff')));
    await assertFails(
      setDoc(doc(db, 'observations/new'), {
        observerEmail: PE,
        observedEmail: TEACHER,
        status: 'Draft',
        type: 'Standard',
      }),
    );
  });

  it('a hasAdminAccess Peer Evaluator loses Admin Console writes', async () => {
    await staff(CONSOLE_PE, 'peer-evaluator', false, { hasAdminAccess: true });
    const db = testEnv
      .authenticatedContext('consolepe', claims.peerEvalConsole(CONSOLE_PE))
      .firestore();
    await assertFails(setDoc(doc(db, 'roles/new-role'), { displayName: 'New' }));
    await assertFails(updateDoc(doc(db, `staff/${TEACHER}`), { name: 'Renamed' }));
  });

  it('a building Administrator loses staff edits in their building', async () => {
    await staff(PRINCIPAL, 'administrator', false);
    const db = testEnv.authenticatedContext('principal', claims.admin(PRINCIPAL)).firestore();
    await assertFails(getDocs(collection(db, 'staff')));
    await assertFails(updateDoc(doc(db, `staff/${TEACHER}`), { name: 'Renamed' }));
  });
});

describe('archived observers lose their own observations', () => {
  beforeEach(async () => {
    await staff(PE, 'peer-evaluator', false);
    await seed('observations/mine', {
      observerEmail: PE,
      observedEmail: TEACHER,
      coObserverEmails: [],
      observedName: 'Test Teacher',
      status: 'Draft',
      type: 'Standard',
      observationName: 'Mine',
      createdAt: new Date(),
      lastModifiedAt: new Date(),
    });
    await seed('observations/shared', {
      observerEmail: 'other-pe@orono.k12.mn.us',
      observedEmail: TEACHER,
      coObserverEmails: [PE],
      status: 'Draft',
      type: 'Standard',
    });
    await seed('observationWindows/w1', {
      observerEmail: PE,
      invitedEmails: [],
      defaultObservationName: 'Window',
    });
  });

  const peDb = () => testEnv.authenticatedContext('pe', claims.peerEval(PE)).firestore();

  it("can't read or edit observations they own or co-observe", async () => {
    const db = peDb();
    await assertFails(getDoc(doc(db, 'observations/mine')));
    await assertFails(updateDoc(doc(db, 'observations/mine'), { observationName: 'x' }));
    await assertFails(getDoc(doc(db, 'observations/shared')));
  });

  it("can't edit or delete their own windows", async () => {
    const db = peDb();
    await assertFails(updateDoc(doc(db, 'observationWindows/w1'), { defaultObservationName: 'x' }));
    await assertFails(deleteDoc(doc(db, 'observationWindows/w1')));
  });

  it("can't read their transcription jobs", async () => {
    await seed('transcriptionJobs/j1', { requestedBy: PE, transcriptPreview: 'secret' });
    const db = peDb();
    await assertFails(getDoc(doc(db, 'transcriptionJobs/j1')));
    await staff(PE, 'peer-evaluator', true);
    await assertSucceeds(getDoc(doc(db, 'transcriptionJobs/j1')));
  });

  it('the observed teacher still reads the observation', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(TEACHER)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/mine')));
  });

  it('an active owner still reads and edits it', async () => {
    await staff(PE, 'peer-evaluator', true);
    const db = peDb();
    await assertSucceeds(getDoc(doc(db, 'observations/mine')));
    await assertSucceeds(updateDoc(doc(db, 'observations/mine'), { observationName: 'x' }));
  });
});

describe('demo-edit session whose driver was archived', () => {
  const DRIVER = 'viewer@orono.k12.mn.us';
  const session = () =>
    testEnv.authenticatedContext('pe', { ...claims.peerEval(PE), demoEditBy: DRIVER }).firestore();

  beforeEach(async () => {
    await staff(PE, 'peer-evaluator', true);
  });

  it("loses the driven account's roster reads", async () => {
    await staff(DRIVER, 'teacher', false, { canViewAsEdit: true });
    await assertFails(getDocs(collection(session(), 'staff')));
  });

  it('keeps them while the driver is active', async () => {
    await staff(DRIVER, 'teacher', true, { canViewAsEdit: true });
    await assertSucceeds(getDocs(collection(session(), 'staff')));
  });
});

describe('archived observers lose step checks, window preferences and question sets', () => {
  // Teacher-role observers have no claim tier, so only the observer-side
  // branches (each gated by isActiveStaff) can let them in.
  const OBSERVER = 'observer@orono.k12.mn.us';
  const CO_OBSERVER = 'coobserver@orono.k12.mn.us';
  const PREF = `observationWindows/w1/preferences/${TEACHER}`;
  const db = (email: string) =>
    testEnv.authenticatedContext(email, claims.teacher(email)).firestore();

  beforeEach(async () => {
    await seed('observations/obs2', {
      observerEmail: OBSERVER,
      observedEmail: TEACHER,
      coObserverEmails: [CO_OBSERVER],
      status: 'Draft',
      type: 'Standard',
    });
    await seed('observations/obs2/stepChecks/s1', { checked: true });
    await seed('observationWindows/w1', { observerEmail: OBSERVER, invitedEmails: [TEACHER] });
    await seed(PREF, { email: TEACHER, preferredDateYMD: '2026-05-20' });
  });

  it('step checks: archived owner and co-observer are denied, active ones allowed', async () => {
    await staff(OBSERVER, 'teacher', false);
    await staff(CO_OBSERVER, 'teacher', false);
    await assertFails(getDoc(doc(db(OBSERVER), 'observations/obs2/stepChecks/s1')));
    await assertFails(getDoc(doc(db(CO_OBSERVER), 'observations/obs2/stepChecks/s1')));
    await staff(OBSERVER, 'teacher', true);
    await staff(CO_OBSERVER, 'teacher', true);
    await assertSucceeds(getDoc(doc(db(OBSERVER), 'observations/obs2/stepChecks/s1')));
    await assertSucceeds(getDoc(doc(db(CO_OBSERVER), 'observations/obs2/stepChecks/s1')));
  });

  it('step checks: the observed teacher still reads them', async () => {
    await assertSucceeds(getDoc(doc(db(TEACHER), 'observations/obs2/stepChecks/s1')));
  });

  it("preferences: an archived window observer can't read an invitee's preference", async () => {
    await staff(OBSERVER, 'teacher', false);
    await assertFails(getDoc(doc(db(OBSERVER), PREF)));
    await staff(OBSERVER, 'teacher', true);
    await assertSucceeds(getDoc(doc(db(OBSERVER), PREF)));
  });

  it("question sets: an archived building Administrator can't write their building's set", async () => {
    await seed('buildings/oms', { buildingId: 'oms', displayName: 'OMS' });
    await staff(PRINCIPAL, 'administrator', false);
    const adminDb = testEnv.authenticatedContext('p', claims.admin(PRINCIPAL)).firestore();
    const question = {
      questionId: 'q-oms',
      text: 'What are you hoping to see?',
      type: 'standard',
      phase: 'pre',
      order: 0,
      isActive: true,
      setId: 'building-oms',
      buildingId: 'oms',
    };
    await assertFails(setDoc(doc(adminDb, 'workProductQuestions/new'), question));
    await staff(PRINCIPAL, 'administrator', true);
    await assertSucceeds(setDoc(doc(adminDb, 'workProductQuestions/new'), question));
  });
});
