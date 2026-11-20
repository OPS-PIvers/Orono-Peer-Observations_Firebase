import { describe, expect, it, vi, beforeEach } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

const state = vi.hoisted(() => ({
  staff: new Map<string, Record<string, unknown>>(),
  users: [] as { uid: string; email?: string; customClaims?: Record<string, unknown> }[],
  setClaims: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    listUsers: () => Promise.resolve({ users: state.users, pageToken: undefined }),
    setCustomUserClaims: state.setClaims,
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: () => ({
      get: () =>
        Promise.resolve({
          docs: [...state.staff.entries()].map(([id, data]) => ({ id, data: () => data })),
        }),
    }),
    doc: (path: string) => ({
      get: () => {
        const data = state.staff.get(path.replace(/^staff\//, ''));
        return Promise.resolve({ exists: data !== undefined, data: () => data });
      },
    }),
  }),
}));

const { reconcileAllStaffClaims } = await import('./reconcileStaffClaims.js');

const NONE = { role: null, hasSpecialAccess: false, isAdmin: false };

beforeEach(() => {
  state.staff = new Map();
  state.users = [];
  state.setClaims = vi.fn().mockResolvedValue(undefined);
});

describe('reconcileAllStaffClaims', () => {
  it('strips stale full-access claims from a demoted user', async () => {
    state.staff.set('ann@orono.k12.mn.us', { role: 'teacher', isActive: true });
    state.users = [
      {
        uid: 'u1',
        email: 'ann@orono.k12.mn.us',
        customClaims: { role: 'full-access', hasSpecialAccess: true, isAdmin: true },
      },
    ];
    const result = await reconcileAllStaffClaims();
    expect(state.setClaims).toHaveBeenCalledWith('u1', {
      role: 'teacher',
      hasSpecialAccess: false,
      isAdmin: false,
    });
    expect(result).toEqual({ checked: 1, fixed: 1, failed: 0 });
  });

  it('strips claims when the staff doc was deleted', async () => {
    state.users = [
      {
        uid: 'u1',
        email: 'Gone@orono.k12.mn.us',
        customClaims: { role: 'peer-evaluator', hasSpecialAccess: true, isAdmin: false },
      },
    ];
    await reconcileAllStaffClaims();
    expect(state.setClaims).toHaveBeenCalledWith('u1', NONE);
  });

  it('strips claims from an archived user', async () => {
    state.staff.set('pe@orono.k12.mn.us', { role: 'peer-evaluator', isActive: false });
    state.users = [
      {
        uid: 'u1',
        email: 'pe@orono.k12.mn.us',
        customClaims: { role: 'peer-evaluator', hasSpecialAccess: true, isAdmin: false },
      },
    ];
    await reconcileAllStaffClaims();
    expect(state.setClaims).toHaveBeenCalledWith('u1', NONE);
  });

  it('strips claims from an off-domain account', async () => {
    state.users = [
      { uid: 'u1', email: 'x@gmail.com', customClaims: { role: 'full-access', isAdmin: true } },
    ];
    await reconcileAllStaffClaims();
    expect(state.setClaims).toHaveBeenCalledWith('u1', NONE);
  });

  it('leaves matching and claimless no-access users untouched', async () => {
    state.staff.set('t@orono.k12.mn.us', { role: 'teacher', isActive: true });
    state.users = [
      {
        uid: 'u1',
        email: 't@orono.k12.mn.us',
        customClaims: { role: 'teacher', hasSpecialAccess: false, isAdmin: false },
      },
      { uid: 'u2', email: 'nobody@orono.k12.mn.us' },
    ];
    const result = await reconcileAllStaffClaims();
    expect(state.setClaims).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 2, fixed: 0, failed: 0 });
  });

  it('settles on a malformed doc instead of rewriting it every run', async () => {
    state.staff.set('m@orono.k12.mn.us', { role: 'teacher', hasAdminAccess: 'true' });
    state.users = [
      {
        uid: 'u1',
        email: 'm@orono.k12.mn.us',
        customClaims: { role: 'teacher', hasSpecialAccess: false, isAdmin: false },
      },
    ];
    await reconcileAllStaffClaims();
    expect(state.setClaims).not.toHaveBeenCalled();
  });

  it('keeps going when one user fails', async () => {
    state.setClaims = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    state.users = [
      { uid: 'u1', email: 'a@orono.k12.mn.us', customClaims: { role: 'full-access' } },
      { uid: 'u2', email: 'b@orono.k12.mn.us', customClaims: { role: 'full-access' } },
    ];
    const result = await reconcileAllStaffClaims();
    expect(result).toEqual({ checked: 2, fixed: 1, failed: 1 });
    expect(state.setClaims).toHaveBeenLastCalledWith('u2', NONE);
  });
});
