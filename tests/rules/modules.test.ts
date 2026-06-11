import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
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
    const db = testEnv
      .authenticatedContext('p', claims.teacher('prob@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/year2/items/i2')));
  });

  it('non-matching staff is denied a status-only module item', async () => {
    const db = testEnv
      .authenticatedContext('l', claims.teacher('low1@orono.k12.mn.us'))
      .firestore();
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

describe('/modules/{id}/content — read gated by assignment, write admin-only', () => {
  beforeEach(async () => {
    await seed('staff/assigned@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('staff/other@orono.k12.mn.us', { modules: ['ilt'] });
    await seed('modules/mentor/content/sec-1', {
      sectionId: 'sec-1',
      moduleId: 'mentor',
      body: '{"type":"doc","content":[]}',
    });
  });

  it('assigned staff can read a content body', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/mentor/content/sec-1')));
  });

  it('unassigned staff cannot read a content body (the leak the fix closes)', async () => {
    const db = testEnv
      .authenticatedContext('o', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/mentor/content/sec-1')));
  });

  it('admin can read and write content', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/mentor/content/sec-1')));
    await assertSucceeds(
      setDoc(doc(db, 'modules/mentor/content/sec-2'), {
        sectionId: 'sec-2',
        moduleId: 'mentor',
        body: '{"type":"doc"}',
      }),
    );
  });

  it('assigned staff cannot write content', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      setDoc(doc(db, 'modules/mentor/content/sec-3'), {
        sectionId: 'sec-3',
        moduleId: 'mentor',
        body: 'x',
      }),
    );
  });
});

describe('/modules/{id}/content — auto-enable grants access by status/year', () => {
  beforeEach(async () => {
    await seed('modules/high-cycle', {
      moduleId: 'high-cycle',
      displayName: 'High Cycle',
      autoEnable: { dimension: 'status', value: 'high' },
    });
    await seed('modules/high-cycle/content/sec-1', {
      sectionId: 'sec-1',
      moduleId: 'high-cycle',
      body: 'High cycle guidance',
    });
    await seed('modules/year2', {
      moduleId: 'year2',
      displayName: 'Year 2',
      autoEnable: { dimension: 'year', value: 2 },
    });
    await seed('modules/year2/content/sec-1', {
      sectionId: 'sec-1',
      moduleId: 'year2',
      body: 'Year 2 guidance',
    });
    await seed('staff/high2@orono.k12.mn.us', { year: 2, summativeYear: true, modules: [] });
    await seed('staff/low1@orono.k12.mn.us', { year: 1, summativeYear: false, modules: [] });
    await seed('staff/y2low@orono.k12.mn.us', { year: 2, summativeYear: false, modules: [] });
    await seed('staff/y1high@orono.k12.mn.us', { year: 1, summativeYear: true, modules: [] });
  });

  it('status-matched staff reads a status-rule content body (not in their array)', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/content/sec-1')));
  });

  it('non-matching staff is denied a status-only content body', async () => {
    const db = testEnv
      .authenticatedContext('l', claims.teacher('low1@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/high-cycle/content/sec-1')));
  });

  it('cross-dimension isolation: a year match does not grant a status-rule content body', async () => {
    const db = testEnv
      .authenticatedContext('y2l', claims.teacher('y2low@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/high-cycle/content/sec-1')));
    await assertSucceeds(getDoc(doc(db, 'modules/year2/content/sec-1')));
  });

  it('cross-dimension isolation: a status match does not grant a year-rule content body', async () => {
    const db = testEnv
      .authenticatedContext('y1h', claims.teacher('y1high@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/year2/content/sec-1')));
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/content/sec-1')));
  });
});

