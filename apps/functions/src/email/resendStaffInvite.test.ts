import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Unit tests for the new-staff invite-suppression logic in onStaffWritten,
 * and for the resendStaffInvite callable's input guard helpers.
 *
 * We extract the pure decision logic into helpers here rather than spinning up
 * a full Firebase Admin environment, following the pattern used in
 * sendManualEmail.test.ts.
 */

// ---------------------------------------------------------------------------
// Invite-send logic (mirrored from onStaffWritten.ts)
// ---------------------------------------------------------------------------

/**
 * Whether a staff-created invite should be sent for this doc write.
 * Mirrors the condition in onStaffWritten.ts.
 *
 * `isNewStaff` — true when before=null and after exists (doc creation only)
 * `isActive`   — after.isActive
 *
 * Note: the real handler has no `importedAt` bulk-import suppression — every
 * newly-created active staff doc triggers an invite email regardless of how
 * the doc was written (manual entry or bulk import).
 */
function shouldSendInvite(args: { isNewStaff: boolean; isActive: boolean }): boolean {
  return args.isNewStaff && args.isActive;
}

describe('onStaffWritten — invite suppression', () => {
  it('sends invite for new active staff', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: true })).toBe(true);
  });

  it('does not send invite when staff is inactive', () => {
    expect(shouldSendInvite({ isNewStaff: true, isActive: false })).toBe(false);
  });

  it('does not send invite on an update (not new staff)', () => {
    expect(shouldSendInvite({ isNewStaff: false, isActive: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resendStaffInvite — input validation helpers (extracted for unit testing)
// ---------------------------------------------------------------------------

/** Mirror of the email validation in resendStaffInvite.ts */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

describe('resendStaffInvite — email validation', () => {
  it('accepts a valid email address', () => {
    expect(isValidEmail('teacher@orono.k12.mn.us')).toBe(true);
  });

  it('rejects an email missing @', () => {
    expect(isValidEmail('notanemail')).toBe(false);
  });

  it('rejects a blank string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects a string with only spaces', () => {
    expect(isValidEmail('   ')).toBe(false);
  });

  it('rejects an email with no domain part', () => {
    expect(isValidEmail('teacher@')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resendStaffInvite — authorization (full callable, mocked Firebase Admin)
// ---------------------------------------------------------------------------

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// Hoisted test state the mock factories read from. Keyed by full doc path
// (e.g. "staff/admin@orono.k12.mn.us") so both `db.doc(path)` and
// `db.collection(name).doc(id)` call styles resolve against the same store.
interface TestState {
  docs: Record<string, Record<string, unknown> | undefined>;
  sendTemplatedEmail: ((...args: unknown[]) => unknown) | undefined;
}

const state = vi.hoisted<TestState>(() => ({
  docs: {},
  sendTemplatedEmail: undefined,
}));

vi.mock('firebase-admin/app', () => ({
  getApps: () => [{}],
  initializeApp: vi.fn(),
}));

function makeDocRef(path: string) {
  return {
    get: () =>
      Promise.resolve({
        exists: state.docs[path] !== undefined,
        data: () => state.docs[path],
      }),
  };
}

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => makeDocRef(path),
    collection: (name: string) => ({
      doc: (id: string) => makeDocRef(`${name}/${id}`),
    }),
  }),
}));

vi.mock('../lib/emailUtils.js', () => ({
  sendTemplatedEmail: (...args: unknown[]) => state.sendTemplatedEmail?.(...args),
  staffInviteMailDocId: (email: string, nowMs: number) => `invite-${email}-${String(nowMs)}`,
}));

const { resendStaffInvite } = await import('./resendStaffInvite.js');

const run = (req: Partial<CallableRequest>) =>
  (resendStaffInvite as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

function authedRequest(
  callerEmail: string,
  callerRole: string | undefined,
  data: Record<string, unknown>,
): Partial<CallableRequest> {
  return {
    auth: { uid: 'uid-1', token: { email: callerEmail, role: callerRole } },
    data,
  } as unknown as Partial<CallableRequest>;
}

const TARGET_EMAIL = 'newhire@orono.k12.mn.us';

beforeEach(() => {
  state.docs = {
    [`staff/${TARGET_EMAIL}`]: {
      name: 'New Hire',
      role: 'teacher',
      year: 1,
      isActive: true,
    },
  };
  state.sendTemplatedEmail = vi.fn().mockResolvedValue(true);
});

describe('resendStaffInvite — authorization', () => {
  it('rejects an unauthenticated call', async () => {
    await expect(run({ data: { email: TARGET_EMAIL } })).rejects.toBeInstanceOf(HttpsError);
    await expect(run({ data: { email: TARGET_EMAIL } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects a caller whose token role is not an admin role and who has no hasAdminAccess grant', async () => {
    state.docs['staff/teacher@orono.k12.mn.us'] = {
      name: 'Plain Teacher',
      role: 'teacher',
      hasAdminAccess: false,
      isActive: true,
    };
    await expect(
      run(authedRequest('teacher@orono.k12.mn.us', 'teacher', { email: TARGET_EMAIL })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('allows a caller whose token role is an admin role', async () => {
    const result = await run(
      authedRequest('admin@orono.k12.mn.us', 'administrator', { email: TARGET_EMAIL }),
    );
    expect(result).toEqual({ sent: true });
    expect(state.sendTemplatedEmail).toHaveBeenCalledTimes(1);
  });

  // Regression test: hasAdminAccess-only admins (a non-admin professional
  // role with the hasAdminAccess flag set) previously always got
  // permission-denied here because this callable checked isAdminRole(role)
  // only, never hasAdminAccess or the isAdmin claim — even though
  // syncMyClaims computes isAdmin as `isAdminRole(role) || hasAdminAccess`
  // and RequireAuth gates /admin/* on that same isAdmin claim, so this class
  // of admin can reach the Resend button in the first place.
  it('allows a hasAdminAccess-only admin (non-admin role, hasAdminAccess: true)', async () => {
    state.docs['staff/pe-admin@orono.k12.mn.us'] = {
      name: 'Peer Evaluator Admin',
      role: 'peer-evaluator',
      hasAdminAccess: true,
      isActive: true,
    };
    const result = await run(
      authedRequest('pe-admin@orono.k12.mn.us', 'peer-evaluator', { email: TARGET_EMAIL }),
    );
    expect(result).toEqual({ sent: true });
    expect(state.sendTemplatedEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects a hasAdminAccess-only admin whose live staff doc has since been revoked', async () => {
    state.docs['staff/revoked@orono.k12.mn.us'] = {
      name: 'Revoked Admin',
      role: 'peer-evaluator',
      hasAdminAccess: false,
      isActive: true,
    };
    // Stale token still claims the old role but not admin — the live
    // staff-doc check is what matters, and it now says no.
    await expect(
      run(authedRequest('revoked@orono.k12.mn.us', 'peer-evaluator', { email: TARGET_EMAIL })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });

  it('rejects a caller with no /staff doc at all', async () => {
    await expect(
      run(authedRequest('ghost@orono.k12.mn.us', undefined, { email: TARGET_EMAIL })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendTemplatedEmail).not.toHaveBeenCalled();
  });
});
