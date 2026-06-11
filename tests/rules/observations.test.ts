import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

const PE_EMAIL = 'pe@orono.k12.mn.us';
const OBSERVED_EMAIL = 'teacher@orono.k12.mn.us';
const OTHER_PE_EMAIL = 'pe2@orono.k12.mn.us';

async function seedDraftObs(id: string, overrides: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'observations', id), {
      observerEmail: PE_EMAIL,
      observedEmail: OBSERVED_EMAIL,
      observedName: 'Test Teacher',
      observedRole: 'Teacher',
      observedYear: 1,
      status: 'Draft',
      type: 'Standard',
      observationName: 'Sample',
      createdAt: new Date(),
      lastModifiedAt: new Date(),
      ...overrides,
    });
  });
}

describe('observations: read access', () => {
  beforeEach(async () => {
    await seedDraftObs('obs1');
  });

  it('observer can read their own draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
  });

  it('observed teacher CAN read a Draft Standard observation about them', async () => {
    // Loosened in May 2026: staff dashboard shows pre/obs/post cards the
    // moment the peer evaluator creates the Draft, so the observed staff
    // member needs read access to their own Draft regardless of type.
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
  });

  it('observed teacher CAN read a Finalized observation about them', async () => {
    await seedDraftObs('finalObs', { status: 'Finalized', finalizedAt: new Date() });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/finalObs')));
  });

  it('different teacher cannot read', async () => {
    const db = testEnv
      .authenticatedContext('other', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'observations/obs1')));
  });

  it('admin can read any observation', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
  });

  it('any PE can read any observation (special access)', async () => {
    const db = testEnv.authenticatedContext('pe2', claims.peerEval(OTHER_PE_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
  });

  it('PE can list observations; unrelated teacher cannot', async () => {
    const peDb = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(getDocs(collection(peDb, 'observations')));
    // A teacher who is NOT the observed staff member can't list the
    // collection — list scopes per-doc to `observedEmail == auth.email`.
    const otherDb = testEnv
      .authenticatedContext('other', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDocs(collection(otherDb, 'observations')));
  });
});

describe('observations: create', () => {
  it('PE can create an observation where they are the observer', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'observations/new1'), {
        observerEmail: PE_EMAIL,
        observedEmail: OBSERVED_EMAIL,
        observedName: 'X',
        observedRole: 'Teacher',
        observedYear: 1,
        status: 'Draft',
        type: 'Standard',
        observationName: '',
        createdAt: new Date(),
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('PE cannot create an observation impersonating another observer', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observations/new2'), {
        observerEmail: 'someone-else@orono.k12.mn.us',
        observedEmail: OBSERVED_EMAIL,
        observedName: 'X',
        observedRole: 'Teacher',
        observedYear: 1,
        status: 'Draft',
        type: 'Standard',
        observationName: '',
        createdAt: new Date(),
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('PE cannot create an observation already Finalized', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observations/new3'), {
        observerEmail: PE_EMAIL,
        observedEmail: OBSERVED_EMAIL,
        observedName: 'X',
        observedRole: 'Teacher',
        observedYear: 1,
        status: 'Finalized',
        type: 'Standard',
        observationName: '',
        createdAt: new Date(),
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('teacher cannot create observations', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher()).firestore();
    await assertFails(
      setDoc(doc(db, 'observations/new4'), {
        observerEmail: 'a@orono.k12.mn.us',
        observedEmail: 'b@orono.k12.mn.us',
        observedName: 'X',
        observedRole: 'Teacher',
        observedYear: 1,
        status: 'Draft',
        type: 'Standard',
        observationName: '',
        createdAt: new Date(),
        lastModifiedAt: new Date(),
      }),
    );
  });
});

describe('observations: update', () => {
  beforeEach(async () => {
    await seedDraftObs('obs1');
  });

  it('observer can update fields on their own Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/obs1'), {
        observationName: 'Updated',
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observer CANNOT change status from the client (must go through finalize Function)', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), {
        status: 'Finalized',
        finalizedAt: new Date(),
      }),
    );
  });

  it('observer cannot change observerEmail or observedEmail', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), { observerEmail: 'someone@orono.k12.mn.us' }),
    );
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), { observedEmail: 'someone@orono.k12.mn.us' }),
    );
  });

  it('observer cannot edit a Finalized observation', async () => {
    await seedDraftObs('finalObs', { status: 'Finalized', finalizedAt: new Date() });
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/finalObs'), { observationName: 'Re-edit' }));
  });

  it('admin can update any observation, including finalized', async () => {
    await seedDraftObs('finalObs', { status: 'Finalized', finalizedAt: new Date() });
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/finalObs'), { observationName: 'Admin override' }),
    );
  });

  it('teacher cannot update an observation about them', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observationName: 'Hax' }));
  });
});

