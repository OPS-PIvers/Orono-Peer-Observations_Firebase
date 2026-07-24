import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

type AnyMock = Mock<(...args: unknown[]) => unknown>;

const state = vi.hoisted(() => ({
  getUserByEmail: undefined as AnyMock | undefined,
  setClaims: undefined as AnyMock | undefined,
  sendTemplatedEmail: undefined as AnyMock | undefined,
  roleDoc: undefined as Record<string, unknown> | undefined,
}));

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUserByEmail: state.getUserByEmail,
    setCustomUserClaims: state.setClaims,
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({
      get: () =>
        Promise.resolve({ exists: state.roleDoc !== undefined, data: () => state.roleDoc }),
    }),
  }),
}));

/** An Error carrying a Firebase-style `code`, for auth lookup rejections. */
function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

vi.mock('../lib/emailUtils.js', () => ({
  sendTemplatedEmail: (...args: unknown[]) => state.sendTemplatedEmail?.(...args),
}));

const { handleStaffWritten } = await import('./onStaffWritten.js');

interface StaffAfter {
  role?: string;
  hasAdminAccess?: boolean;
  isActive?: boolean;
  name?: string;
  year?: number;
}

/** Build a Firestore-write event with the shape onStaffWritten reads. */
function makeEvent(opts: { email: string; before?: StaffAfter | null; after?: StaffAfter | null }) {
  const beforeExists = opts.before != null;
  const afterExists = opts.after != null;
  return {
    params: { email: opts.email },
    data: {
      before: { exists: beforeExists, data: () => opts.before ?? undefined },
      after: { exists: afterExists, data: () => opts.after ?? undefined },
    },
  } as never;
}

const invoke = (event: never) =>
  (handleStaffWritten as unknown as (e: never) => Promise<unknown>)(event);

beforeEach(() => {
  state.setClaims = vi.fn().mockResolvedValue(undefined);
  state.sendTemplatedEmail = vi.fn().mockResolvedValue(true);
  state.roleDoc = undefined;
  state.getUserByEmail = vi.fn().mockResolvedValue({ uid: 'uid-1' });
});

describe('onStaffWritten — claim sync', () => {
  it('no-ops when no auth user exists yet (user-not-found)', async () => {
    state.getUserByEmail = vi.fn().mockRejectedValue(authError('auth/user-not-found'));
    await invoke(
      makeEvent({ email: 'new@orono.k12.mn.us', after: { role: 'teacher', isActive: true } }),
    );
    expect(state.setClaims).not.toHaveBeenCalled();
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected auth lookup error', async () => {
    state.getUserByEmail = vi.fn().mockRejectedValue(authError('auth/internal-error'));
    await expect(
      invoke(makeEvent({ email: 'x@orono.k12.mn.us', after: { role: 'teacher' } })),
    ).rejects.toBeTruthy();
  });

  it('syncs admin claims for a full-access role', async () => {
    await invoke(
      makeEvent({
        email: 'boss@orono.k12.mn.us',
        before: { role: 'teacher', isActive: true },
        after: { role: 'full-access', isActive: true },
      }),
    );
    expect(state.setClaims).toHaveBeenCalledWith('uid-1', {
      role: 'full-access',
      hasSpecialAccess: true,
      isAdmin: true,
    });
  });

  it('clears claims (null role) when the staff doc is deleted', async () => {
    await invoke(
      makeEvent({ email: 'gone@orono.k12.mn.us', before: { role: 'teacher' }, after: null }),
    );
    expect(state.setClaims).toHaveBeenCalledWith('uid-1', {
      role: null,
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });
});

describe('onStaffWritten — new-staff invite', () => {
  it('sends an invite for newly created active staff', async () => {
    await invoke(
      makeEvent({
        email: 'fresh@orono.k12.mn.us',
        before: null,
        after: { role: 'teacher', isActive: true, name: 'Fresh Face', year: 2 },
      }),
    );
    expect(state.sendTemplatedEmail).toHaveBeenCalledOnce();
    const arg = state.sendTemplatedEmail?.mock.calls[0]?.[0] as {
      triggerType: string;
      to: string;
      vars: Record<string, string>;
    };
    expect(arg.triggerType).toBe('staff.created');
    expect(arg.to).toBe('fresh@orono.k12.mn.us');
    expect(arg.vars['staffName']).toBe('Fresh Face');
  });

  it('resolves the role slug to a display name for the invite', async () => {
    state.roleDoc = { displayName: 'Peer Evaluator' };
    await invoke(
      makeEvent({
        email: 'pe@orono.k12.mn.us',
        before: null,
        after: { role: 'peer-evaluator', isActive: true },
      }),
    );
    const arg = state.sendTemplatedEmail?.mock.calls[0]?.[0] as { vars: Record<string, string> };
    expect(arg.vars['staffRole']).toBe('Peer Evaluator');
  });

  it('does not invite newly created but inactive staff', async () => {
    await invoke(
      makeEvent({
        email: 'inactive@orono.k12.mn.us',
        before: null,
        after: { role: 'teacher', isActive: false },
      }),
    );
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('does not invite on an update to existing staff', async () => {
    await invoke(
      makeEvent({
        email: 'existing@orono.k12.mn.us',
        before: { role: 'teacher', isActive: true },
        after: { role: 'peer-evaluator', isActive: true },
      }),
    );
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('does not fail the trigger when the invite email throws', async () => {
    state.sendTemplatedEmail = vi.fn().mockRejectedValue(new Error('mail queue down'));
    await expect(
      invoke(
        makeEvent({
          email: 'fresh@orono.k12.mn.us',
          before: null,
          after: { role: 'teacher', isActive: true },
        }),
      ),
    ).resolves.not.toThrow();
    expect(state.setClaims).toHaveBeenCalled();
  });
});
