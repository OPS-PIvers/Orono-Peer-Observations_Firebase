import { describe, expect, it, vi } from 'vitest';
import { emailTemplate, type EmailTemplate } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that may
// run at module scope before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';

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
