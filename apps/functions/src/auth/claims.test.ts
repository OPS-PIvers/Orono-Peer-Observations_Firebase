import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behavior tests for the two claim-sync paths (onStaffWritten trigger and
 * syncMyClaims callable) with firebase-admin mocked out. Pins the
 * access-revocation contract: archiving a staff member (isActive → false)
 * collapses their claims on both paths, and the trigger additionally
 * revokes refresh tokens when elevated access is removed. Also pins the
 * /roles doc contract: a custom role's isSpecialAccess flag extends the
 * hasSpecialAccess claim (built-in SPECIAL_ROLES stay a floor; isAdmin is
 * never granted via the flag).
 */
interface FakeDocSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

const mocks = vi.hoisted(() => {
  // Satisfy the Firebase Functions param resolver before module-level
  // function definitions fire at import time (see index.test.ts).
  process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
  process.env['GCLOUD_PROJECT'] = 'test';
  return {
    getUserByEmail: vi.fn(),
    setCustomUserClaims: vi.fn(),
    revokeRefreshTokens: vi.fn(),
    docGet: vi.fn<(path: string) => Promise<FakeDocSnap>>(),
    sendTemplatedEmail: vi.fn(),
  };
});

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUserByEmail: mocks.getUserByEmail,
    setCustomUserClaims: mocks.setCustomUserClaims,
    revokeRefreshTokens: mocks.revokeRefreshTokens,
  }),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: (path: string) => ({ get: () => mocks.docGet(path) }) }),
}));
vi.mock('../lib/emailUtils.js', () => ({
  sendTemplatedEmail: mocks.sendTemplatedEmail,
  staffInviteMailDocId: (email: string, ts: number) => `staff-invite-${email}-${ts}`,
}));

import { onStaffWritten } from './onStaffWritten.js';
import { syncMyClaims } from './syncMyClaims.js';

const NO_ACCESS = { role: null, hasSpecialAccess: false, isAdmin: false };
const UID = 'uid-1';

type StaffDoc = Record<string, unknown>;

function makeStaffEvent(
  before: StaffDoc | null,
  after: StaffDoc | null,
  email = 'pe@orono.k12.mn.us',
): Parameters<typeof onStaffWritten.run>[0] {
  const snap = (data: StaffDoc | null) => ({
    exists: data !== null,
    data: () => data ?? undefined,
  });
  return {
    params: { email },
    data: { before: snap(before), after: snap(after) },
  } as unknown as Parameters<typeof onStaffWritten.run>[0];
}

function makeCallableRequest(email: string): Parameters<typeof syncMyClaims.run>[0] {
  return {
    auth: { uid: UID, token: { email } },
    data: {},
  } as unknown as Parameters<typeof syncMyClaims.run>[0];
}

