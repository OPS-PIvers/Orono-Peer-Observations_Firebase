import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { collectionGroup, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';
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

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe('/modules/{id}/items — read gated by assignment, write admin-only', () => {
  beforeEach(async () => {
    await seed('staff/assigned@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('staff/other@orono.k12.mn.us', { modules: ['ilt'] });
    await seed('modules/mentor/items/i1', {
      itemId: 'i1',
      moduleId: 'mentor',
      kind: 'resource',
      sectionId: 's1',
      title: 'Handbook',
    });
  });

  it('assigned staff can read an item', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/mentor/items/i1')));
  });

  it('unassigned staff cannot read an item', async () => {
    const db = testEnv
      .authenticatedContext('o', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/mentor/items/i1')));
  });

  it('admin can read and write items', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/mentor/items/i1')));
    await assertSucceeds(
      setDoc(doc(db, 'modules/mentor/items/i2'), {
        itemId: 'i2',
        moduleId: 'mentor',
        kind: 'material',
        sectionId: 's2',
        title: 'Task',
      }),
    );
  });

  it('assigned staff cannot write items', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      setDoc(doc(db, 'modules/mentor/items/i3'), {
        itemId: 'i3',
        moduleId: 'mentor',
        kind: 'resource',
        sectionId: 's1',
        title: 'X',
      }),
    );
  });
});

describe('/staff/{email}/moduleProgress — own progress only', () => {
  beforeEach(async () => {
    await seed('staff/me@orono.k12.mn.us', { modules: ['mentor'] });
  });

  it('a staff member can write their own progress', async () => {
    const db = testEnv.authenticatedContext('me', claims.teacher('me@orono.k12.mn.us')).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'staff/me@orono.k12.mn.us/moduleProgress/i1'), {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
      }),
    );
  });

  it("a staff member cannot write someone else's progress", async () => {
    const db = testEnv.authenticatedContext('me', claims.teacher('me@orono.k12.mn.us')).firestore();
    await assertFails(
      setDoc(doc(db, 'staff/other@orono.k12.mn.us/moduleProgress/i1'), {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
      }),
    );
  });

  it('admin can read a staff member progress doc', async () => {
    await seed('staff/me@orono.k12.mn.us/moduleProgress/i1', {
      itemId: 'i1',
      moduleId: 'mentor',
      status: 'done',
    });
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff/me@orono.k12.mn.us/moduleProgress/i1')));
  });
});

// The dashboard reads module materials with a collectionGroup query, NOT direct
// gets — `collectionGroup('items')` filtered by `kind == 'material'` and
// `moduleId in <assignedIds>`. This exercises the recursive
// `match /{path=**}/items/{itemId}` rule on the query path: the rule passes only
// when every returned doc's moduleId is in the requester's assigned modules, so
// the client's own `moduleId in [...]` filter is what makes the query authorized.
describe('module items — collectionGroup query (the dashboard access path)', () => {
  beforeEach(async () => {
    await seed('staff/assigned@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('modules/mentor/items/m1', {
      itemId: 'm1',
      moduleId: 'mentor',
      kind: 'material',
      sectionId: 's1',
      title: 'Mentor task',
    });
    await seed('modules/ilt/items/m2', {
      itemId: 'm2',
      moduleId: 'ilt',
      kind: 'material',
      sectionId: 's1',
      title: 'ILT task',
    });
  });

  it('assigned staff can query materials scoped to their assigned module', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, 'items'),
          where('kind', '==', 'material'),
          where('moduleId', 'in', ['mentor']),
        ),
      ),
    );
  });

  it('staff cannot query materials of a module they are not assigned', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      getDocs(
        query(
          collectionGroup(db, 'items'),
          where('kind', '==', 'material'),
          where('moduleId', 'in', ['ilt']),
        ),
      ),
    );
  });

  it('admin can query materials across modules', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, 'items'),
          where('kind', '==', 'material'),
          where('moduleId', 'in', ['mentor', 'ilt']),
        ),
      ),
    );
  });
});
