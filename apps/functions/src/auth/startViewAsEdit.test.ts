import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts' },
  getFirestore: vi.fn(),
}));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  onCall: (_opts: unknown, fn: unknown) => fn,
}));

import { handleStartViewAsEdit } from './startViewAsEdit';

const VIEWER = 'viewer@orono.k12.mn.us';
const ERIN = 'erin@orono.k12.mn.us';

function setup(docs: Record<string, Record<string, unknown>>) {
  const added: unknown[] = [];
  const db = {
    doc: (path: string) => {
      const id = path.split('/')[1] ?? '';
      return { get: () => Promise.resolve({ exists: id in docs, data: () => docs[id] }) };
    },
    collection: () => ({
      add: (d: unknown) => {
        added.push(d);
        return Promise.resolve();
      },
    }),
  };
  const createCustomToken = vi.fn(() => Promise.resolve('custom-token'));
  const auth = { getUserByEmail: () => Promise.resolve({ uid: 'erin-uid' }), createCustomToken };
  return { db: db as never, auth: auth as never, added, createCustomToken };
}

const caller = (extra: Record<string, unknown> = {}) => ({ token: { email: VIEWER, ...extra } });
const granted = { [VIEWER]: { canViewAsEdit: true, isActive: true } };

describe('handleStartViewAsEdit', () => {
  it('mints a demo-edit token for a demo Administrator and audit-logs it', async () => {
    const { db, auth, added, createCustomToken } = setup({
      ...granted,
      [ERIN]: { role: 'administrator', isActive: true, isDemo: true },
    });
    await expect(handleStartViewAsEdit(db, auth, caller(), { email: ERIN })).resolves.toEqual({
      token: 'custom-token',
    });
    expect(createCustomToken).toHaveBeenCalledWith('erin-uid', { demoEditBy: VIEWER });
    expect(added).toEqual([expect.objectContaining({ action: 'view_as_edit_started' })]);
  });

  it('refuses without the grant', async () => {
    const { db, auth } = setup({
      [VIEWER]: { canViewAs: true },
      [ERIN]: { role: 'administrator' },
    });
    await expect(handleStartViewAsEdit(db, auth, caller(), { email: ERIN })).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('only signs in as Administrators or Peer Evaluators', async () => {
    for (const target of [
      { role: 'full-access', isDemo: true },
      { role: 'teacher', isDemo: true },
    ]) {
      const { db, auth } = setup({ ...granted, [ERIN]: target });
      await expect(
        handleStartViewAsEdit(db, auth, caller(), { email: ERIN }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('never signs in as a real (non-demo) Administrator or Peer Evaluator', async () => {
    for (const target of [
      { role: 'administrator', isActive: true },
      { role: 'administrator', hasAdminAccess: true, isActive: true },
      { role: 'peer-evaluator', isActive: true, isDemo: false },
    ]) {
      const { db, auth, added, createCustomToken } = setup({ ...granted, [ERIN]: target });
      await expect(
        handleStartViewAsEdit(db, auth, caller(), { email: ERIN }),
      ).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(createCustomToken).not.toHaveBeenCalled();
      expect(added).toEqual([]);
    }
  });

  it('cannot be chained from inside a demo-edit session', async () => {
    const { db, auth } = setup({ ...granted, [ERIN]: { role: 'administrator', isDemo: true } });
    await expect(
      handleStartViewAsEdit(db, auth, caller({ demoEditBy: 'x@orono.k12.mn.us' }), {
        email: ERIN,
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
