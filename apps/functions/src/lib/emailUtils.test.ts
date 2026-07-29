import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { APP_SETTINGS_DOC_ID, AUDIT_ACTIONS, COLLECTIONS } from '@ops/shared';
import {
  formatDate,
  isEmailSuppressed,
  loadActiveTemplate,
  loadSecurityAdminEmail,
  sendEmail,
  sendTemplatedEmail,
  substituteVariables,
} from './emailUtils.js';

/**
 * Behavioral tests for the email delivery path in emailUtils.ts.
 *
 * emailUtils takes the Firestore handle as a parameter (never calls
 * getFirestore itself), so we drive it with a hand-rolled in-memory fake
 * instead of mocking firebase-admin. The fake records every write so we can
 * assert exactly which /mail and /auditLog docs a send produced.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore fake
// ---------------------------------------------------------------------------

type DocData = Record<string, unknown> | undefined;

interface Writes {
  mailSets: { id: string; data: Record<string, unknown> }[];
  added: { col: string; data: Record<string, unknown> }[];
}

function makeDb(opts: {
  /** Docs returned by db.doc(path).get() and db.collection(name).doc(id).get(). */
  docs?: Record<string, DocData>;
  /** Rows the emailTemplates collection query iterates over. */
  templates?: (Record<string, unknown> & { id?: string })[];
}): { db: Firestore; writes: Writes } {
  const docsMap = opts.docs ?? {};
  const templates = opts.templates ?? [];
  const writes: Writes = { mailSets: [], added: [] };

  function collection(name: string) {
    const filters: [string, unknown][] = [];
    const q = {
      where(field: string, _op: string, val: unknown) {
        filters.push([field, val]);
        return q;
      },
      limit() {
        return q;
      },
      get() {
        let arr = name === COLLECTIONS.emailTemplates ? templates : [];
        for (const [f, v] of filters) arr = arr.filter((d) => d[f] === v);
        const docs = arr.map((d) => ({ id: d.id ?? 'tmpl', data: () => d }));
        return { empty: docs.length === 0, docs };
      },
      doc(id: string) {
        return {
          set(data: Record<string, unknown>) {
            if (name === COLLECTIONS.mail) writes.mailSets.push({ id, data });
          },
          get() {
            const data = docsMap[`${name}/${id}`];
            return { exists: data !== undefined, data: () => data };
          },
        };
      },
      add(data: Record<string, unknown>) {
        writes.added.push({ col: name, data });
        return { id: 'added' };
      },
    };
    return q;
  }

  function doc(path: string) {
    return {
      get() {
        const data = docsMap[path];
        return { exists: data !== undefined, data: () => data };
      },
    };
  }

  return { db: { collection, doc } as unknown as Firestore, writes };
}

const appSettingsPath = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

// ---------------------------------------------------------------------------
// substituteVariables
// ---------------------------------------------------------------------------

describe('substituteVariables', () => {
  it('substitutes known variables', () => {
    expect(substituteVariables('Hi {{name}}!', { name: 'Sam' })).toBe('Hi Sam!');
  });

  it('renders unknown/undefined variables as empty string', () => {
    expect(substituteVariables('X{{missing}}Y', {})).toBe('XY');
  });

  it('HTML-escapes substituted values to prevent markup injection', () => {
    expect(substituteVariables('{{v}}', { v: '<script>&"\'' })).toBe(
      '&lt;script&gt;&amp;&quot;&#39;',
    );
  });

  it('replaces every occurrence of a repeated variable', () => {
    expect(substituteVariables('{{a}}-{{a}}', { a: '1' })).toBe('1-1');
  });
});

// ---------------------------------------------------------------------------
// formatDate
// ---------------------------------------------------------------------------

