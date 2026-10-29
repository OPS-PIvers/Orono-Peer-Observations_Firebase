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
  checkRateLimit: ((...args: unknown[]) => unknown) | undefined;
}

const state = vi.hoisted<TestState>(() => ({
  docs: {},
  sendEmail: undefined,
  checkRateLimit: undefined,
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
      // resolveRole's legacy displayName fallback; no test relies on it.
      where: () => ({ limit: () => ({ get: () => Promise.resolve({ docs: [] }) }) }),
    }),
  }),
}));

vi.mock('../lib/emailUtils.js', () => ({
  sendEmail: (...args: unknown[]) => state.sendEmail?.(...args),
  // Plain {{var}} substitution, so tests can see which values won.
  substituteVariables: (template: string, vars: Record<string, string | undefined>) =>
    template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? ''),
  APP_URL: 'https://app.test',
}));

vi.mock('../lib/rateLimit.js', () => ({
  RATE_LIMIT_KEYS: { manualEmail: 'manualEmail' },
  checkRateLimit: (...args: unknown[]) => state.checkRateLimit?.(...args),
  loadRateLimits: () => Promise.resolve({ manualEmailsPerHour: 30 }),
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
    [`staff/${TARGET_EMAIL}`]: { name: 'Some One', role: 'teacher', year: 2, isActive: true },
  };
  state.sendEmail = vi.fn().mockResolvedValue({ queued: true });
  state.checkRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 29, resetAtMs: 0 });
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

// ---------------------------------------------------------------------------
// Recipient allow-list and rate limit. Regression coverage for the finding
// that any PE or building Administrator could make the district sender mail
// any active manual template to any external address, unthrottled.
// ---------------------------------------------------------------------------

const EXTERNAL = 'victim@example.com';
const PE = 'pe@orono.k12.mn.us';
const CONSOLE_ADMIN = 'console@orono.k12.mn.us';

