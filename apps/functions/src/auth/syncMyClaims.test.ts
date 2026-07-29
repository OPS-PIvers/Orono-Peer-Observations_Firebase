import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// Hoisted test state the mock factories read from.
const state = vi.hoisted(() => ({
  staffData: undefined as Record<string, unknown> | undefined,
  setClaims: undefined as ReturnType<typeof vi.fn> | undefined,
  updateStaff: undefined as ((patch: Record<string, unknown>) => Promise<void>) | undefined,
}));

const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' };

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({ setCustomUserClaims: state.setClaims }),
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP },
  getFirestore: () => ({
    doc: () => ({
      get: () =>
        Promise.resolve({ exists: state.staffData !== undefined, data: () => state.staffData }),
      update: (patch: Record<string, unknown>) => state.updateStaff?.(patch),
    }),
  }),
}));

const { syncMyClaims } = await import('./syncMyClaims.js');

// The callable's underlying handler, invoked directly for unit testing.
const run = (req: Partial<CallableRequest>) =>
  (syncMyClaims as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

function authedRequest(email: string, uid = 'uid-1'): Partial<CallableRequest> {
  return { auth: { uid, token: { email } } } as unknown as Partial<CallableRequest>;
}

beforeEach(() => {
  state.staffData = undefined;
  state.setClaims = vi.fn().mockResolvedValue(undefined);
  state.updateStaff = vi.fn().mockResolvedValue(undefined);
});

describe('syncMyClaims', () => {
  it('rejects an unauthenticated call', async () => {
    await expect(run({})).rejects.toBeInstanceOf(HttpsError);
    await expect(run({})).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a non-Orono-domain account', async () => {
    await expect(run(authedRequest('outsider@gmail.com'))).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(state.setClaims).not.toHaveBeenCalled();
  });

  it('issues null/false claims when no staff doc exists', async () => {
    state.staffData = undefined;
    const result = await run(authedRequest('nobody@orono.k12.mn.us'));
    expect(result).toEqual({ role: null, hasSpecialAccess: false, isAdmin: false });
    expect(state.setClaims).toHaveBeenCalledWith('uid-1', {
      role: null,
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });

  it('grants admin + special access for an administrator role', async () => {
    state.staffData = { role: 'administrator' };
    const result = await run(authedRequest('boss@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'administrator', hasSpecialAccess: true, isAdmin: true });
  });

  it('grants special (non-admin) access for a peer-evaluator role', async () => {
    state.staffData = { role: 'peer-evaluator' };
    const result = await run(authedRequest('pe@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'peer-evaluator', hasSpecialAccess: true, isAdmin: false });
  });

  it('grants admin via the hasAdminAccess flag even for a plain role', async () => {
    state.staffData = { role: 'teacher', hasAdminAccess: true };
    const result = await run(authedRequest('t@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'teacher', hasSpecialAccess: true, isAdmin: true });
  });

  it('gives a plain teacher no elevated access', async () => {
    state.staffData = { role: 'teacher' };
    const result = await run(authedRequest('t@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'teacher', hasSpecialAccess: false, isAdmin: false });
  });

  it('lower-cases the token email before the domain check', async () => {
    state.staffData = { role: 'teacher' };
    await expect(run(authedRequest('Mixed.Case@ORONO.K12.MN.US'))).resolves.toBeTruthy();
  });

  it('stamps lastSignInAt on the staff doc', async () => {
    state.staffData = { role: 'teacher' };
    await run(authedRequest('t@orono.k12.mn.us'));
    expect(state.updateStaff).toHaveBeenCalledWith({ lastSignInAt: SERVER_TIMESTAMP });
  });

  it('does not stamp lastSignInAt when no staff doc exists', async () => {
    state.staffData = undefined;
    await run(authedRequest('nobody@orono.k12.mn.us'));
    expect(state.updateStaff).not.toHaveBeenCalled();
  });

  it('still returns claims when the lastSignInAt stamp fails', async () => {
    state.staffData = { role: 'teacher' };
    state.updateStaff = vi.fn().mockRejectedValue(new Error('firestore unavailable'));
    const result = await run(authedRequest('t@orono.k12.mn.us'));
    expect(result).toEqual({ role: 'teacher', hasSpecialAccess: false, isAdmin: false });
  });
});
