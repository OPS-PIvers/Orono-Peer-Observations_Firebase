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
  /** The live /staff doc as a sequence of reads (last one repeats). */
  liveStaff: [] as (object | undefined)[],
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
    doc: (path: string) => ({
      get: () => {
        if (path.startsWith('staff/')) {
          const live = state.liveStaff.length > 1 ? state.liveStaff.shift() : state.liveStaff[0];
          return Promise.resolve({ exists: live !== undefined, data: () => live });
        }
        return Promise.resolve({ exists: state.roleDoc !== undefined, data: () => state.roleDoc });
      },
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
  // By default the live doc matches the event (the in-order case).
  state.liveStaff = [opts.after ?? undefined];
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
  it('skips claims but still sends the invite when no auth user exists yet', async () => {
    state.getUserByEmail = vi.fn().mockRejectedValue(authError('auth/user-not-found'));
    await invoke(
      makeEvent({
        email: 'new@orono.k12.mn.us',
        before: null,
        after: { role: 'teacher', isActive: true },
      }),
    );
    expect(state.setClaims).not.toHaveBeenCalled();
    expect(state.sendTemplatedEmail).toHaveBeenCalledOnce();
    const arg = state.sendTemplatedEmail?.mock.calls[0]?.[0] as { triggerType: string };
    expect(arg.triggerType).toBe('staff.created');
  });

  it('no invite when the auth user does not exist and the doc is an update', async () => {
    state.getUserByEmail = vi.fn().mockRejectedValue(authError('auth/user-not-found'));
    await invoke(
      makeEvent({
        email: 'pending@orono.k12.mn.us',
        before: { role: 'teacher', isActive: true },
        after: { role: 'peer-evaluator', isActive: true },
      }),
    );
    expect(state.setClaims).not.toHaveBeenCalled();
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('no invite for inactive new staff without an auth user', async () => {
    state.getUserByEmail = vi.fn().mockRejectedValue(authError('auth/user-not-found'));
    await invoke(
      makeEvent({
        email: 'dormant@orono.k12.mn.us',
        before: null,
        after: { role: 'teacher', isActive: false },
      }),
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

  it('drops all access when a full-access member is archived (role stays on the doc)', async () => {
    await invoke(
      makeEvent({
        email: 'boss@orono.k12.mn.us',
        before: { role: 'full-access', hasAdminAccess: true, isActive: true },
        after: { role: 'full-access', hasAdminAccess: true, isActive: false },
      }),
    );
    expect(state.setClaims).toHaveBeenCalledWith('uid-1', {
      role: null,
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });

  it('restores claims when an archived member is reactivated', async () => {
    await invoke(
      makeEvent({
        email: 'pe@orono.k12.mn.us',
        before: { role: 'peer-evaluator', isActive: false },
        after: { role: 'peer-evaluator', isActive: true },
      }),
    );
    expect(state.setClaims).toHaveBeenCalledWith('uid-1', {
      role: 'peer-evaluator',
      hasSpecialAccess: true,
      isAdmin: false,
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

describe('onStaffWritten — stale events', () => {
  it('a late pre-demotion event leaves the demoted claims from the live doc', async () => {
    const event = makeEvent({
      email: 'boss@orono.k12.mn.us',
      before: { role: 'full-access', isActive: true },
      after: { role: 'full-access', isActive: true },
    });
    state.liveStaff = [{ role: 'teacher', isActive: true }];
    await invoke(event);
    expect(state.setClaims).toHaveBeenLastCalledWith('uid-1', {
      role: 'teacher',
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });

  it('a late event after the doc was deleted leaves no access', async () => {
    const event = makeEvent({
      email: 'boss@orono.k12.mn.us',
      before: null,
      after: { role: 'full-access', isActive: true },
    });
    state.liveStaff = [undefined];
    await invoke(event);
    expect(state.setClaims).toHaveBeenLastCalledWith('uid-1', {
      role: null,
      hasSpecialAccess: false,
      isAdmin: false,
    });
  });

  it('re-sets claims when the doc is demoted between its read and the write', async () => {
    const event = makeEvent({
      email: 'boss@orono.k12.mn.us',
      after: { role: 'full-access', isActive: true },
    });
    state.liveStaff = [
      { role: 'full-access', isActive: true },
      { role: 'full-access', isActive: false },
    ];
    await invoke(event);
    expect(state.setClaims).toHaveBeenCalledTimes(2);
    expect(state.setClaims).toHaveBeenLastCalledWith('uid-1', {
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

describe('onStaffWritten — non-canonical doc ids', () => {
  it('leaves the real user’s claims alone and sends no invite for a mixed-case doc', async () => {
    await invoke(
      makeEvent({
        email: 'Victim@orono.k12.mn.us',
        before: null,
        after: { role: 'teacher', isActive: true, name: 'Shadow' },
      }),
    );
    expect(state.getUserByEmail).not.toHaveBeenCalled();
    expect(state.setClaims).not.toHaveBeenCalled();
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('does not clear claims when a mixed-case doc is deleted', async () => {
    await invoke(
      makeEvent({ email: 'Victim@orono.k12.mn.us', before: { role: 'teacher' }, after: null }),
    );
    expect(state.setClaims).not.toHaveBeenCalled();
  });

  it('sends no invite to an off-domain doc id', async () => {
    await invoke(
      makeEvent({
        email: 'someone@gmail.com',
        before: null,
        after: { role: 'teacher', isActive: true, name: 'Outsider' },
      }),
    );
    expect(state.setClaims).not.toHaveBeenCalled();
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });
});
