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
  updateDoc,
  where,
} from 'firebase/firestore';
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

// A Peer Evaluator with Admin Console access (the hasAdminAccess staff flag):
// isAdmin + hasSpecialAccess claims, but no observation oversight.
async function consolePeDb() {
  const email = 'consolepe@orono.k12.mn.us';
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'staff', email), {
      email,
      role: 'peer-evaluator',
      hasAdminAccess: true,
      isActive: true,
    });
  });
  return testEnv
    .authenticatedContext('consolepe', { ...claims.peerEval(email), isAdmin: true })
    .firestore();
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

  it("building Administrator CANNOT read another observer's observation", async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertFails(getDoc(doc(db, 'observations/obs1')));
  });

  it("another PE CANNOT read someone else's observation", async () => {
    const db = testEnv.authenticatedContext('pe2', claims.peerEval(OTHER_PE_EMAIL)).firestore();
    await assertFails(getDoc(doc(db, 'observations/obs1')));
  });

  it('Full Access (oversight) can read any observation', async () => {
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/obs1')));
  });

  it("Admin Console access does NOT grant reading others' observations", async () => {
    const db = await consolePeDb();
    await assertFails(getDoc(doc(db, 'observations/obs1')));
    await assertFails(getDocs(collection(db, 'observations')));
  });

  it('a co-observer can read it', async () => {
    await seedDraftObs('shared', { coObserverEmails: [OTHER_PE_EMAIL] });
    const db = testEnv.authenticatedContext('pe2', claims.peerEval(OTHER_PE_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/shared')));
  });

  it('observers list only their own or co-observed observations', async () => {
    await seedDraftObs('shared', { coObserverEmails: [OTHER_PE_EMAIL] });
    const pe2 = testEnv.authenticatedContext('pe2', claims.peerEval(OTHER_PE_EMAIL)).firestore();
    await assertFails(getDocs(collection(pe2, 'observations')));
    await assertSucceeds(
      getDocs(query(collection(pe2, 'observations'), where('observerEmail', '==', OTHER_PE_EMAIL))),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(pe2, 'observations'),
          where('coObserverEmails', 'array-contains', OTHER_PE_EMAIL),
        ),
      ),
    );
    const fa = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(getDocs(collection(fa, 'observations')));
  });

  it('PE can list their own observations; unrelated teacher cannot', async () => {
    const peDb = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      getDocs(query(collection(peDb, 'observations'), where('observerEmail', '==', PE_EMAIL))),
    );
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

  it('Admin Console user with an observed role cannot create observations', async () => {
    // hasAdminAccess flag: isAdmin + hasSpecialAccess, but the role is observed.
    const db = testEnv
      .authenticatedContext('spec', {
        ...claims.teacher('spec@orono.k12.mn.us'),
        role: 'instructional-specialist',
        hasSpecialAccess: true,
        isAdmin: true,
      })
      .firestore();
    await assertFails(
      setDoc(doc(db, 'observations/new5'), {
        observerEmail: 'spec@orono.k12.mn.us',
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

  describe('observation type by role', () => {
    const ADMIN_EMAIL = 'admin@orono.k12.mn.us';
    function newObs(observerEmail: string, type: string) {
      return {
        observerEmail,
        observedEmail: OBSERVED_EMAIL,
        observedName: 'X',
        observedRole: 'Teacher',
        observedYear: 1,
        status: 'Draft',
        type,
        observationName: '',
        createdAt: new Date(),
        lastModifiedAt: new Date(),
      };
    }

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const fs = ctx.firestore();
        await setDoc(doc(fs, 'staff', ADMIN_EMAIL), {
          email: ADMIN_EMAIL,
          role: 'administrator',
          buildings: ['OMS'],
        });
        await setDoc(doc(fs, 'staff', OBSERVED_EMAIL), {
          email: OBSERVED_EMAIL,
          role: 'teacher',
          year: 2,
          cycleStatus: 'high',
          buildings: ['OMS'],
          isActive: true,
        });
      });
    });

    it('building Administrator can create a Standard observation', async () => {
      const db = testEnv.authenticatedContext('adm', claims.admin(ADMIN_EMAIL)).firestore();
      await assertSucceeds(
        setDoc(doc(db, 'observations/adm-std'), newObs(ADMIN_EMAIL, 'Standard')),
      );
    });

    it('building Administrator CANNOT create Work Product or Instructional Round', async () => {
      const db = testEnv.authenticatedContext('adm', claims.admin(ADMIN_EMAIL)).firestore();
      await assertFails(
        setDoc(doc(db, 'observations/adm-wp'), newObs(ADMIN_EMAIL, 'Work Product')),
      );
      await assertFails(
        setDoc(doc(db, 'observations/adm-ir'), newObs(ADMIN_EMAIL, 'Instructional Round')),
      );
    });

    describe('who a building Administrator may observe', () => {
      async function seedObserved(email: string, fields: Record<string, unknown>) {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), 'staff', email), {
            email,
            role: 'teacher',
            year: 2,
            cycleStatus: 'high',
            buildings: ['OMS'],
            isActive: true,
            ...fields,
          });
        });
      }
      function obsOf(observedEmail: string) {
        return { ...newObs(ADMIN_EMAIL, 'Standard'), observedEmail };
      }
      const adminDb = () =>
        testEnv.authenticatedContext('adm', claims.admin(ADMIN_EMAIL)).firestore();

      it('allows Probationary staff in their building, including legacy docs', async () => {
        await seedObserved('p@orono.k12.mn.us', { cycleStatus: 'probationary' });
        await seedObserved('legacy@orono.k12.mn.us', { cycleStatus: null, year: 4 });
        await assertSucceeds(setDoc(doc(adminDb(), 'observations/a1'), obsOf('p@orono.k12.mn.us')));
        await assertSucceeds(
          setDoc(doc(adminDb(), 'observations/a2'), obsOf('legacy@orono.k12.mn.us')),
        );
      });

      it('denies staff in another building', async () => {
        await seedObserved('far@orono.k12.mn.us', { buildings: ['OHS'] });
        await assertFails(setDoc(doc(adminDb(), 'observations/a3'), obsOf('far@orono.k12.mn.us')));
      });

      it('denies non-summative staff', async () => {
        await seedObserved('dev@orono.k12.mn.us', { cycleStatus: 'developing' });
        await seedObserved('y1@orono.k12.mn.us', { cycleStatus: null, year: 1 });
        await assertFails(setDoc(doc(adminDb(), 'observations/a4'), obsOf('dev@orono.k12.mn.us')));
        await assertFails(setDoc(doc(adminDb(), 'observations/a5'), obsOf('y1@orono.k12.mn.us')));
      });

      it('denies archived staff and people with no staff doc', async () => {
        await seedObserved('gone@orono.k12.mn.us', { isActive: false });
        await assertFails(setDoc(doc(adminDb(), 'observations/a6'), obsOf('gone@orono.k12.mn.us')));
        await assertFails(
          setDoc(doc(adminDb(), 'observations/a7'), obsOf('nobody@orono.k12.mn.us')),
        );
      });

      it('cannot retarget an existing observation at someone else', async () => {
        await seedObserved('dev@orono.k12.mn.us', { cycleStatus: 'developing' });
        await seedDraftObs('mine', { observerEmail: ADMIN_EMAIL });
        await assertFails(
          updateDoc(doc(adminDb(), 'observations/mine'), { observedEmail: 'dev@orono.k12.mn.us' }),
        );
        await assertSucceeds(
          updateDoc(doc(adminDb(), 'observations/mine'), { observationName: 'Renamed' }),
        );
      });

      it('still lets a Peer Evaluator observe anyone', async () => {
        await seedObserved('far@orono.k12.mn.us', {
          buildings: ['OHS'],
          cycleStatus: 'developing',
        });
        const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
        await assertSucceeds(
          setDoc(doc(db, 'observations/pe-far'), {
            ...newObs(PE_EMAIL, 'Standard'),
            observedEmail: 'far@orono.k12.mn.us',
          }),
        );
      });
    });

    it('PE can still create Work Product and Instructional Round', async () => {
      const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
      await assertSucceeds(setDoc(doc(db, 'observations/pe-wp'), newObs(PE_EMAIL, 'Work Product')));
      await assertSucceeds(
        setDoc(doc(db, 'observations/pe-ir'), newObs(PE_EMAIL, 'Instructional Round')),
      );
    });
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

  it('Full Access (oversight) can update any observation, including finalized', async () => {
    await seedDraftObs('finalObs', { status: 'Finalized', finalizedAt: new Date() });
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/finalObs'), { observationName: 'Admin override' }),
    );
  });

  it("Admin Console access does NOT grant editing or deleting others' observations", async () => {
    const db = await consolePeDb();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observationName: 'Nope' }));
    await assertFails(deleteDoc(doc(db, 'observations/obs1')));
  });

  it('Full Access CANNOT edit or delete an observation of themselves', async () => {
    await seedDraftObs('selfObs', { observedEmail: 'fullaccess@orono.k12.mn.us' });
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/selfObs')));
    await assertFails(
      updateDoc(doc(db, 'observations/selfObs'), { observationDate: '2026-10-02' }),
    );
    await assertFails(deleteDoc(doc(db, 'observations/selfObs')));
  });

  it("building Administrator CANNOT update another observer's observation", async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observationName: 'Nope' }));
  });

  it('teacher cannot update an observation about them', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observationName: 'Hax' }));
  });

  it('observer CAN save a realistic autosave payload on their Draft', async () => {
    // Mirror the exact fields ObservationEditorPage's flush() writes.
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/obs1'), {
        observationData: {
          'comp-1': { proficiency: null, selectedLookForIds: [], scratchNotes: '' },
        },
        componentNotes: {},
        scriptDoc: null,
        preObsDate: null,
        preObsNotes: null,
        postObsDate: null,
        postObsNotes: null,
        goalsNextSteps: null,
        observationName: 'Autosaved title',
        observationDate: new Date(),
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observer CANNOT change the observation type on a Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { type: 'Work Product' }));
  });

  it('observer CANNOT change injected participant fields on a Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observedName: 'Someone Else' }));
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observedRole: 'Principal' }));
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { observedYear: 4 }));
  });

  it('observer CANNOT inject an arbitrary field on a Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { evilField: 'nope' }));
  });

  it('observer CANNOT write recording metadata or ids directly (server-only)', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), {
        'audioRecordings.f1': { recordedAt: new Date(), durationSec: 5, label: 'x' },
      }),
    );
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { audioDriveFileIds: [] }));
  });

  it('observer CANNOT rebind scheduling linkage on a Draft', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { windowId: 'w-hijack' }));
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { slotId: 's-hijack' }));
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

  it("building Administrator CANNOT delete another observer's Draft", async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertFails(deleteDoc(doc(db, 'observations/obs1')));
  });

  it('Full Access (oversight) can delete', async () => {
    const db = testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
    await assertSucceeds(deleteDoc(doc(db, 'observations/obs1')));
  });

  it('observer CANNOT delete a Finalized observation', async () => {
    await seedDraftObs('finalObs', { status: 'Finalized', finalizedAt: new Date() });
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(deleteDoc(doc(db, 'observations/finalObs')));
  });
});