describe('sendManualEmail — recipient allow-list', () => {
  it('refuses an external address from a peer evaluator and charges no slot', async () => {
    await expect(
      run(authedRequest(PE, 'peer-evaluator', { templateId: TEMPLATE_ID, toEmail: EXTERNAL })),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
    expect(state.checkRateLimit).not.toHaveBeenCalled();
  });

  it('refuses an external address from a building Administrator (not console tier)', async () => {
    await expect(
      run(
        authedRequest('principal@orono.k12.mn.us', 'administrator', {
          templateId: TEMPLATE_ID,
          toEmail: EXTERNAL,
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('refuses an archived staff member from a peer evaluator', async () => {
    state.docs['staff/retired@orono.k12.mn.us'] = { name: 'Re Tired', isActive: false };
    await expect(
      run(
        authedRequest(PE, 'peer-evaluator', {
          templateId: TEMPLATE_ID,
          toEmail: 'retired@orono.k12.mn.us',
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('matches the roster case-insensitively', async () => {
    const result = await run(
      authedRequest(PE, 'peer-evaluator', {
        templateId: TEMPLATE_ID,
        toEmail: 'SomeOne@Orono.K12.MN.US',
      }),
    );
    expect(result).toMatchObject({ sent: true });
  });

  it('lets a console admin send a test to any address', async () => {
    const result = await run(
      authedRequest(CONSOLE_ADMIN, 'full-access', { templateId: TEMPLATE_ID, toEmail: EXTERNAL }),
    );
    expect(result).toMatchObject({ sent: true });
    expect(state.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: EXTERNAL }));
  });
});

describe('sendManualEmail — rate limit', () => {
  it('returns resource-exhausted and writes no mail once the caller is over the limit', async () => {
    state.checkRateLimit = vi
      .fn()
      .mockResolvedValue({ allowed: false, remaining: 0, resetAtMs: 0 });
    await expect(
      run(authedRequest(PE, 'peer-evaluator', { templateId: TEMPLATE_ID, toEmail: TARGET_EMAIL })),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('charges the caller once per valid send, keyed to their lowercased email', async () => {
    await run(
      authedRequest('PE@Orono.K12.MN.US', 'peer-evaluator', {
        templateId: TEMPLATE_ID,
        toEmail: TARGET_EMAIL,
      }),
    );
    expect(state.checkRateLimit).toHaveBeenCalledTimes(1);
    expect(state.checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userEmail: PE, key: 'manualEmail', max: 30 }),
    );
  });

  it('applies to console admins too', async () => {
    state.checkRateLimit = vi
      .fn()
      .mockResolvedValue({ allowed: false, remaining: 0, resetAtMs: 0 });
    await expect(
      run(
        authedRequest(CONSOLE_ADMIN, 'full-access', { templateId: TEMPLATE_ID, toEmail: EXTERNAL }),
      ),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('does not charge a slot for an inactive template', async () => {
    state.docs[`emailTemplates/${TEMPLATE_ID}`] = {
      ...state.docs[`emailTemplates/${TEMPLATE_ID}`],
      isActive: false,
    };
    await expect(
      run(authedRequest(PE, 'peer-evaluator', { templateId: TEMPLATE_ID, toEmail: TARGET_EMAIL })),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.checkRateLimit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Template variables. Regression coverage for the finding that a caller's
// `vars` (spread last) replaced the server signupLink, signInLink and
// appName, and that observer/observed names were taken from the client.
// ---------------------------------------------------------------------------

describe('sendManualEmail — template variables', () => {
  const SPOOFED = {
    signupLink: 'https://attacker.example/sso',
    signInLink: 'https://attacker.example/in',
    appName: 'Urgent: password expired',
    observerName: 'IT Help Desk',
    observedName: 'Someone Else',
    observedRole: 'Superintendent',
  };

  beforeEach(() => {
    state.docs[`emailTemplates/${TEMPLATE_ID}`] = {
      templateId: TEMPLATE_ID,
      subject: 'Sign up — {{appName}}',
      bodyHtml:
        '<p>Hi {{observedName}} ({{observedRole}}, year {{observedYear}})</p>' +
        '<a href="{{signupLink}}">Sign up</a><a href="{{signInLink}}">In</a>' +
        '<p>From {{observerName}} &lt;{{observerEmail}}&gt;</p><p>{{observationDate}}</p>',
      triggerType: 'manual',
      isActive: true,
    };
    state.docs['appSettings/global'] = {
      branding: { appName: 'Orono Peer Observations' },
      signupLink: 'https://calendar.example/orono-signup',
    };
    state.docs[`staff/${PE}`] = { name: 'Pat Evaluator', role: 'peer-evaluator', isActive: true };
    state.docs['roles/teacher'] = { roleId: 'teacher', displayName: 'Teacher' };
  });

  const sentMail = () =>
    (state.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      subject: string;
      html: string;
    };

  it("ignores a peer evaluator's vars and uses server and /staff values", async () => {
    await run(
      authedRequest(PE, 'peer-evaluator', {
        templateId: TEMPLATE_ID,
        toEmail: TARGET_EMAIL,
        vars: { ...SPOOFED, observationDate: 'tomorrow' },
      }),
    );
    const mail = sentMail();
    expect(mail.subject).toBe('Sign up — Orono Peer Observations');
    expect(mail.html).toContain('href="https://calendar.example/orono-signup"');
    expect(mail.html).toContain('href="https://app.test"');
    expect(mail.html).toContain('Hi Some One (Teacher, year 2)');
    expect(mail.html).toContain(`From Pat Evaluator &lt;${PE}&gt;`);
    expect(mail.html).not.toContain('attacker.example');
    expect(mail.html).not.toContain('IT Help Desk');
    expect(mail.html).not.toContain('tomorrow');
  });

  it("keeps a console admin's sample vars for a test send, but never server-owned ones", async () => {
    await run(
      authedRequest(CONSOLE_ADMIN, 'full-access', {
        templateId: TEMPLATE_ID,
        toEmail: EXTERNAL,
        vars: { ...SPOOFED, observationDate: 'May 20, 2026', notAKnownVar: 'x' },
      }),
    );
    const mail = sentMail();
    expect(mail.subject).toBe('Sign up — Orono Peer Observations');
    expect(mail.html).toContain('href="https://calendar.example/orono-signup"');
    expect(mail.html).toContain('href="https://app.test"');
    expect(mail.html).not.toContain('attacker.example');
    // No /staff doc for the external address, so the samples fill the
    // recipient variables; the sender is still the real caller.
    expect(mail.html).toContain('Hi Someone Else (Superintendent');
    expect(mail.html).toContain(`&lt;${CONSOLE_ADMIN}&gt;`);
    expect(mail.html).not.toContain('IT Help Desk');
    expect(mail.html).toContain('<p>May 20, 2026</p>');
  });
});