/** Routes docGet by path (e.g. 'staff/x@…', 'roles/teacher'); unlisted paths read as missing. */
function mockDocs(docs: Record<string, Record<string, unknown>>) {
  mocks.docGet.mockImplementation((path) =>
    Promise.resolve(
      path in docs
        ? { exists: true, data: () => docs[path] }
        : { exists: false, data: () => undefined },
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserByEmail.mockResolvedValue({ uid: UID });
  mocks.docGet.mockResolvedValue({ exists: false, data: () => undefined });
  mocks.sendTemplatedEmail.mockResolvedValue(undefined);
});

describe('onStaffWritten', () => {
  it('collapses claims and revokes refresh tokens when a Peer Evaluator is archived', async () => {
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'peer-evaluator', isActive: true },
        { role: 'peer-evaluator', isActive: false },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
    expect(mocks.revokeRefreshTokens).toHaveBeenCalledWith(UID);
  });

  it('collapses claims and revokes refresh tokens when a hasAdminAccess staff member is archived', async () => {
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'teacher', hasAdminAccess: true, isActive: true },
        { role: 'teacher', hasAdminAccess: true, isActive: false },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
    expect(mocks.revokeRefreshTokens).toHaveBeenCalledWith(UID);
  });

  it('clears claims and revokes refresh tokens when a special-access staff doc is deleted', async () => {
    await onStaffWritten.run(makeStaffEvent({ role: 'administrator', isActive: true }, null));
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
    expect(mocks.revokeRefreshTokens).toHaveBeenCalledWith(UID);
  });

  it('sets elevated claims without revoking on a promotion (teacher → Peer Evaluator)', async () => {
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'teacher', isActive: true },
        { role: 'peer-evaluator', isActive: true },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, {
      role: 'peer-evaluator',
      hasSpecialAccess: true,
      isAdmin: false,
    });
    expect(mocks.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('collapses claims without revoking when a plain teacher is archived', async () => {
    await onStaffWritten.run(
      makeStaffEvent({ role: 'teacher', isActive: true }, { role: 'teacher', isActive: false }),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
    expect(mocks.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('no-ops when the auth user does not exist yet', async () => {
    mocks.getUserByEmail.mockRejectedValue(
      Object.assign(new Error('no user'), { code: 'auth/user-not-found' }),
    );
    await onStaffWritten.run(
      makeStaffEvent(null, { role: 'peer-evaluator', isActive: true }, 'new@orono.k12.mn.us'),
    );
    expect(mocks.setCustomUserClaims).not.toHaveBeenCalled();
    expect(mocks.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('grants special access (but not admin) via the role doc for a custom special-access role', async () => {
    mockDocs({ 'roles/instructional-coach': { isSpecialAccess: true, isActive: true } });
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'teacher', isActive: true },
        { role: 'instructional-coach', isActive: true },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, {
      role: 'instructional-coach',
      hasSpecialAccess: true,
      isAdmin: false,
    });
    expect(mocks.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it('collapses claims and revokes refresh tokens when a custom special-access staff member is archived', async () => {
    mockDocs({ 'roles/instructional-coach': { isSpecialAccess: true, isActive: true } });
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'instructional-coach', isActive: true },
        { role: 'instructional-coach', isActive: false },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
    expect(mocks.revokeRefreshTokens).toHaveBeenCalledWith(UID);
  });

  it('keeps special access for a built-in role even when its role doc unsets isSpecialAccess', async () => {
    mockDocs({ 'roles/peer-evaluator': { isSpecialAccess: false, isActive: true } });
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'teacher', isActive: true },
        { role: 'peer-evaluator', isActive: true },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, {
      role: 'peer-evaluator',
      hasSpecialAccess: true,
      isAdmin: false,
    });
  });

  it('ignores isSpecialAccess on an inactive role doc', async () => {
    mockDocs({ 'roles/instructional-coach': { isSpecialAccess: true, isActive: false } });
    await onStaffWritten.run(
      makeStaffEvent(
        { role: 'teacher', isActive: true },
        { role: 'instructional-coach', isActive: true },
      ),
    );
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, {
      role: 'instructional-coach',
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });
});

describe('syncMyClaims', () => {
  it('issues no-access claims for an archived staff member', async () => {
    mocks.docGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'peer-evaluator', isActive: false }),
    });
    const result = await syncMyClaims.run(makeCallableRequest('archived@orono.k12.mn.us'));
    expect(result).toEqual(NO_ACCESS);
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
  });

  it('issues elevated claims for an active Peer Evaluator', async () => {
    mocks.docGet.mockResolvedValue({
      exists: true,
      data: () => ({ role: 'peer-evaluator', isActive: true }),
    });
    const result = await syncMyClaims.run(makeCallableRequest('pe@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'peer-evaluator', hasSpecialAccess: true, isAdmin: false });
  });

  it('issues no-access claims when no staff doc exists', async () => {
    const result = await syncMyClaims.run(makeCallableRequest('unknown@orono.k12.mn.us'));
    expect(result).toEqual(NO_ACCESS);
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, NO_ACCESS);
  });

  it('grants special access (but not admin) when the role doc has isSpecialAccess', async () => {
    mockDocs({
      'staff/coach@orono.k12.mn.us': { role: 'instructional-coach', isActive: true },
      'roles/instructional-coach': { isSpecialAccess: true, isActive: true },
    });
    const result = await syncMyClaims.run(makeCallableRequest('coach@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'instructional-coach', hasSpecialAccess: true, isAdmin: false });
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith(UID, {
      role: 'instructional-coach',
      hasSpecialAccess: true,
      isAdmin: false,
    });
  });

  it('does not grant special access when the role doc leaves isSpecialAccess unset', async () => {
    mockDocs({
      'staff/teacher@orono.k12.mn.us': { role: 'teacher', isActive: true },
      'roles/teacher': { isSpecialAccess: false, isActive: true },
    });
    const result = await syncMyClaims.run(makeCallableRequest('teacher@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'teacher', hasSpecialAccess: false, isAdmin: false });
  });
});