describe('observations: acknowledge (observed staff)', () => {
  beforeEach(async () => {
    await seedDraftObs('finalObs', { status: 'Finalized', finalizedAt: new Date() });
  });

  it('observed staff CAN acknowledge with their own email', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/finalObs'), {
        acknowledgedAt: new Date(),
        acknowledgedBy: OBSERVED_EMAIL,
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed staff CANNOT acknowledge attributing it to someone else', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/finalObs'), {
        acknowledgedAt: new Date(),
        acknowledgedBy: 'someone-else@orono.k12.mn.us',
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed staff CANNOT touch other fields while acknowledging', async () => {
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/finalObs'), {
        acknowledgedAt: new Date(),
        acknowledgedBy: OBSERVED_EMAIL,
        observationName: 'tampered',
        lastModifiedAt: new Date(),
      }),
    );
  });
});

describe('observations: observed staff draft access and answers', () => {
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

  it('observed teacher CAN save workProductAnswers on a Standard Draft', async () => {
    // Standard observations carry Planning / Reflection questions too.
    await seedDraftObs('stdObs2', { type: 'Standard', workProductAnswers: [] });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/stdObs2'), {
        workProductAnswers: [{ questionId: 'q1', answer: 'My answer', updatedAt: new Date() }],
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CAN save workProductAnswers on a Finalized observation', async () => {
    // Reflection questions stay open after finalize; the UI locks Planning.
    await seedDraftObs('finalStd', {
      type: 'Standard',
      status: 'Finalized',
      finalizedAt: new Date(),
      workProductAnswers: [],
    });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/finalStd'), {
        workProductAnswers: [
          { questionId: 'q1', answer: 'Later reflection', updatedAt: new Date() },
        ],
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CANNOT touch other fields alongside workProductAnswers', async () => {
    await seedDraftObs('stdObs3', { type: 'Standard', workProductAnswers: [] });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/stdObs3'), {
        workProductAnswers: [{ questionId: 'q1', answer: 'x', updatedAt: new Date() }],
        observationName: 'tampered',
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CAN save their Goals & Next Steps response on a WP Draft', async () => {
    await seedDraftObs('wpGoals', { type: 'Work Product' });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/wpGoals'), {
        goalsResponse: { type: 'doc', content: [{ type: 'paragraph' }] },
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CANNOT write the evaluator Goals & Next Steps notes', async () => {
    await seedDraftObs('wpGoals2', { type: 'Work Product' });
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/wpGoals2'), {
        goalsNextSteps: { type: 'doc', content: [{ type: 'paragraph' }] },
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('a different teacher CANNOT save workProductAnswers', async () => {
    await seedDraftObs('stdObs4', { type: 'Standard', workProductAnswers: [] });
    const db = testEnv
      .authenticatedContext('o', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/stdObs4'), {
        workProductAnswers: [{ questionId: 'q1', answer: 'x', updatedAt: new Date() }],
        lastModifiedAt: new Date(),
      }),
    );
  });
});

