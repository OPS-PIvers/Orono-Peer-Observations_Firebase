import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// The live /staff docs the wrapper's archived-caller check reads.
type StaffDocs = Record<string, Record<string, unknown>>;
const live = vi.hoisted(() => {
  const staff: StaffDocs = {};
  return { staff };
});
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      const id = path.split('/')[1] ?? '';
      return {
        get: () => Promise.resolve({ exists: id in live.staff, data: () => live.staff[id] }),
      };
    },
  }),
}));

import { assertDemoEditTarget, onCall } from './callable';

type Handler = (req: { auth?: { token: Record<string, unknown> } }) => unknown;

const demoAuth = {
  token: { email: 'admin@orono.k12.mn.us', demoEditBy: 'viewer@orono.k12.mn.us' },
};
const normalAuth = { token: { email: 'admin@orono.k12.mn.us' } };

function dbWith(staff: Record<string, Record<string, unknown>>) {
  return {
    doc: (path: string) => {
      const id = path.split('/')[1] ?? '';
      return { get: () => Promise.resolve({ exists: id in staff, data: () => staff[id] }) };
    },
  } as never;
}

describe('onCall wrapper', () => {
  beforeEach(() => {
    live.staff = {};
  });

  it('refuses demo-edit sessions by default', async () => {
    const fn = onCall({}, () => 'ran') as unknown as Handler;
    expect(() => fn({ auth: demoAuth })).toThrow(/demo/);
    await expect(fn({ auth: normalAuth })).resolves.toBe('ran');
  });

  it('lets opted-in callables run in demo-edit sessions', async () => {
    const fn = onCall({ allowDemoEdit: true }, () => 'ran') as unknown as Handler;
    await expect(fn({ auth: demoAuth })).resolves.toBe('ran');
  });

  it('refuses an archived caller whose token still says full-access', async () => {
    live.staff['gone@orono.k12.mn.us'] = { role: 'full-access', isActive: false };
    const handler = vi.fn(() => 'ran');
    const fn = onCall({}, handler) as unknown as Handler;
    const auth = {
      token: { email: 'Gone@orono.k12.mn.us', role: 'full-access', isAdmin: true },
    };
    await expect(fn({ auth })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses a demo-edit session whose driver was archived', async () => {
    live.staff['admin@orono.k12.mn.us'] = { role: 'administrator', isActive: true };
    live.staff['viewer@orono.k12.mn.us'] = { isActive: false };
    const fn = onCall({ allowDemoEdit: true }, () => 'ran') as unknown as Handler;
    await expect(fn({ auth: demoAuth })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('lets active, legacy (no isActive) and roster-less callers through', async () => {
    live.staff['active@orono.k12.mn.us'] = { role: 'teacher', isActive: true };
    live.staff['legacy@orono.k12.mn.us'] = { role: 'teacher' };
    const fn = onCall({}, () => 'ran') as unknown as Handler;
    for (const email of ['active', 'legacy', 'nobody']) {
      await expect(fn({ auth: { token: { email: `${email}@orono.k12.mn.us` } } })).resolves.toBe(
        'ran',
      );
    }
    // No auth at all: the handler does its own unauthenticated check.
    expect(fn({})).toBe('ran');
  });

  it('lets an archived caller reach an allowArchived callable (syncMyClaims)', () => {
    live.staff['gone@orono.k12.mn.us'] = { isActive: false };
    const fn = onCall({ allowArchived: true }, () => 'ran') as unknown as Handler;
    expect(fn({ auth: { token: { email: 'gone@orono.k12.mn.us' } } })).toBe('ran');
  });
});

describe('assertDemoEditTarget', () => {
  const db = dbWith({
    'spartan.teacher@orono.k12.mn.us': { isDemo: true },
    'real@orono.k12.mn.us': {},
  });

  it('only lets a demo-edit session reach demo staff', async () => {
    await expect(
      assertDemoEditTarget(db, demoAuth, 'Spartan.Teacher@orono.k12.mn.us'),
    ).resolves.toBeUndefined();
    await expect(assertDemoEditTarget(db, demoAuth, 'real@orono.k12.mn.us')).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('is a no-op outside demo-edit sessions', async () => {
    await expect(
      assertDemoEditTarget(db, normalAuth, 'real@orono.k12.mn.us'),
    ).resolves.toBeUndefined();
  });
});
