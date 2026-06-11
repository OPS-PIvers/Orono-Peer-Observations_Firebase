import {
  type RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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

describe('/roles, /rubrics — read by all signed-in domain users; write admin-only', () => {
  beforeEach(async () => {
    await seed('roles/teacher', { displayName: 'Teacher' });
    await seed('rubrics/teacher', { displayName: 'Teacher' });
  });

  it('teacher can read', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'roles/teacher')));
    await assertSucceeds(getDoc(doc(db, 'rubrics/teacher')));
  });

  it('outsider cannot read', async () => {
    const db = testEnv.authenticatedContext('out', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'roles/teacher')));
    await assertFails(getDoc(doc(db, 'rubrics/teacher')));
  });

  it('teacher cannot write', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(setDoc(doc(db, 'roles/new'), { displayName: 'New' }));
    await assertFails(setDoc(doc(db, 'rubrics/new'), { displayName: 'New' }));
  });

  it('admin can write', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(setDoc(doc(db, 'roles/new'), { displayName: 'New' }));
    await assertSucceeds(setDoc(doc(db, 'rubrics/new'), { displayName: 'New' }));
  });
});

describe('/settings/roleYearMappings — read by all domain, write admin-only', () => {
  it('teacher can read role/year mappings (needed to render their own rubric)', async () => {
    await seed('roleYearMappings/teacher_1', { assignedComponentIds: ['1a', '1b'] });
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'roleYearMappings/teacher_1')));
  });

  it('teacher cannot write', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(setDoc(doc(db, 'roleYearMappings/teacher_1'), {}));
  });

  it('admin can write', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'roleYearMappings/teacher_2'), { assignedComponentIds: ['2a'] }),
    );
  });
});

describe('/workProductQuestions — all domain users read; admin write', () => {
  beforeEach(async () => {
    await seed('workProductQuestions/q1', { text: 'Sample question', order: 0 });
  });

  it('teacher can read (needed for WP/IR answer forms)', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'workProductQuestions/q1')));
  });

  it('peer evaluator can read', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertSucceeds(getDoc(doc(db, 'workProductQuestions/q1')));
  });

  it('PE cannot write', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(setDoc(doc(db, 'workProductQuestions/q2'), { text: 'X', order: 1 }));
  });

  it('admin can write', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(setDoc(doc(db, 'workProductQuestions/q2'), { text: 'X', order: 1 }));
  });
});

describe('/emailTemplates — admin only', () => {
  beforeEach(async () => {
    await seed('emailTemplates/finalizedObservation', { subject: 'X' });
  });

  it('teacher cannot read', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(getDoc(doc(db, 'emailTemplates/finalizedObservation')));
  });

  it('PE cannot read', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(getDoc(doc(db, 'emailTemplates/finalizedObservation')));
  });

  it('admin can read + write', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'emailTemplates/finalizedObservation')));
    await assertSucceeds(
      setDoc(doc(db, 'emailTemplates/finalizedObservation'), { subject: 'Updated' }),
    );
  });
});

describe('/appSettings — domain read, admin write', () => {
  beforeEach(async () => {
    await seed('appSettings/global', { branding: { appName: 'OPS Peer Observations' } });
  });

  it('teacher can read (needs branding for shell)', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertSucceeds(getDoc(doc(db, 'appSettings/global')));
  });

  it('outsider cannot read', async () => {
    const db = testEnv.authenticatedContext('out', claims.outsider).firestore();
    await assertFails(getDoc(doc(db, 'appSettings/global')));
  });

  it('teacher cannot write', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(setDoc(doc(db, 'appSettings/global'), {}, { merge: true }));
  });

  it('admin can write', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'appSettings/global'), { sessionDurationHours: 12 }, { merge: true }),
    );
  });
});

describe('/rateLimitCounters — fully server-only (no client read or write)', () => {
  beforeEach(async () => {
    await seed('rateLimitCounters/pe@orono.k12.mn.us__audioUpload', {
      count: 1,
      userEmail: 'pe@orono.k12.mn.us',
      key: 'audioUpload',
    });
  });

  it('a teacher cannot read a counter', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(getDoc(doc(db, 'rateLimitCounters/pe@orono.k12.mn.us__audioUpload')));
  });

  it('the owning peer evaluator cannot read their own counter', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(getDoc(doc(db, 'rateLimitCounters/pe@orono.k12.mn.us__audioUpload')));
  });

  it('an admin cannot read a counter (no remaining-budget leak)', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertFails(getDoc(doc(db, 'rateLimitCounters/pe@orono.k12.mn.us__audioUpload')));
  });

  it('a peer evaluator cannot zero out their own counter', async () => {
    const db = testEnv.authenticatedContext('pe', claims.peerEval()).firestore();
    await assertFails(
      setDoc(doc(db, 'rateLimitCounters/pe@orono.k12.mn.us__audioUpload'), { count: 0 }),
    );
  });

  it('an admin cannot write a counter directly (only Cloud Functions can)', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertFails(
      setDoc(doc(db, 'rateLimitCounters/pe@orono.k12.mn.us__transcription'), { count: 0 }),
    );
  });
});

describe('/auditLog — admin read, no client writes', () => {
  beforeEach(async () => {
    await seed('auditLog/log1', { action: 'sign_in', userEmail: 'a@orono.k12.mn.us' });
  });

  it('admin can read', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertSucceeds(getDoc(doc(db, 'auditLog/log1')));
  });

  it('teacher cannot read', async () => {
    const db = testEnv.authenticatedContext('a', claims.teacher()).firestore();
    await assertFails(getDoc(doc(db, 'auditLog/log1')));
  });

  it('admin cannot write directly (client-side); only Cloud Functions can', async () => {
    const db = testEnv.authenticatedContext('admin', claims.admin()).firestore();
    await assertFails(setDoc(doc(db, 'auditLog/log2'), { action: 'x' }));
  });
});
