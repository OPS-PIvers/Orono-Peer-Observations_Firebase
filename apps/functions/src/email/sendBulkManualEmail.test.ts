import { describe, expect, it, vi } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { emailTemplate, type EmailTemplate } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that may
// run at module scope before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

// ---------------------------------------------------------------------------
// Fakes for the "authorization" describe block near the bottom of this file,
// which exercises the full onCall handler (not just the exported pure
// functions above). Hoisted test state keyed by full doc path, mirroring
// resendStaffInvite.test.ts's pattern.
// ---------------------------------------------------------------------------

interface TestState {
  docs: Record<string, Record<string, unknown> | undefined>;
  /** email -> isActive, for the roster ('in' query) lookup. */
  roster: Record<string, boolean>;
  sendEmail: ((...args: unknown[]) => unknown) | undefined;
}

const state = vi.hoisted<TestState>(() => ({
  docs: {},
  roster: {},
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

let autoIdCounter = 0;

vi.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: () => '__name__' },
  getFirestore: () => ({
    doc: (path: string) => makeDocRef(path),
    collection: (name: string) => ({
      doc: (id?: string) =>
        id === undefined
          ? { id: `auto-${String((autoIdCounter += 1))}` }
          : makeDocRef(`${name}/${id}`),
      where: (_field: unknown, _op: string, ids: readonly string[]) => ({
        get: () =>
          Promise.resolve({
            docs: ids
              .filter((id) => state.roster[id] !== undefined)
              .map((id) => ({ id, data: () => ({ isActive: state.roster[id] }) })),
          }),
      }),
    }),
  }),
}));

vi.mock('../lib/emailUtils.js', () => ({
  sendEmail: (...args: unknown[]) => state.sendEmail?.(...args),
  substituteVariables: (template: string) => template,
}));

// Rate limiting is a separate concern (covered by rateLimit.test.ts); stub it
// out here so the authorization tests below aren't coupled to its Firestore
// transaction shape.
vi.mock('../lib/rateLimit.js', () => ({
  RATE_LIMIT_KEYS: { manualEmailBroadcast: 'manualEmailBroadcast' },
  checkRateLimit: () => Promise.resolve({ allowed: true, remaining: 4, resetAtMs: Date.now() }),
  loadRateLimits: () =>
    Promise.resolve({
      saveWritesPerMinute: 60,
      audioUploadsPerHour: 20,
      transcriptionsPerDay: 50,
      pdfRegenerationsPerHour: 10,
      manualEmailBroadcastsPerHour: 5,
    }),
}));

const {
  MAX_BULK_RECIPIENTS,
  STAFF_LOOKUP_CHUNK_SIZE,
  authorizeBroadcast,
  bulkManualMailDocId,
  chunkList,
  normalizeRecipients,
  partitionRecipientsByRoster,
  queueBroadcast,
  rejectedRecipientsMessage,
  sendBulkManualEmail,
} = await import('./sendBulkManualEmail.js');

