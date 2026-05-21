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

describe('/modules/{id}/items — auto-enable grants access by status/year', () => {
  beforeEach(async () => {
    // high-cycle module: auto-enables for cycle status 'high'
    await seed('modules/high-cycle', {
      moduleId: 'high-cycle',
      displayName: 'High Cycle',
      autoEnable: { dimension: 'status', value: 'high' },
    });
    await seed('modules/high-cycle/items/i1', {
      itemId: 'i1',
      moduleId: 'high-cycle',
      kind: 'material',
      sectionId: 's1',
      title: 'High cycle packet',
    });
    // year2 module: auto-enables for display year 2
    await seed('modules/year2', {
      moduleId: 'year2',
      displayName: 'Year 2',
      autoEnable: { dimension: 'year', value: 2 },
    });
    await seed('modules/year2/items/i2', {
      itemId: 'i2',
      moduleId: 'year2',
      kind: 'material',
      sectionId: 's1',
      title: 'Year 2 task',
    });
    // staff who is high cycle (summative), year 2 — matches both
    await seed('staff/high2@orono.k12.mn.us', { year: 2, summativeYear: true, modules: [] });
    // staff who is low cycle, year 1 — matches neither
    await seed('staff/low1@orono.k12.mn.us', { year: 1, summativeYear: false, modules: [] });
    // probationary staff stored as year 5 (displays as year 2)
    await seed('staff/prob@orono.k12.mn.us', { year: 5, summativeYear: false, modules: [] });
    // year 2 but LOW cycle — matches the year rule, must NOT match the status rule
    await seed('staff/y2low@orono.k12.mn.us', { year: 2, summativeYear: false, modules: [] });
    // year 1 but HIGH cycle — matches the status rule, must NOT match the year rule
    await seed('staff/y1high@orono.k12.mn.us', { year: 1, summativeYear: true, modules: [] });
  });

  it('high-cycle staff reads a status-matched module item (not in their array)', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('year-2 staff reads a year-matched module item', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/year2/items/i2')));
  });

  it('probationary year-5 staff matches display year 2', async () => {
    const db = testEnv.authenticatedContext('p', claims.teacher('prob@orono.k12.mn.us')).firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/year2/items/i2')));
  });

  it('non-matching staff is denied a status-only module item', async () => {
    const db = testEnv.authenticatedContext('l', claims.teacher('low1@orono.k12.mn.us')).firestore();
    await assertFails(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('cross-dimension isolation: a year match does not grant a status-rule module', async () => {
    const db = testEnv
      .authenticatedContext('y2l', claims.teacher('y2low@orono.k12.mn.us'))
      .firestore();
    // year 2 (matches the year2 module) but low cycle — denied the status=high module
    await assertFails(getDoc(doc(db, 'modules/high-cycle/items/i1')));
    await assertSucceeds(getDoc(doc(db, 'modules/year2/items/i2')));
  });

  it('cross-dimension isolation: a status match does not grant a year-rule module', async () => {
    const db = testEnv
      .authenticatedContext('y1h', claims.teacher('y1high@orono.k12.mn.us'))
      .firestore();
    // high cycle (matches the high-cycle module) but year 1 — denied the year=2 module
    await assertFails(getDoc(doc(db, 'modules/year2/items/i2')));
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('a matching staff can run the dashboard collectionGroup query for the auto module', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(
      getDocs(
        query(
          collectionGroup(db, 'items'),
          where('kind', '==', 'material'),
          where('moduleId', 'in', ['high-cycle']),
        ),
      ),
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