describe('formatDate', () => {
  it('formats a Firestore-Timestamp-like value via toDate()', () => {
    const ts = { toDate: () => new Date(2026, 2, 14) };
    expect(formatDate(ts)).toBe('March 14, 2026');
  });

  it('formats a JS Date', () => {
    expect(formatDate(new Date(2026, 11, 25))).toBe('December 25, 2026');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('returns empty string for a non-date value', () => {
    expect(formatDate(42)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// loadActiveTemplate
// ---------------------------------------------------------------------------

describe('loadActiveTemplate', () => {
  it('returns the active template for a trigger type', async () => {
    const { db } = makeDb({
      templates: [
        { id: 't1', triggerType: 'observation.finalized', isActive: true, subject: 'Done' },
      ],
    });
    const tmpl = await loadActiveTemplate(db, 'observation.finalized');
    expect(tmpl?.id).toBe('t1');
    expect(tmpl?.subject).toBe('Done');
  });

  it('returns null when no active template exists', async () => {
    const { db } = makeDb({
      templates: [{ id: 't1', triggerType: 'observation.finalized', isActive: false }],
    });
    expect(await loadActiveTemplate(db, 'observation.finalized')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isEmailSuppressed
// ---------------------------------------------------------------------------

describe('isEmailSuppressed', () => {
  it('never suppresses a critical trigger, even if opted out', async () => {
    const { db } = makeDb({
      docs: {
        [`${COLLECTIONS.staff}/teacher@orono.k12.mn.us`]: {
          emailPreferences: { observationNotices: false },
        },
      },
    });
    // staff.created is critical
    expect(await isEmailSuppressed(db, 'teacher@orono.k12.mn.us', 'staff.created')).toBe(false);
  });

  it('suppresses when the governing category is opted out', async () => {
    const { db } = makeDb({
      docs: {
        [`${COLLECTIONS.staff}/teacher@orono.k12.mn.us`]: {
          emailPreferences: { observationNotices: false },
        },
      },
    });
    expect(await isEmailSuppressed(db, 'teacher@orono.k12.mn.us', 'observation.finalized')).toBe(
      true,
    );
  });

  it('does not suppress when the category is opted in', async () => {
    const { db } = makeDb({
      docs: {
        [`${COLLECTIONS.staff}/teacher@orono.k12.mn.us`]: {
          emailPreferences: { observationNotices: true },
        },
      },
    });
    expect(await isEmailSuppressed(db, 'teacher@orono.k12.mn.us', 'observation.finalized')).toBe(
      false,
    );
  });

  it('defaults to opted-in (not suppressed) for a legacy staff doc with no preferences', async () => {
    const { db } = makeDb({
      docs: { [`${COLLECTIONS.staff}/legacy@orono.k12.mn.us`]: {} },
    });
    expect(await isEmailSuppressed(db, 'legacy@orono.k12.mn.us', 'observation.finalized')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// loadSecurityAdminEmail
// ---------------------------------------------------------------------------

describe('loadSecurityAdminEmail', () => {
  it('returns the configured, trimmed email', async () => {
    const { db } = makeDb({
      docs: { [appSettingsPath]: { securityAdminEmail: '  admin@orono.k12.mn.us  ' } },
    });
    expect(await loadSecurityAdminEmail(db)).toBe('admin@orono.k12.mn.us');
  });

  it('returns null when unset', async () => {
    const { db } = makeDb({ docs: { [appSettingsPath]: {} } });
    expect(await loadSecurityAdminEmail(db)).toBeNull();
  });

  it('returns null when blank/whitespace', async () => {
    const { db } = makeDb({ docs: { [appSettingsPath]: { securityAdminEmail: '   ' } } });
    expect(await loadSecurityAdminEmail(db)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  it('queues a critical trigger for all recipients and writes an emailSent audit entry', async () => {
    const { db, writes } = makeDb({ docs: { [appSettingsPath]: {} } });
    const result = await sendEmail({
      db,
      to: ['a@orono.k12.mn.us', 'b@orono.k12.mn.us'],
      subject: 'Hi',
      html: '<p>body</p>',
      mailDocId: 'm1',
      triggerType: 'staff.created',
    });
    expect(result).toEqual({
      queued: true,
      to: ['a@orono.k12.mn.us', 'b@orono.k12.mn.us'],
      suppressed: [],
    });
    expect(writes.mailSets).toHaveLength(1);
    expect(writes.mailSets[0]?.id).toBe('m1');
    expect(writes.mailSets[0]?.data['to']).toEqual(['a@orono.k12.mn.us', 'b@orono.k12.mn.us']);
    const audit = writes.added.find((w) => w.col === COLLECTIONS.auditLog);
    expect(audit?.data['action']).toBe(AUDIT_ACTIONS.emailSent);
  });

  it('drops opted-out recipients and queues only the remaining ones', async () => {
    const { db, writes } = makeDb({
      docs: {
        [appSettingsPath]: {},
        [`${COLLECTIONS.staff}/optout@orono.k12.mn.us`]: {
          emailPreferences: { observationNotices: false },
        },
        [`${COLLECTIONS.staff}/optin@orono.k12.mn.us`]: {
          emailPreferences: { observationNotices: true },
        },
      },
    });
    const result = await sendEmail({
      db,
      to: ['optout@orono.k12.mn.us', 'optin@orono.k12.mn.us'],
      subject: 'Finalized',
      html: '<p>x</p>',
      mailDocId: 'm2',
      triggerType: 'observation.finalized',
    });
    expect(result.queued).toBe(true);
    expect(result.to).toEqual(['optin@orono.k12.mn.us']);
    expect(result.suppressed).toEqual(['optout@orono.k12.mn.us']);
    expect(writes.mailSets[0]?.data['to']).toEqual(['optin@orono.k12.mn.us']);
    const audit = writes.added.find((w) => w.col === COLLECTIONS.auditLog);
    expect(audit?.data['action']).toBe(AUDIT_ACTIONS.emailSent);
    expect((audit?.data['details'] as { suppressed?: string[] }).suppressed).toEqual([
      'optout@orono.k12.mn.us',
    ]);
  });

  it('queues nothing and writes an emailSuppressed audit when every recipient opted out', async () => {
    const { db, writes } = makeDb({
      docs: {
        [appSettingsPath]: {},
        [`${COLLECTIONS.staff}/optout@orono.k12.mn.us`]: {
          emailPreferences: { observationNotices: false },
        },
      },
    });
    const result = await sendEmail({
      db,
      to: 'optout@orono.k12.mn.us',
      subject: 'Finalized',
      html: '<p>x</p>',
      mailDocId: 'm3',
      triggerType: 'observation.finalized',
    });
    expect(result).toEqual({ queued: false, to: [], suppressed: ['optout@orono.k12.mn.us'] });
    expect(writes.mailSets).toHaveLength(0);
    const audit = writes.added.find((w) => w.col === COLLECTIONS.auditLog);
    expect(audit?.data['action']).toBe(AUDIT_ACTIONS.emailSuppressed);
  });

  it('ignores falsy recipients in the to list', async () => {
    const { db, writes } = makeDb({ docs: { [appSettingsPath]: {} } });
    const result = await sendEmail({
      db,
      to: ['', 'real@orono.k12.mn.us'],
      subject: 'Hi',
      html: '<p>x</p>',
      mailDocId: 'm4',
      triggerType: 'staff.created',
    });
    expect(result.to).toEqual(['real@orono.k12.mn.us']);
    expect(writes.mailSets[0]?.data['to']).toEqual(['real@orono.k12.mn.us']);
  });

  it('rewrites an unsafe href in the body before queueing and records it in the audit entry', async () => {
    const { db, writes } = makeDb({ docs: { [appSettingsPath]: {} } });
    await sendEmail({
      db,
      to: 'a@orono.k12.mn.us',
      subject: 'Hi',
      html: '<p><a href="javascript:alert(1)">click</a></p>',
      mailDocId: 'm4-unsafe',
      triggerType: 'staff.created',
    });
    const msg = writes.mailSets[0]?.data['message'] as { html: string };
    expect(msg.html).toContain('<a href="#">click</a>');
    expect(msg.html).not.toContain('javascript:alert(1)');
    const audit = writes.added.find((w) => w.col === COLLECTIONS.auditLog);
    expect((audit?.data['details'] as { rejectedHrefs?: string[] }).rejectedHrefs).toEqual([
      'javascript:alert(1)',
    ]);
  });

  it('leaves a safe body untouched and omits rejectedHrefs from the audit entry', async () => {
    const { db, writes } = makeDb({ docs: { [appSettingsPath]: {} } });
    await sendEmail({
      db,
      to: 'a@orono.k12.mn.us',
      subject: 'Hi',
      html: '<p><a href="https://example.com">click</a></p>',
      mailDocId: 'm4-safe',
      triggerType: 'staff.created',
    });
    const msg = writes.mailSets[0]?.data['message'] as { html: string };
    expect(msg.html).toContain('<a href="https://example.com">click</a>');
    const audit = writes.added.find((w) => w.col === COLLECTIONS.auditLog);
    expect(audit?.data['details']).not.toHaveProperty('rejectedHrefs');
  });

  // -------------------------------------------------------------------------
  // OBS-08 — overdue-finalize reminder is sent `to` the *observer*, so
  // suppression must gate on the observer's own /staff doc, not the observed
  // staff member's. This is the subtle bit the brief flagged: it's easy to
  // accidentally reuse the observed person's preferences (or their doc path)
  // when wiring a new "to the PE" reminder. Verify sendEmail resolves the
  // right person purely from `to`, regardless of what the observed party's
  // preferences say.
  // -------------------------------------------------------------------------
  it('OBS-08: suppresses the overdue-finalize reminder when the observer (recipient) opted out, even though the observed staff member opted in', async () => {
    const { db, writes } = makeDb({
      docs: {
        [appSettingsPath]: {},
        [`${COLLECTIONS.staff}/observer@orono.k12.mn.us`]: {
          emailPreferences: { reminders: false },
        },
        [`${COLLECTIONS.staff}/observed@orono.k12.mn.us`]: {
          emailPreferences: { reminders: true },
        },
      },
    });
    const result = await sendEmail({
      db,
      to: 'observer@orono.k12.mn.us', // recipient is the observer, per OBS-08 owner decision
      subject: 'Please finalize',
      html: '<p>x</p>',
      mailDocId: 'overdue-obs1-2026-W31',
      triggerType: 'scheduled.reminderOverdueFinalize',
    });
    expect(result).toEqual({
      queued: false,
      to: [],
      suppressed: ['observer@orono.k12.mn.us'],
    });
    expect(writes.mailSets).toHaveLength(0);
  });

  it('OBS-08: sends the overdue-finalize reminder when the observer (recipient) opted in, even though the observed staff member opted out', async () => {
    const { db, writes } = makeDb({
      docs: {
        [appSettingsPath]: {},
        [`${COLLECTIONS.staff}/observer@orono.k12.mn.us`]: {
          emailPreferences: { reminders: true },
        },
        [`${COLLECTIONS.staff}/observed@orono.k12.mn.us`]: {
          emailPreferences: { reminders: false },
        },
      },
    });
    const result = await sendEmail({
      db,
      to: 'observer@orono.k12.mn.us',
      subject: 'Please finalize',
      html: '<p>x</p>',
      mailDocId: 'overdue-obs2-2026-W31',
      triggerType: 'scheduled.reminderOverdueFinalize',
    });
    expect(result.queued).toBe(true);
    expect(result.to).toEqual(['observer@orono.k12.mn.us']);
    expect(result.suppressed).toEqual([]);
    expect(writes.mailSets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// sendTemplatedEmail
// ---------------------------------------------------------------------------

describe('sendTemplatedEmail', () => {
  it('returns false and sends nothing when no active template exists', async () => {
    const { db, writes } = makeDb({ templates: [] });
    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'observation.finalized',
      to: 'a@orono.k12.mn.us',
      vars: {},
      mailDocId: 'm5',
    });
    expect(sent).toBe(false);
    expect(writes.mailSets).toHaveLength(0);
  });

  it('substitutes variables from an active template and queues the mail', async () => {
    const { db, writes } = makeDb({
      docs: { [appSettingsPath]: {} },
      templates: [
        {
          id: 't1',
          triggerType: 'observation.finalized',
          isActive: true,
          subject: 'For {{observedName}}',
          bodyHtml: '<p>Hello {{observedName}}</p>',
        },
      ],
    });
    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'observation.finalized',
      to: 'a@orono.k12.mn.us',
      vars: { observedName: 'Jane' },
      mailDocId: 'm6',
    });
    expect(sent).toBe(true);
    expect(writes.mailSets).toHaveLength(1);
    const msg = writes.mailSets[0]?.data['message'] as { subject: string; html: string };
    expect(msg.subject).toBe('For Jane');
    expect(msg.html).toContain('Hello Jane');
  });

  it('sanitizes an unsafe href that arrives through a substituted variable', async () => {
    // Ordering guard: substitution runs before the send-time sanitize, so a
    // protocol smuggled in via an /appSettings value (not the template body)
    // still gets rewritten on the way out.
    const { db, writes } = makeDb({
      docs: { [appSettingsPath]: { signupLink: 'javascript:alert(1)' } },
      templates: [
        {
          id: 't2',
          triggerType: 'observation.finalized',
          isActive: true,
          subject: 'Sign up',
          bodyHtml: '<a href="{{signupLink}}">Sign up</a>',
        },
      ],
    });
    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'observation.finalized',
      to: 'a@orono.k12.mn.us',
      vars: {},
      mailDocId: 'm7',
    });
    expect(sent).toBe(true);
    const msg = writes.mailSets[0]?.data['message'] as { html: string };
    expect(msg.html).toContain('<a href="#">Sign up</a>');
    expect(msg.html).not.toContain('javascript:');
  });
});