describe('observations: draftVisibility switchboard', () => {
  const visible = {
    ratings: true,
    notes: false,
    evidence: false,
    script: true,
    meetingNotes: false,
  };

  it('observer CAN toggle draftVisibility on their Draft', async () => {
    await seedDraftObs('visObs');
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'observations/visObs'), {
        draftVisibility: visible,
        lastModifiedAt: new Date(),
      }),
    );
  });

  it('observed teacher CANNOT change draftVisibility', async () => {
    await seedDraftObs('visObs2');
    const db = testEnv.authenticatedContext('t', claims.teacher(OBSERVED_EMAIL)).firestore();
    await assertFails(
      updateDoc(doc(db, 'observations/visObs2'), {
        draftVisibility: visible,
        lastModifiedAt: new Date(),
      }),
    );
  });
});

describe('observations: co-observers', () => {
  const AP_EMAIL = 'ap@orono.k12.mn.us';
  beforeEach(async () => {
    await seedDraftObs('obs1');
  });

  it('owner can share a Draft with a co-observer', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertSucceeds(updateDoc(doc(db, 'observations/obs1'), { coObserverEmails: [AP_EMAIL] }));
  });

  it('owner cannot add themselves or the observed teacher', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(updateDoc(doc(db, 'observations/obs1'), { coObserverEmails: [PE_EMAIL] }));
    await assertFails(
      updateDoc(doc(db, 'observations/obs1'), { coObserverEmails: [OBSERVED_EMAIL] }),
    );
  });

  it('cannot be created already shared', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval(PE_EMAIL)).firestore();
    await assertFails(
      setDoc(doc(db, 'observations/new1'), {
        observerEmail: PE_EMAIL,
        observedEmail: OBSERVED_EMAIL,
        status: 'Draft',
        type: 'Standard',
        coObserverEmails: [AP_EMAIL],
      }),
    );
  });

  it('a co-observer can edit Draft content but not sharing, visibility or status', async () => {
    await seedDraftObs('shared', { coObserverEmails: [AP_EMAIL] });
    const db = testEnv.authenticatedContext('ap', claims.admin(AP_EMAIL)).firestore();
    const ref = doc(db, 'observations/shared');
    await assertSucceeds(updateDoc(ref, { observationName: 'Joint notes' }));
    await assertFails(updateDoc(ref, { coObserverEmails: [AP_EMAIL, OTHER_PE_EMAIL] }));
    await assertFails(updateDoc(ref, { draftVisibility: { ratings: true } }));
    await assertFails(updateDoc(ref, { status: 'Finalized' }));
  });

  it('a co-observer cannot edit once Finalized, or delete', async () => {
    await seedDraftObs('sharedFinal', {
      coObserverEmails: [AP_EMAIL],
      status: 'Finalized',
      finalizedAt: new Date(),
    });
    await seedDraftObs('sharedDraft', { coObserverEmails: [AP_EMAIL] });
    const db = testEnv.authenticatedContext('ap', claims.admin(AP_EMAIL)).firestore();
    await assertSucceeds(getDoc(doc(db, 'observations/sharedFinal')));
    await assertFails(updateDoc(doc(db, 'observations/sharedFinal'), { observationName: 'x' }));
    await assertFails(deleteDoc(doc(db, 'observations/sharedDraft')));
  });
});
