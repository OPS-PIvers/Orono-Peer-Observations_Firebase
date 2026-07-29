import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';

/**
 * Authorization regression tests for sendManualEmail — see INTEG-AUTHZ.
 *
 * Before the fix, this callable computed its "PE or admin" check from the
 * token's `role` claim only (isSpecialRole(role) || isAdminRole(role)),
 * ignoring `hasAdminAccess`. A Teacher-role staff member granted
 * `hasAdminAccess: true` can reach /admin/staff (RequireAuth gates on the
 * `isAdmin` claim, which syncMyClaims computes as `isAdminRole(role) ||
 * hasAdminAccess`), so that user class hit a deterministic permission-denied
 * here despite being fully supported. The fix delegates to the shared
 * `callerMeetsAccessLevel` helper (../lib/callerAccess.ts), which also backs
 * sendBulkManualEmail.ts and resendStaffInvite.ts.
 */

process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

interface TestState {
  docs: Record<string, Record<string, unknown> | undefined>;
  sendEmail: ((...args: unknown[]) => unknown) | undefined;
}

const state = vi.hoisted<TestState>(() => ({
  docs: {},
  sendEmail: undefined,
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
  sendEmail: (...args: unknown[]) => state.sendEmail?.(...args),
  substituteVariables: (template: string) => template,
}));

const { sendManualEmail } = await import('./sendManualEmail.js');

const run = (req: Partial<CallableRequest>) =>
  (sendManualEmail as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

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

const TEMPLATE_ID = 'welcome-note';
const TARGET_EMAIL = 'someone@orono.k12.mn.us';

beforeEach(() => {
  state.docs = {
    [`emailTemplates/${TEMPLATE_ID}`]: {
      templateId: TEMPLATE_ID,
      name: 'Welcome note',
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
      triggerType: 'manual',
      isActive: true,
    },
  };
  state.sendEmail = vi.fn().mockResolvedValue({ queued: true });
});

describe('sendManualEmail — authorization', () => {
  it('rejects an unauthenticated call', async () => {
    await expect(
      run({ data: { templateId: TEMPLATE_ID, toEmail: TARGET_EMAIL } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('allows a caller whose token role is an admin role', async () => {
    const result = await run(
      authedRequest('admin@orono.k12.mn.us', 'administrator', {
        templateId: TEMPLATE_ID,
        toEmail: TARGET_EMAIL,
      }),
    );
    expect(result).toMatchObject({ sent: true });
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  // Regression: hasAdminAccess-only callers (non-special role, hasAdminAccess:
  // true on the live /staff doc) previously always got permission-denied here.
  it('allows a hasAdminAccess-only caller (non-special role, hasAdminAccess: true)', async () => {
    state.docs['staff/teacher-admin@orono.k12.mn.us'] = {
      name: 'Teacher Admin',
      role: 'teacher',
      hasAdminAccess: true,
      isActive: true,
    };
    const result = await run(
      authedRequest('teacher-admin@orono.k12.mn.us', 'teacher', {
        templateId: TEMPLATE_ID,
        toEmail: TARGET_EMAIL,
      }),
    );
    expect(result).toMatchObject({ sent: true });
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects a hasAdminAccess-only caller whose live staff doc has since been revoked', async () => {
    state.docs['staff/revoked@orono.k12.mn.us'] = {
      name: 'Revoked Admin',
      role: 'teacher',
      hasAdminAccess: false,
      isActive: true,
    };
    await expect(
      run(
        authedRequest('revoked@orono.k12.mn.us', 'teacher', {
          templateId: TEMPLATE_ID,
          toEmail: TARGET_EMAIL,
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a plain non-admin, non-PE caller with no /staff doc', async () => {
    await expect(
      run(
        authedRequest('teacher@orono.k12.mn.us', 'teacher', {
          templateId: TEMPLATE_ID,
          toEmail: TARGET_EMAIL,
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('allows a caller whose token role is a special (PE) role', async () => {
    const result = await run(
      authedRequest('pe@orono.k12.mn.us', 'peer-evaluator', {
        templateId: TEMPLATE_ID,
        toEmail: TARGET_EMAIL,
      }),
    );
    expect(result).toMatchObject({ sent: true });
  });
});
