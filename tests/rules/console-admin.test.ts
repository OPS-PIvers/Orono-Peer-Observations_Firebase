import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { claims, setupTestEnv } from './harness.js';

/**
 * Building Administrators carry the isAdmin claim (observations, windows)
 * but not Admin Console access unless their staff doc has hasAdminAccess.
 * They may manage staff in their own building(s) only, within the fields
 * /building-staff writes. See isConsoleAdmin / buildingAdminCanCreateStaff
 * in firestore.rules.
 */

let testEnv: RulesTestEnvironment;

const PRINCIPAL = 'principal@orono.k12.mn.us';
const CONSOLE_PRINCIPAL = 'console-principal@orono.k12.mn.us';

beforeAll(async () => {
  testEnv = await setupTestEnv();
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(`staff/${PRINCIPAL}`, {
    email: PRINCIPAL,
    name: 'Principal',
    role: 'administrator',
    buildings: ['OMS'],
    hasAdminAccess: false,
    isActive: true,
  });
  await seed(`staff/${CONSOLE_PRINCIPAL}`, {
    email: CONSOLE_PRINCIPAL,
    name: 'Console Principal',
    role: 'administrator',
    buildings: ['OMS'],
    hasAdminAccess: true,
    isActive: true,
  });
  await seed('staff/ann@orono.k12.mn.us', teacher('ann@orono.k12.mn.us', ['OMS']));
  await seed('staff/hal@orono.k12.mn.us', teacher('hal@orono.k12.mn.us', ['OHS']));
  await seed('staff/pe@orono.k12.mn.us', {
    ...teacher('pe@orono.k12.mn.us', ['OMS']),
    role: 'peer-evaluator',
  });
  await seed('roles/teacher', { roleId: 'teacher', displayName: 'Teacher' });
  await seed('roles/counselor', { roleId: 'counselor', displayName: 'Counselor' });
  await seed('roles/full-access', { roleId: 'full-access', displayName: 'Full Access' });
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

function teacher(email: string, buildings: string[]) {
  return {
    email,
    name: email.split('@')[0],
    role: 'teacher',
    year: 1,
    buildings,
    modules: [],
    cycleStatus: 'planning',
    summativeYear: false,
    hasAdminAccess: false,
    isActive: true,
  };
}

const principalDb = () =>
  testEnv.authenticatedContext('principal', claims.admin(PRINCIPAL)).firestore();
const consolePrincipalDb = () =>
  testEnv.authenticatedContext('console', claims.admin(CONSOLE_PRINCIPAL)).firestore();

describe('console-only collections', () => {
  it('building Administrator cannot write them', async () => {
    const db = principalDb();
    await assertFails(setDoc(doc(db, 'roles/new'), { displayName: 'New' }));
    await assertFails(setDoc(doc(db, 'rubrics/new'), { displayName: 'New' }));
    await assertFails(setDoc(doc(db, 'buildings/new'), { displayName: 'New' }));
    await assertFails(setDoc(doc(db, 'modules/new'), { displayName: 'New' }));
    await assertFails(setDoc(doc(db, 'appSettings/global'), { x: 1 }, { merge: true }));
    await assertFails(setDoc(doc(db, 'emailTemplates/t'), { name: 'T' }));
  });

  it('building Administrator can still read email templates but not the audit log', async () => {
    await seed('emailTemplates/t', { name: 'T' });
    await seed('auditLog/l', { action: 'x' });
    const db = principalDb();
    await assertSucceeds(getDoc(doc(db, 'emailTemplates/t')));
    await assertFails(getDoc(doc(db, 'auditLog/l')));
  });

  it('an Administrator with hasAdminAccess keeps console access', async () => {
    const db = consolePrincipalDb();
    await assertSucceeds(setDoc(doc(db, 'roles/new'), { displayName: 'New' }));
    await assertSucceeds(setDoc(doc(db, 'appSettings/global'), { x: 1 }, { merge: true }));
    await seed('auditLog/l', { action: 'x' });
    await assertSucceeds(getDoc(doc(db, 'auditLog/l')));
  });
});

describe('AI usage collections', () => {
  beforeEach(async () => {
    await seed('aiUsageDaily/2026-10-12', { date: '2026-10-12' });
    await seed('aiUsageEvents/e1', { feature: 'scriptAutoTag' });
  });

  it('console admins read them', async () => {
    const db = consolePrincipalDb();
    await assertSucceeds(getDoc(doc(db, 'aiUsageDaily/2026-10-12')));
    await assertSucceeds(getDoc(doc(db, 'aiUsageEvents/e1')));
  });

  it('building Administrators and teachers cannot read them', async () => {
    const teacherDb = testEnv
      .authenticatedContext('ann', claims.teacher('ann@orono.k12.mn.us'))
      .firestore();
    for (const db of [principalDb(), teacherDb]) {
      await assertFails(getDoc(doc(db, 'aiUsageDaily/2026-10-12')));
      await assertFails(getDoc(doc(db, 'aiUsageEvents/e1')));
    }
  });

  it('nobody writes them from the client', async () => {
    const db = consolePrincipalDb();
    await assertFails(setDoc(doc(db, 'aiUsageDaily/2026-10-12'), { date: 'x' }, { merge: true }));
    await assertFails(setDoc(doc(db, 'aiUsageEvents/e2'), { feature: 'scriptAutoTag' }));
  });
});

describe('/staff — building Administrator', () => {
  it('edits staff in their building', async () => {
    const db = principalDb();
    await assertSucceeds(
      updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), {
        name: 'Ann B',
        year: 2,
        cycleStatus: 'high',
        summativeYear: true,
        isActive: false,
        updatedAt: new Date(),
      }),
    );
  });

  it('can move someone out of their building', async () => {
    await assertSucceeds(
      updateDoc(doc(principalDb(), 'staff/ann@orono.k12.mn.us'), { buildings: ['OHS'] }),
    );
  });

  it('cannot edit staff in another building, or pull them in', async () => {
    const db = principalDb();
    await assertFails(updateDoc(doc(db, 'staff/hal@orono.k12.mn.us'), { name: 'Hal B' }));
    await assertFails(updateDoc(doc(db, 'staff/hal@orono.k12.mn.us'), { buildings: ['OMS'] }));
  });

  it('cannot grant module or Admin Console access', async () => {
    const db = principalDb();
    await assertFails(updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), { hasAdminAccess: true }));
    await assertFails(updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), { modules: ['mentor'] }));
  });

  it('cannot assign a special role or edit someone who has one', async () => {
    const db = principalDb();
    await assertFails(updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), { role: 'full-access' }));
    await assertFails(updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), { role: 'administrator' }));
    await assertFails(updateDoc(doc(db, 'staff/pe@orono.k12.mn.us'), { role: 'teacher' }));
  });

  it('can only assign a known, non-special role id', async () => {
    const db = principalDb();
    const ann = doc(db, 'staff/ann@orono.k12.mn.us');
    await assertSucceeds(updateDoc(ann, { role: 'counselor' }));
    // Display-name and padded forms the console's role-slug tools would
    // resolve to a special slug, plus ids with no /roles doc.
    for (const role of ['Full Access', 'peer evaluator', ' administrator', 'bogus', '', 7]) {
      await assertFails(updateDoc(ann, { role }));
      await assertFails(
        setDoc(doc(db, 'staff/new@orono.k12.mn.us'), {
          ...teacher('new@orono.k12.mn.us', ['OMS']),
          role,
        }),
      );
    }
  });

  it('still edits someone whose stored role has no /roles doc', async () => {
    await seed('staff/leg@orono.k12.mn.us', {
      ...teacher('leg@orono.k12.mn.us', ['OMS']),
      role: 'Legacy Para',
    });
    const db = principalDb();
    const leg = doc(db, 'staff/leg@orono.k12.mn.us');
    await assertSucceeds(updateDoc(leg, { year: 2, isActive: false }));
    await assertFails(updateDoc(leg, { role: 'Full Access' }));
    await assertSucceeds(updateDoc(leg, { role: 'teacher' }));
  });

  it('cannot promote themselves', async () => {
    const db = principalDb();
    await assertFails(updateDoc(doc(db, `staff/${PRINCIPAL}`), { hasAdminAccess: true }));
    await assertFails(updateDoc(doc(db, `staff/${PRINCIPAL}`), { buildings: ['OMS', 'OHS'] }));
  });

  it('creates a plain staff member in their building', async () => {
    await assertSucceeds(
      setDoc(
        doc(principalDb(), 'staff/new@orono.k12.mn.us'),
        teacher('new@orono.k12.mn.us', ['OMS']),
      ),
    );
  });

  it('cannot create someone outside their building or with access', async () => {
    const db = principalDb();
    await assertFails(
      setDoc(doc(db, 'staff/new@orono.k12.mn.us'), teacher('new@orono.k12.mn.us', ['OHS'])),
    );
    await assertFails(
      setDoc(doc(db, 'staff/new@orono.k12.mn.us'), {
        ...teacher('new@orono.k12.mn.us', ['OMS']),
        hasAdminAccess: true,
      }),
    );
    await assertFails(
      setDoc(doc(db, 'staff/new@orono.k12.mn.us'), {
        ...teacher('new@orono.k12.mn.us', ['OMS']),
        role: 'peer-evaluator',
      }),
    );
    await assertFails(
      setDoc(doc(db, 'staff/new@orono.k12.mn.us'), {
        ...teacher('new@orono.k12.mn.us', ['OMS']),
        modules: ['mentor'],
      }),
    );
  });

  it('cannot create a case-variant or off-domain staff doc', async () => {
    // hal is in another building; a mixed-case id would be a second doc for
    // the same person, which the observe gate and claims sync would trust.
    const db = principalDb();
    await assertFails(
      setDoc(doc(db, 'staff/Hal@orono.k12.mn.us'), teacher('Hal@orono.k12.mn.us', ['OMS'])),
    );
    await assertFails(
      setDoc(doc(db, 'staff/NEW@orono.k12.mn.us'), teacher('NEW@orono.k12.mn.us', ['OMS'])),
    );
    await assertFails(
      setDoc(doc(db, 'staff/someone@gmail.com'), teacher('someone@gmail.com', ['OMS'])),
    );
    await assertFails(
      setDoc(
        doc(db, 'staff/x@orono.k12.mn.us.evil.com'),
        teacher('x@orono.k12.mn.us.evil.com', ['OMS']),
      ),
    );
  });

  it('cannot delete staff', async () => {
    await assertFails(deleteDoc(doc(principalDb(), 'staff/ann@orono.k12.mn.us')));
  });

  it('an Administrator with hasAdminAccess edits anyone', async () => {
    const db = consolePrincipalDb();
    await assertSucceeds(updateDoc(doc(db, 'staff/hal@orono.k12.mn.us'), { role: 'full-access' }));
    await assertSucceeds(updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), { hasAdminAccess: true }));
  });
});