// The module page (/m/{moduleId}) lists /modules/{id}/content directly, the
// same way it lists /items — Firestore evaluates list queries against the
// QUERY, so the rule's `resource.data.moduleId in …` condition is only provable
// when the client filters on moduleId. An unfiltered list is denied for every
// non-admin user, even assigned staff.
describe('module content — direct subcollection list (the module page access path)', () => {
  beforeEach(async () => {
    await seed('staff/assigned@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('staff/other@orono.k12.mn.us', { modules: ['ilt'] });
    await seed('modules/mentor/content/sec-1', {
      sectionId: 'sec-1',
      moduleId: 'mentor',
      body: 'Mentor guidance',
    });
  });

  it('assigned staff can list content filtered to their module id', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'modules/mentor/content'), where('moduleId', '==', 'mentor'))),
    );
  });

  it('assigned staff cannot list content without the moduleId filter', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDocs(collection(db, 'modules/mentor/content')));
  });

  it('unassigned staff cannot list content even with the moduleId filter', async () => {
    const db = testEnv
      .authenticatedContext('o', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      getDocs(query(collection(db, 'modules/mentor/content'), where('moduleId', '==', 'mentor'))),
    );
  });

  it('admin can list content without any filter', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDocs(collection(db, 'modules/mentor/content')));
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

