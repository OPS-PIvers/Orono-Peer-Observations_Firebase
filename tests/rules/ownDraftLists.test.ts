import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Firestore,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { buildQuery, type CollectionConstraint } from '../../apps/web/src/hooks/collectionQuery';
import { ownDraftGate, withGate } from '../../apps/web/src/observations/ownDraftGate';
import { claims, seedFullAccessStaff, setupTestEnv } from './harness.js';

/**
 * Full Access and View As readers list every observation except their own
 * Drafts. The queries the app runs for them carry ownDraftGate, so these
 * tests run the same gate the app does.
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});

const FA = 'fullaccess@orono.k12.mn.us';
const VIEWER = 'viewer@orono.k12.mn.us';
const PE = 'pe@orono.k12.mn.us';
const TEACHER = 'teacher@orono.k12.mn.us';

async function seedObs(id: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'observations', id), {
      observerEmail: PE,
      observedEmail: TEACHER,
      observedName: 'Test Teacher',
      observationName: 'Sample',
      status: 'Draft',
      type: 'Standard',
      coObserverEmails: [],
      createdAt: new Date(),
      lastModifiedAt: new Date(),
      ...data,
    });
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedFullAccessStaff(testEnv);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'staff', VIEWER), {
      email: VIEWER,
      role: 'teacher',
      isActive: true,
      canViewAs: true,
    });
  });
  await seedObs('otherDraft', {});
  await seedObs('otherFinal', { status: 'Finalized' });
  await seedObs('faDraft', { observedEmail: FA, observedName: 'Full Access' });
  await seedObs('faFinal', { observedEmail: FA, observedName: 'Full Access', status: 'Finalized' });
  await seedObs('viewerDraft', {
    observedEmail: VIEWER,
    observedName: 'Viewer',
    coObserverEmails: ['pe2@orono.k12.mn.us'],
  });
  await seedObs('viewerFinal', { observedEmail: VIEWER, status: 'Finalized' });
});

const faDb = () => testEnv.authenticatedContext('fa', claims.fullAccess()).firestore();
const viewerDb = () => testEnv.authenticatedContext('v', claims.teacher(VIEWER)).firestore();

async function ids(db: Firestore, constraints: CollectionConstraint[]) {
  const snap = await assertSucceeds(
    getDocs(buildQuery(collection(db, 'observations'), constraints)),
  );
  return snap.docs.map((d) => d.id).sort();
}

const byModified = orderBy('lastModifiedAt', 'desc');

describe('Full Access lists (oversight)', () => {
  it('the unfiltered list returns everything but their own Draft', async () => {
    const cs = [...withGate([], ownDraftGate(FA)), byModified, limit(50)];
    expect(await ids(faDb(), cs)).toEqual([
      'faFinal',
      'otherDraft',
      'otherFinal',
      'viewerDraft',
      'viewerFinal',
    ]);
  });

  it('a Draft status filter leaves out their own Draft', async () => {
    const filters = [where('status', '==', 'Draft')];
    const cs = [...withGate(filters, ownDraftGate(FA, { status: 'Draft' })), byModified];
    expect(await ids(faDb(), cs)).toEqual(['otherDraft', 'viewerDraft']);
  });

  it('a Finalized status filter needs no gate', async () => {
    const filters = [where('status', '==', 'Finalized')];
    expect(ownDraftGate(FA, { status: 'Finalized' })).toEqual([]);
    expect(await ids(faDb(), [...filters, byModified])).toEqual([
      'faFinal',
      'otherFinal',
      'viewerFinal',
    ]);
  });

  it('their own person page shows only their Finalized observations', async () => {
    const filters = [where('observedEmail', '==', FA)];
    const cs = [...withGate(filters, ownDraftGate(FA, { observedEmail: FA })), byModified];
    expect(await ids(faDb(), cs)).toEqual(['faFinal']);
  });

  it("someone else's person page needs no gate", async () => {
    expect(ownDraftGate(FA, { observedEmail: TEACHER })).toEqual([]);
    const cs = [where('observedEmail', '==', TEACHER), byModified];
    expect(await ids(faDb(), cs)).toEqual(['otherDraft', 'otherFinal']);
  });

  it('the older-records name search leaves out their own Draft', async () => {
    const filters = [where('observedName', '>=', 'Full'), where('observedName', '<=', 'Full')];
    const cs = [...withGate(filters, ownDraftGate(FA)), orderBy('observedName'), limit(25)];
    expect(await ids(faDb(), cs)).toEqual(['faFinal']);
  });

  it('the observer-email search leaves out their own Draft', async () => {
    const cs = [...withGate([where('observerEmail', '==', PE)], ownDraftGate(FA)), limit(25)];
    expect(await ids(faDb(), cs)).toEqual([
      'faFinal',
      'otherDraft',
      'otherFinal',
      'viewerDraft',
      'viewerFinal',
    ]);
  });

  it('an ungated query that could return their own Draft is refused', async () => {
    const db = faDb();
    await assertFails(getDocs(query(collection(db, 'observations'), byModified)));
    await assertFails(
      getDocs(query(collection(db, 'observations'), where('observedEmail', '==', FA))),
    );
    await assertFails(
      getDocs(query(collection(db, 'observations'), where('observerEmail', '==', PE))),
    );
  });
});

describe('View As lists', () => {
  it("viewing as an observer, their own and shared lists leave out the viewer's Draft", async () => {
    const own = [
      ...withGate([where('observerEmail', '==', PE)], ownDraftGate(VIEWER)),
      byModified,
      limit(50),
    ];
    expect(await ids(viewerDb(), own)).toEqual([
      'faDraft',
      'faFinal',
      'otherDraft',
      'otherFinal',
      'viewerFinal',
    ]);
    const shared = [
      ...withGate(
        [where('coObserverEmails', 'array-contains', 'pe2@orono.k12.mn.us')],
        ownDraftGate(VIEWER),
      ),
      byModified,
    ];
    expect(await ids(viewerDb(), shared)).toEqual([]);
  });

  it('the ungated observer query is refused', async () => {
    await assertFails(
      getDocs(query(collection(viewerDb(), 'observations'), where('observerEmail', '==', PE))),
    );
  });

  it('a staff page about someone else needs no gate', async () => {
    const cs = [where('observedEmail', '==', TEACHER), where('status', '==', 'Draft')];
    expect(await ids(viewerDb(), cs)).toEqual(['otherDraft']);
  });

  it("the viewer's own Drafts can't be listed, their Finalized ones can", async () => {
    const db = viewerDb();
    const mine = where('observedEmail', '==', VIEWER);
    await assertFails(getDocs(query(collection(db, 'observations'), mine)));
    await assertFails(
      getDocs(query(collection(db, 'observations'), mine, where('status', '==', 'Draft'))),
    );
    expect(await ids(db, [mine, where('status', '==', 'Finalized')])).toEqual(['viewerFinal']);
  });
});
