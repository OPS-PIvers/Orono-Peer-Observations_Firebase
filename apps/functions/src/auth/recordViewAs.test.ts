import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
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

import { handleRecordViewAs } from './recordViewAs';

function makeDb(staff: Record<string, unknown> | null) {
  const added: unknown[] = [];
  const db = {
    doc: () => ({ get: () => Promise.resolve({ exists: staff !== null, data: () => staff }) }),
    collection: () => ({
      add: (d: unknown) => {
        added.push(d);
        return Promise.resolve();
      },
    }),
  };
  return { db: db as never, added };
}

const caller = (token: Record<string, unknown>) => ({
  token: { email: 'Viewer@orono.k12.mn.us', ...token },
});

describe('handleRecordViewAs', () => {
  it('logs a view-as start for someone granted View As', async () => {
    const { db, added } = makeDb({ canViewAs: true, isActive: true });
    await handleRecordViewAs(db, caller({ role: 'teacher' }), { email: 'Erin@orono.k12.mn.us' });
    expect(added).toEqual([
      expect.objectContaining({
        userEmail: 'viewer@orono.k12.mn.us',
        action: 'view_as_started',
        target: 'staff/erin@orono.k12.mn.us',
      }),
    ]);
  });

  it('allows the developer escape hatch (isAdmin without a special role)', async () => {
    const { db, added } = makeDb({ canViewAs: false });
    await handleRecordViewAs(db, caller({ role: 'teacher', isAdmin: true }), { email: 'a@b.org' });
    expect(added).toHaveLength(1);
  });

  it('refuses everyone else, including archived grantees', async () => {
    await expect(
      handleRecordViewAs(makeDb({ canViewAs: true, isActive: false }).db, caller({}), {
        email: 'a@b.org',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(
      handleRecordViewAs(makeDb(null).db, caller({ role: 'peer-evaluator', isAdmin: true }), {
        email: 'a@b.org',
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