// A token minted before console access was revoked still carries isAdmin
// (and the old role) until it refreshes. The live staff doc must win, or the
// holder could write their own grant back and onStaffWritten would re-mint it.
describe('revoked console access with a pre-revocation token', () => {
  const ANN = 'ann@orono.k12.mn.us';
  const FA = 'fa@orono.k12.mn.us';

  it('a teacher whose hasAdminAccess was removed loses the console', async () => {
    // Live doc: plain teacher (hasAdminAccess: false). Token: still isAdmin.
    const db = testEnv
      .authenticatedContext('ann', {
        ...claims.teacher(ANN),
        hasSpecialAccess: true,
        isAdmin: true,
      })
      .firestore();
    await assertFails(updateDoc(doc(db, `staff/${ANN}`), { hasAdminAccess: true }));
    await assertFails(updateDoc(doc(db, `staff/${ANN}`), { role: 'full-access' }));
    await assertFails(updateDoc(doc(db, 'staff/hal@orono.k12.mn.us'), { canViewAs: true }));
    await assertFails(setDoc(doc(db, 'roles/new'), { displayName: 'New' }));
    await assertFails(setDoc(doc(db, 'appSettings/global'), { x: 1 }, { merge: true }));
    await seed('auditLog/l', { action: 'x' });
    await assertFails(getDoc(doc(db, 'auditLog/l')));
  });

  it('a demoted Full Access user loses the console', async () => {
    await seed(`staff/${FA}`, teacher(FA, ['OMS']));
    const db = testEnv.authenticatedContext('fa', claims.fullAccess(FA)).firestore();
    await assertFails(updateDoc(doc(db, `staff/${FA}`), { role: 'full-access' }));
    await assertFails(updateDoc(doc(db, `staff/${FA}`), { hasAdminAccess: true }));
    await assertFails(deleteDoc(doc(db, 'staff/hal@orono.k12.mn.us')));
    await assertFails(setDoc(doc(db, 'rubrics/new'), { displayName: 'New' }));
  });

  it('an Administrator whose hasAdminAccess was removed loses the console', async () => {
    await seed(`staff/${CONSOLE_PRINCIPAL}`, {
      email: CONSOLE_PRINCIPAL,
      role: 'administrator',
      buildings: ['OMS'],
      hasAdminAccess: false,
      isActive: true,
    });
    const db = consolePrincipalDb();
    await assertFails(updateDoc(doc(db, `staff/${CONSOLE_PRINCIPAL}`), { hasAdminAccess: true }));
    await assertFails(setDoc(doc(db, 'roles/new'), { displayName: 'New' }));
  });

  it('a live Full Access or hasAdminAccess doc keeps the console', async () => {
    await seed(`staff/${FA}`, { ...teacher(FA, ['OMS']), role: 'full-access' });
    const faDb = testEnv.authenticatedContext('fa', claims.fullAccess(FA)).firestore();
    await assertSucceeds(setDoc(doc(faDb, 'roles/new'), { displayName: 'New' }));
    await seed(`staff/${ANN}`, { ...teacher(ANN, ['OMS']), hasAdminAccess: true });
    const annDb = testEnv
      .authenticatedContext('ann', {
        ...claims.teacher(ANN),
        hasSpecialAccess: true,
        isAdmin: true,
      })
      .firestore();
    await assertSucceeds(setDoc(doc(annDb, 'rubrics/new'), { displayName: 'New' }));
  });
});