// ---------------------------------------------------------------------------
// /staff/{email}/moduleProgress — collection-group admin rule
// ---------------------------------------------------------------------------
// The new /{path=**}/moduleProgress/{itemId} collection-group rule lets
// admins run cross-staff queries for the ModuleBuilderPage progress roster.
// Staff can read/write only their own docs (the per-staff rule handles that);
// the collection-group rule must NOT expand that to let non-admins read
// other people's progress.
describe('/staff/{email}/moduleProgress — collection-group query (admin progress roster)', () => {
  beforeEach(async () => {
    await seed('staff/alice@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('staff/alice@orono.k12.mn.us/moduleProgress/i1', {
      itemId: 'i1',
      moduleId: 'mentor',
      status: 'done',
      completedAt: new Date().toISOString(),
    });
    await seed('staff/bob@orono.k12.mn.us', { modules: ['mentor'] });
    await seed('staff/bob@orono.k12.mn.us/moduleProgress/i1', {
      itemId: 'i1',
      moduleId: 'mentor',
      status: 'done',
      completedAt: new Date().toISOString(),
    });
  });

  it('admin can run a collectionGroup query filtered by moduleId', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      getDocs(query(collectionGroup(db, 'moduleProgress'), where('moduleId', '==', 'mentor'))),
    );
  });

  it('admin can get a single progress doc via the per-staff path', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'staff/alice@orono.k12.mn.us/moduleProgress/i1')));
  });

  it('staff can read their own progress doc', async () => {
    const db = testEnv
      .authenticatedContext('alice', claims.teacher('alice@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'staff/alice@orono.k12.mn.us/moduleProgress/i1')));
  });

  it("staff cannot read another person's progress doc via the per-staff path", async () => {
    const db = testEnv
      .authenticatedContext('alice', claims.teacher('alice@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'staff/bob@orono.k12.mn.us/moduleProgress/i1')));
  });

  it('non-admin staff cannot run a cross-staff collectionGroup query', async () => {
    const db = testEnv
      .authenticatedContext('alice', claims.teacher('alice@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      getDocs(query(collectionGroup(db, 'moduleProgress'), where('moduleId', '==', 'mentor'))),
    );
  });

  it('admin cannot write to a moduleProgress doc via the collection-group path', async () => {
    // Writes must go through the per-staff rule, which also allows admins —
    // but the collection-group rule explicitly denies writes to prevent
    // accidental double-path mutations.
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    // Direct per-staff path write IS allowed by the /staff/{email}/moduleProgress/{itemId} rule.
    await assertSucceeds(
      setDoc(doc(db, 'staff/alice@orono.k12.mn.us/moduleProgress/i2'), {
        itemId: 'i2',
        moduleId: 'mentor',
        status: 'done',
        completedAt: new Date().toISOString(),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// auto-enable exclusions — moduleExclusions overrides the rule for that staff
// ---------------------------------------------------------------------------
describe('/modules/{id}/items — auto-enable exclusion blocks access', () => {
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
    // Staff that matches the rule
    await seed('staff/high2@orono.k12.mn.us', {
      year: 2,
      summativeYear: true,
      modules: [],
      moduleExclusions: [],
    });
    // Staff that matches the rule but has an exclusion for high-cycle
    await seed('staff/excluded@orono.k12.mn.us', {
      year: 2,
      summativeYear: true,
      modules: [],
      moduleExclusions: ['high-cycle'],
    });
    // Staff that matches the rule, has an exclusion, but ALSO has a manual assignment
    await seed('staff/manualoverride@orono.k12.mn.us', {
      year: 2,
      summativeYear: true,
      modules: ['high-cycle'],
      moduleExclusions: ['high-cycle'],
    });
  });

  it('matching staff without exclusion can read an auto-enabled item', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('matching staff WITH an exclusion is denied the auto-enabled item', async () => {
    const db = testEnv
      .authenticatedContext('e', claims.teacher('excluded@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });

  it('staff with exclusion but manual assignment can still read the item', async () => {
    const db = testEnv
      .authenticatedContext('m', claims.teacher('manualoverride@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/items/i1')));
  });
});

describe('/modules/{id}/content — auto-enable exclusion blocks access', () => {
  beforeEach(async () => {
    await seed('modules/high-cycle', {
      moduleId: 'high-cycle',
      displayName: 'High Cycle',
      autoEnable: { dimension: 'status', value: 'high' },
    });
    await seed('modules/high-cycle/content/sec-1', {
      sectionId: 'sec-1',
      moduleId: 'high-cycle',
      body: 'High cycle guidance',
    });
    await seed('staff/high2@orono.k12.mn.us', {
      year: 2,
      summativeYear: true,
      modules: [],
      moduleExclusions: [],
    });
    await seed('staff/excluded@orono.k12.mn.us', {
      year: 2,
      summativeYear: true,
      modules: [],
      moduleExclusions: ['high-cycle'],
    });
  });

  it('matching staff without exclusion can read auto-enabled content', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high2@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(getDoc(doc(db, 'modules/high-cycle/content/sec-1')));
  });

  it('matching staff WITH an exclusion is denied auto-enabled content', async () => {
    const db = testEnv
      .authenticatedContext('e', claims.teacher('excluded@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDoc(doc(db, 'modules/high-cycle/content/sec-1')));
  });
});

// The module page (/m/{moduleId}) lists /modules/{id}/items directly.
// Firestore evaluates list queries against the QUERY, not the returned
// documents, so the rule's `resource.data.moduleId in …` condition is only
// provable when the client filters on moduleId — an unfiltered list is
// denied for every non-admin user, even assigned staff.
describe('module items — direct subcollection list (the module page access path)', () => {
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
    // auto-enable module (status: high) + staff matching it without assignment
    await seed('modules/high-cycle', {
      moduleId: 'high-cycle',
      displayName: 'High Cycle',
      autoEnable: { dimension: 'status', value: 'high' },
    });
    await seed('modules/high-cycle/items/i2', {
      itemId: 'i2',
      moduleId: 'high-cycle',
      kind: 'material',
      sectionId: 's1',
      title: 'High cycle packet',
    });
    await seed('staff/high@orono.k12.mn.us', { year: 2, summativeYear: true, modules: [] });
  });

  it('assigned staff can list items filtered to their module id', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'modules/mentor/items'), where('moduleId', '==', 'mentor'))),
    );
  });

  it('assigned staff cannot list items without the moduleId filter', async () => {
    const db = testEnv
      .authenticatedContext('a', claims.teacher('assigned@orono.k12.mn.us'))
      .firestore();
    await assertFails(getDocs(collection(db, 'modules/mentor/items')));
  });

  it('unassigned staff cannot list items even with the moduleId filter', async () => {
    const db = testEnv
      .authenticatedContext('o', claims.teacher('other@orono.k12.mn.us'))
      .firestore();
    await assertFails(
      getDocs(query(collection(db, 'modules/mentor/items'), where('moduleId', '==', 'mentor'))),
    );
  });

  it('auto-enable-matched staff can list items with the moduleId filter', async () => {
    const db = testEnv
      .authenticatedContext('h', claims.teacher('high@orono.k12.mn.us'))
      .firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, 'modules/high-cycle/items'), where('moduleId', '==', 'high-cycle')),
      ),
    );
  });

  it('admin can list items without any filter', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDocs(collection(db, 'modules/mentor/items')));
  });
});