describe('normalizeRecipients', () => {
  it('lowercases and trims each address', () => {
    expect(normalizeRecipients([' Teacher@Orono.K12.MN.US '])).toEqual(['teacher@orono.k12.mn.us']);
  });

  it('drops case-insensitive duplicates, keeping the first occurrence', () => {
    expect(
      normalizeRecipients(['a@orono.k12.mn.us', 'A@ORONO.K12.MN.US', 'b@orono.k12.mn.us']),
    ).toEqual(['a@orono.k12.mn.us', 'b@orono.k12.mn.us']);
  });

  it('drops entries that are not valid-looking email addresses', () => {
    expect(normalizeRecipients(['not-an-email', '', '   ', 'a@orono.k12.mn.us'])).toEqual([
      'a@orono.k12.mn.us',
    ]);
  });

  it('drops non-string entries defensively', () => {
    expect(normalizeRecipients([42, null, undefined, 'a@orono.k12.mn.us'])).toEqual([
      'a@orono.k12.mn.us',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeRecipients([])).toEqual([]);
  });
});

describe('MAX_BULK_RECIPIENTS', () => {
  it('is the documented hard cap of 200', () => {
    expect(MAX_BULK_RECIPIENTS).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Batch-cap decision — mirrors the check in the callable so the boundary is
// covered without spinning up a full Firebase Admin environment.
// ---------------------------------------------------------------------------

function exceedsCap(count: number): boolean {
  return count > MAX_BULK_RECIPIENTS;
}

describe('recipient cap boundary', () => {
  it('allows exactly the cap', () => {
    expect(exceedsCap(MAX_BULK_RECIPIENTS)).toBe(false);
  });

  it('rejects one over the cap', () => {
    expect(exceedsCap(MAX_BULK_RECIPIENTS + 1)).toBe(true);
  });
});

describe('chunkList', () => {
  it('splits into fixed-size chunks with a short tail', () => {
    expect(chunkList([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no chunks for an empty list', () => {
    expect(chunkList([], 3)).toEqual([]);
  });

  it('throws on a non-positive chunk size rather than looping forever', () => {
    expect(() => chunkList([1], 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Roster allow-list. Regression coverage for the "open mass-mailer" hole: the
// callable used to validate toEmails for regex shape and the 200 cap only, so
// any authenticated PE could broadcast a district template to arbitrary
// external addresses. Every address must now resolve to an *active* /staff doc.
// ---------------------------------------------------------------------------

/** Build a fake StaffRosterLookup over a roster of `email -> isActive`. */
function fakeRoster(roster: Record<string, boolean>) {
  return vi.fn((ids: readonly string[]) => {
    const out = new Map<string, boolean>();
    for (const id of ids) {
      const isActive = roster[id];
      if (isActive !== undefined) out.set(id, isActive);
    }
    return Promise.resolve(out);
  });
}

describe('partitionRecipientsByRoster', () => {
  it('allows an active staff address', async () => {
    const lookup = fakeRoster({ 'teacher@orono.k12.mn.us': true });
    await expect(partitionRecipientsByRoster(lookup, ['teacher@orono.k12.mn.us'])).resolves.toEqual(
      { allowed: ['teacher@orono.k12.mn.us'], rejected: [] },
    );
  });

  it('rejects an external address that is not on the staff roster', async () => {
    const lookup = fakeRoster({ 'teacher@orono.k12.mn.us': true });
    await expect(partitionRecipientsByRoster(lookup, ['attacker@example.com'])).resolves.toEqual({
      allowed: [],
      rejected: ['attacker@example.com'],
    });
  });

  it('rejects an archived (inactive) staff address', async () => {
    const lookup = fakeRoster({ 'retired@orono.k12.mn.us': false });
    await expect(partitionRecipientsByRoster(lookup, ['retired@orono.k12.mn.us'])).resolves.toEqual(
      { allowed: [], rejected: ['retired@orono.k12.mn.us'] },
    );
  });

  it('splits a mixed list into allowed and rejected, preserving order', async () => {
    const lookup = fakeRoster({
      'a@orono.k12.mn.us': true,
      'retired@orono.k12.mn.us': false,
      'b@orono.k12.mn.us': true,
    });
    await expect(
      partitionRecipientsByRoster(lookup, [
        'a@orono.k12.mn.us',
        'attacker@example.com',
        'retired@orono.k12.mn.us',
        'b@orono.k12.mn.us',
      ]),
    ).resolves.toEqual({
      allowed: ['a@orono.k12.mn.us', 'b@orono.k12.mn.us'],
      rejected: ['attacker@example.com', 'retired@orono.k12.mn.us'],
    });
  });

  it('resolves a full-size broadcast with a bounded number of reads', async () => {
    const roster: Record<string, boolean> = {};
    const recipients: string[] = [];
    for (let i = 0; i < MAX_BULK_RECIPIENTS; i += 1) {
      const email = `staff${String(i)}@orono.k12.mn.us`;
      roster[email] = true;
      recipients.push(email);
    }
    const lookup = fakeRoster(roster);

    const result = await partitionRecipientsByRoster(lookup, recipients);

    expect(result.allowed).toHaveLength(MAX_BULK_RECIPIENTS);
    expect(result.rejected).toEqual([]);
    // One query per chunk — not one get() per recipient.
    expect(lookup).toHaveBeenCalledTimes(Math.ceil(MAX_BULK_RECIPIENTS / STAFF_LOOKUP_CHUNK_SIZE));
    for (const call of lookup.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(STAFF_LOOKUP_CHUNK_SIZE);
    }
  });

  it('makes no reads at all for an empty recipient list', async () => {
    const lookup = fakeRoster({});
    await expect(partitionRecipientsByRoster(lookup, [])).resolves.toEqual({
      allowed: [],
      rejected: [],
    });
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('rejectedRecipientsMessage', () => {
  it('names the offending addresses', () => {
    expect(rejectedRecipientsMessage(['attacker@example.com'])).toContain('attacker@example.com');
  });

  it('summarizes the tail instead of echoing a huge payload', () => {
    const many = Array.from({ length: 12 }, (_, i) => `x${String(i)}@example.com`);
    const message = rejectedRecipientsMessage(many);
    expect(message).toContain('x0@example.com');
    expect(message).toContain('(+7 more)');
    expect(message).not.toContain('x11@example.com');
  });
});

// ---------------------------------------------------------------------------
// Mail-doc id uniqueness. Regression coverage for the collision that silently
// dropped recipients: ids were built from the local part plus Date.now(), so
// two addresses sharing a local part across domains — or any two recipients
// processed in the same millisecond — produced the same id, and sendEmail()'s
// .set() overwrote the first while both were still reported as sent.
// ---------------------------------------------------------------------------

describe('bulkManualMailDocId', () => {
  it('distinguishes two addresses that share a local part across domains', () => {
    const a = bulkManualMailDocId({
      templateId: 'tpl',
      toEmail: 'jsmith@orono.k12.mn.us',
      broadcastId: 'bcast1',
      index: 0,
    });
    const b = bulkManualMailDocId({
      templateId: 'tpl',
      toEmail: 'jsmith@example.org',
      broadcastId: 'bcast1',
      index: 1,
    });
    expect(a).not.toBe(b);
  });

  it('distinguishes two broadcasts of the same template to the same recipient', () => {
    const base = { templateId: 'tpl', toEmail: 'a@orono.k12.mn.us', index: 0 };
    expect(bulkManualMailDocId({ ...base, broadcastId: 'bcast1' })).not.toBe(
      bulkManualMailDocId({ ...base, broadcastId: 'bcast2' }),
    );
  });

  it('never emits a "/" (Firestore forbids it in a document id)', () => {
    const id = bulkManualMailDocId({
      templateId: 'tpl',
      toEmail: 'a.b+tag@orono.k12.mn.us',
      broadcastId: 'bcast1',
      index: 3,
    });
    expect(id).not.toContain('/');
  });
});

describe('queueBroadcast', () => {
  /** Fake send that mimics Firestore's `.set()` semantics: writing the same
   *  mailDocId twice overwrites, losing a recipient. */
  function fakeMailStore() {
    const docs = new Map<string, string>();
    const send = (args: { to: string; mailDocId: string }) => {
      docs.set(args.mailDocId, args.to);
      return Promise.resolve({ queued: true });
    };
    return { docs, send };
  }

  it('writes one distinct mail doc per recipient when local parts collide', async () => {
    const { docs, send } = fakeMailStore();

    const result = await queueBroadcast({
      recipients: ['jsmith@orono.k12.mn.us', 'jsmith@example.org'],
      templateId: 'tpl',
      broadcastId: 'bcast1',
      send,
    });

    expect(result.sent).toBe(2);
    expect(new Set(result.mailDocIds).size).toBe(2);
    // The pre-fix id scheme collided here and silently dropped one recipient.
    expect(docs.size).toBe(2);
    expect([...docs.values()].sort()).toEqual(['jsmith@example.org', 'jsmith@orono.k12.mn.us']);
  });

  it('gives every recipient of a full-size broadcast a unique mail doc', async () => {
    const { docs, send } = fakeMailStore();
    const recipients = Array.from(
      { length: MAX_BULK_RECIPIENTS },
      (_, i) => `staff${String(i)}@orono.k12.mn.us`,
    );

    const result = await queueBroadcast({
      recipients,
      templateId: 'tpl',
      broadcastId: 'bcast1',
      send,
    });

    expect(result.sent).toBe(MAX_BULK_RECIPIENTS);
    expect(docs.size).toBe(MAX_BULK_RECIPIENTS);
  });

  it('reports preference-suppressed recipients without counting them as sent', async () => {
    const result = await queueBroadcast({
      recipients: ['a@orono.k12.mn.us', 'optout@orono.k12.mn.us'],
      templateId: 'tpl',
      broadcastId: 'bcast1',
      send: ({ to }) => Promise.resolve({ queued: to !== 'optout@orono.k12.mn.us' }),
    });

    expect(result.sent).toBe(1);
    expect(result.suppressed).toEqual(['optout@orono.k12.mn.us']);
  });
});

// ---------------------------------------------------------------------------
// Gate ordering. Regression coverage for the limiter being charged before the
// template was validated: a request naming a nonexistent/inactive/non-manual
// template used to burn one of the caller's five hourly broadcast slots even
// though nothing was ever sent.
// ---------------------------------------------------------------------------

function makeTemplate(overrides: Partial<EmailTemplate> = {}): EmailTemplate {
  return emailTemplate.parse({
    templateId: 'group-message',
    name: 'Group message',
    subject: 'Hello',
    bodyHtml: '<p>Hello</p>',
    triggerType: 'manual',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
}

describe('authorizeBroadcast', () => {
  const recipients = ['teacher@orono.k12.mn.us'];

  function makeGuards(overrides: {
    template?: EmailTemplate | null;
    roster?: Record<string, boolean>;
    allowed?: boolean;
  }) {
    const chargeRateLimit = vi.fn(() =>
      Promise.resolve({ allowed: overrides.allowed ?? true, max: 5 }),
    );
    const rosterLookup = fakeRoster(overrides.roster ?? { 'teacher@orono.k12.mn.us': true });
    const loadTemplate = vi.fn(() =>
      Promise.resolve(overrides.template === undefined ? makeTemplate() : overrides.template),
    );
    return { loadTemplate, rosterLookup, chargeRateLimit };
  }

  it('returns the template and charges exactly one slot on a valid request', async () => {
    const guards = makeGuards({});
    await expect(
      authorizeBroadcast({ templateId: 'group-message', recipients, guards }),
    ).resolves.toMatchObject({ templateId: 'group-message' });
    expect(guards.chargeRateLimit).toHaveBeenCalledTimes(1);
  });

  it('does not charge a slot when the template does not exist', async () => {
    const guards = makeGuards({ template: null });
    await expect(authorizeBroadcast({ templateId: 'nope', recipients, guards })).rejects.toThrow(
      /Template not found/,
    );
    expect(guards.chargeRateLimit).not.toHaveBeenCalled();
  });

  it('does not charge a slot when the template is inactive', async () => {
    const guards = makeGuards({ template: makeTemplate({ isActive: false }) });
    await expect(
      authorizeBroadcast({ templateId: 'group-message', recipients, guards }),
    ).rejects.toThrow(/inactive/);
    expect(guards.chargeRateLimit).not.toHaveBeenCalled();
  });

  it('does not charge a slot when the template is not a manual trigger', async () => {
    const guards = makeGuards({ template: makeTemplate({ triggerType: 'staff.created' }) });
    await expect(
      authorizeBroadcast({ templateId: 'group-message', recipients, guards }),
    ).rejects.toThrow(/manual templates/);
    expect(guards.chargeRateLimit).not.toHaveBeenCalled();
  });

  it('rejects and does not charge a slot when a recipient is not active staff', async () => {
    const guards = makeGuards({ roster: { 'teacher@orono.k12.mn.us': true } });
    await expect(
      authorizeBroadcast({
        templateId: 'group-message',
        recipients: ['teacher@orono.k12.mn.us', 'attacker@example.com'],
        guards,
      }),
    ).rejects.toThrow(/attacker@example\.com/);
    expect(guards.chargeRateLimit).not.toHaveBeenCalled();
  });

  it('surfaces the configured hourly limit when the caller is throttled', async () => {
    const guards = makeGuards({ allowed: false });
    await expect(
      authorizeBroadcast({ templateId: 'group-message', recipients, guards }),
    ).rejects.toThrow(/Broadcast limit reached \(5\/hour\)/);
  });
});

// ---------------------------------------------------------------------------
// Full-callable authorization tests — regression coverage for INTEG-AUTHZ.
//
// Before the fix, this callable's "PE or admin" check was computed from the
// token's `role` claim only (isSpecialRole(role) || isAdminRole(role)),
// ignoring `hasAdminAccess`. A Teacher-role staff member granted
// `hasAdminAccess: true` can reach /admin/staff and its "Message a group"
// action (RequireAuth gates on the `isAdmin` claim, which syncMyClaims
// computes as `isAdminRole(role) || hasAdminAccess`), so that fully-supported
// user class got a deterministic permission-denied here — while
// resendStaffInvite (widened by PR #78) succeeded for the same user right
// next to it. The fix delegates to the shared `callerMeetsAccessLevel`
// helper (../lib/callerAccess.ts), which also backs sendManualEmail.ts and
// resendStaffInvite.ts.
// ---------------------------------------------------------------------------

const run = (req: Partial<CallableRequest>) =>
  (sendBulkManualEmail as unknown as { run: (r: unknown) => Promise<unknown> }).run(req);

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

describe('sendBulkManualEmail — authorization', () => {
  const TEMPLATE_ID = 'group-message';
  const RECIPIENT = 'staffmember@orono.k12.mn.us';

  function resetAuthzFixtures() {
    state.docs = {
      [`emailTemplates/${TEMPLATE_ID}`]: {
        templateId: TEMPLATE_ID,
        name: 'Group message',
        subject: 'Hi team',
        bodyHtml: '<p>Hi team</p>',
        triggerType: 'manual',
        isActive: true,
      },
    };
    state.roster = { [RECIPIENT]: true };
    state.sendEmail = vi.fn().mockResolvedValue({ queued: true });
  }

  it('rejects an unauthenticated call', async () => {
    resetAuthzFixtures();
    await expect(
      run({ data: { templateId: TEMPLATE_ID, toEmails: [RECIPIENT] } }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('allows a caller whose token role is an admin role', async () => {
    resetAuthzFixtures();
    const result = await run(
      authedRequest('admin@orono.k12.mn.us', 'administrator', {
        templateId: TEMPLATE_ID,
        toEmails: [RECIPIENT],
      }),
    );
    expect(result).toMatchObject({ requested: 1, sent: 1 });
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('allows a hasAdminAccess-only caller (non-special role, hasAdminAccess: true)', async () => {
    resetAuthzFixtures();
    state.docs['staff/teacher-admin@orono.k12.mn.us'] = {
      name: 'Teacher Admin',
      role: 'teacher',
      hasAdminAccess: true,
      isActive: true,
    };
    const result = await run(
      authedRequest('teacher-admin@orono.k12.mn.us', 'teacher', {
        templateId: TEMPLATE_ID,
        toEmails: [RECIPIENT],
      }),
    );
    expect(result).toMatchObject({ requested: 1, sent: 1 });
    expect(state.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects a hasAdminAccess-only caller whose live staff doc has since been revoked', async () => {
    resetAuthzFixtures();
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
          toEmails: [RECIPIENT],
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('rejects a plain non-admin, non-PE caller with no /staff doc', async () => {
    resetAuthzFixtures();
    await expect(
      run(
        authedRequest('teacher@orono.k12.mn.us', 'teacher', {
          templateId: TEMPLATE_ID,
          toEmails: [RECIPIENT],
        }),
      ),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(state.sendEmail).not.toHaveBeenCalled();
  });

  it('allows a caller whose token role is a special (PE) role', async () => {
    resetAuthzFixtures();
    const result = await run(
      authedRequest('pe@orono.k12.mn.us', 'peer-evaluator', {
        templateId: TEMPLATE_ID,
        toEmails: [RECIPIENT],
      }),
    );
    expect(result).toMatchObject({ requested: 1, sent: 1 });
  });
});