describe('observations: server-managed Drive linkage is immutable to the observer', () => {
  beforeEach(async () => {
    await seedDraftObs('obs1', {
      driveFolderId: 'obs1-folder',
      pdfDriveFileId: 'obs1-pdf',
      audioDriveFileIds: ['audio-1'],
      transcripts: { 'audio-1': 'transcript text' },
      evidenceLinks: { c1: [{ fileId: 'ev-1', name: 'evidence.pdf' }] },
    });
  });

  it('observer CANNOT change driveFolderId on their Draft', async () => {
    // Worst case this prevents: pointing draft-delete cleanup at the
    // district-wide parent folder before deleting the Draft.
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), { driveFolderId: 'district-parent-folder' }),
    );
  });

  it('observer CANNOT change pdfDriveFileId on their Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { pdfDriveFileId: 'spoofed-pdf' }));
  });

  it('observer CANNOT change audioDriveFileIds, transcripts, or evidenceLinks', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), { audioDriveFileIds: ['spoofed-audio'] }),
    );
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), { transcripts: { 'audio-1': 'tampered' } }),
    );
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { evidenceLinks: {} }));
  });

  it('observer CANNOT set driveFolderId on a Draft where it is absent', async () => {
    await seedDraftObs('obs2');
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs2'), { driveFolderId: 'injected' }));
  });

  it('observer CAN still autosave content fields with Drive fields untouched', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/obs1'), {
        observationName: 'Autosaved name',
        observationData: {},
        componentNotes: {},
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('admin CAN still rewrite Drive linkage fields', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/obs1'), { driveFolderId: 'admin-corrected' }),
    );
  });
});

describe('observations: delete', () => {
  beforeEach(async () => {
    await seedDraftObs('obs1');
  });

  it('observer (PE) can delete their own Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'observations/obs1')));
  });

  it("different PE cannot delete another observer's Draft", async () => {
    const db = testEnv.authenticatedContext('pe2', claims.peerEval(OTHER_PE_EMAIL)).firestore();
    await assertFails(deleteDoc(doc(db, 'observations/obs1')));
  });

  it('admin can delete', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'observations/obs1')));
  });
});

describe('observations: staff WP/IR draft access', () => {
  it('observed teacher CAN read a Work Product Draft', async () => {
    await seedDraftObs('wpObs', { type: 'Work Product' });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/wpObs')));
  });

  it('observed teacher CAN read an Instructional Round Draft', async () => {
    await seedDraftObs('irObs', { type: 'Instructional Round' });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/irObs')));
  });

  it('observed teacher CAN read a Standard Draft', async () => {
    // Loosened in May 2026 so the staff dashboard surfaces pre/obs/post
    // cards while the observation is still being drafted by the PE.
    await seedDraftObs('stdObs', { type: 'Standard' });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/stdObs')));
  });

  it('observed teacher CAN save workProductAnswers on a WP Draft', async () => {
    await seedDraftObs('wpObs2', { type: 'Work Product', workProductAnswers: [] });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/wpObs2'), {
        workProductAnswers: [{ questionId: 'q1', answer: 'My answer', updatedAt: new Date() }],
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CAN save workProductAnswers on an IR Draft', async () => {
    await seedDraftObs('irObs2', { type: 'Instructional Round', workProductAnswers: [] });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/irObs2'), {
        workProductAnswers: [{ questionId: 'q1', answer: 'My answer', updatedAt: new Date() }],
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CANNOT save workProductAnswers on a Standard Draft', async () => {
    await seedDraftObs('stdObs2', { type: 'Standard', workProductAnswers: [] });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/stdObs2'), {
        workProductAnswers: [{ questionId: 'q1', answer: 'Hax', updatedAt: new Date() }],
        lastModifiedAt: new Date(),
      }),
    );
  });
});
