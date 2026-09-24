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

  it('cannot delete staff', async () => {
    await assertFails(deleteDoc(doc(principalDb(), 'staff/ann@orono.k12.mn.us')));
  });

  it('an Administrator with hasAdminAccess edits anyone', async () => {
    const db = consolePrincipalDb();
    await assertSucceeds(updateDoc(doc(db, 'staff/hal@orono.k12.mn.us'), { role: 'full-access' }));
    await assertSucceeds(updateDoc(doc(db, 'staff/ann@orono.k12.mn.us'), { hasAdminAccess: true }));
  });
});
