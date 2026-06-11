import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  incompleteReminderMailDocId,
  loadSecurityAdminEmail,
  sendEmail,
  sendTemplatedEmail,
  shouldSendIncompleteReminder,
  staffInviteMailDocId,
  substituteVariables,
} from './emailUtils.js';

describe('substituteVariables', () => {
  it('substitutes known variables and blanks unknown ones', () => {
    expect(substituteVariables('Hi {{name}} <{{missing}}>', { name: 'Sam' })).toBe('Hi Sam <>');
  });
});

describe('incompleteReminderMailDocId', () => {
  it('produces a stable id within one run date (idempotent on retry)', () => {
    expect(incompleteReminderMailDocId('obs1', '2026-06-08')).toBe(
      incompleteReminderMailDocId('obs1', '2026-06-08'),
    );
  });

  it('produces a distinct id on the next day so the nudge re-sends', () => {
    expect(incompleteReminderMailDocId('obs1', '2026-06-08')).not.toBe(
      incompleteReminderMailDocId('obs1', '2026-06-09'),
    );
  });

  it('embeds the observation id and run date', () => {
    expect(incompleteReminderMailDocId('obs1', '2026-06-08')).toBe('incomplete-obs1-2026-06-08');
  });
});

// ---------------------------------------------------------------------------
// shouldSendIncompleteReminder
// ---------------------------------------------------------------------------

describe('shouldSendIncompleteReminder', () => {
  // With scheduledDays=3 and maxReminders=5:
  //   day 0–2  → not yet eligible
  //   day 3    → nudge 0 (first send)
  //   day 4    → nudge 1
  //   day 5    → nudge 2
  //   day 6    → nudge 3
  //   day 7    → nudge 4 (last send, maxReminders - 1)
  //   day 8+   → capped

  it('returns false before the first eligible day', () => {
    expect(shouldSendIncompleteReminder(0, 3, 5)).toBe(false);
    expect(shouldSendIncompleteReminder(2, 3, 5)).toBe(false);
  });

  it('returns true on the first eligible day (nudge day 0)', () => {
    expect(shouldSendIncompleteReminder(3, 3, 5)).toBe(true);
  });

  it('returns true on subsequent nudge days within the cap', () => {
    expect(shouldSendIncompleteReminder(4, 3, 5)).toBe(true);
    expect(shouldSendIncompleteReminder(5, 3, 5)).toBe(true);
    expect(shouldSendIncompleteReminder(6, 3, 5)).toBe(true);
    expect(shouldSendIncompleteReminder(7, 3, 5)).toBe(true);
  });

  it('returns false once the cap is reached (nudge day >= maxReminders)', () => {
    expect(shouldSendIncompleteReminder(8, 3, 5)).toBe(false);
    expect(shouldSendIncompleteReminder(30, 3, 5)).toBe(false);
  });

  it('returns true for exactly one day when maxReminders=1', () => {
    expect(shouldSendIncompleteReminder(3, 3, 1)).toBe(true);
    expect(shouldSendIncompleteReminder(4, 3, 1)).toBe(false);
  });

  it('handles scheduledDays=0 (immediate first send)', () => {
    expect(shouldSendIncompleteReminder(0, 0, 3)).toBe(true);
    expect(shouldSendIncompleteReminder(2, 0, 3)).toBe(true);
    expect(shouldSendIncompleteReminder(3, 0, 3)).toBe(false);
  });
});

interface MailWrite {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Minimal Firestore stub for sendEmail: serves a canned appSettings/global
 * doc and records writes to /mail and /auditLog.
 */
function fakeDb(settings: Record<string, unknown> | undefined): {
  db: Firestore;
  mailWrites: MailWrite[];
  auditWrites: Record<string, unknown>[];
} {
  const mailWrites: MailWrite[] = [];
  const auditWrites: Record<string, unknown>[] = [];

  const db = {
    doc: () => ({
      get: () => Promise.resolve({ data: () => settings }),
    }),
    collection: (name: string) =>
      name === 'mail'
        ? {
            doc: (id: string) => ({
              set: (data: Record<string, unknown>) => {
                mailWrites.push({ id, data });
                return Promise.resolve();
              },
            }),
          }
        : {
            add: (data: Record<string, unknown>) => {
              auditWrites.push(data);
              return Promise.resolve();
            },
          },
  } as unknown as Firestore;

  return { db, mailWrites, auditWrites };
}

const SEND_ARGS = {
  to: 'jane@orono.k12.mn.us',
  subject: 'Hello',
  html: '<p>Body</p>',
  mailDocId: 'mail-1',
};

describe('sendEmail', () => {
  it('sends from the admin-configured outboundEmailAddress when set', async () => {
    const { db, mailWrites } = fakeDb({ outboundEmailAddress: 'peer-obs@orono.k12.mn.us' });

    await sendEmail({ db, ...SEND_ARGS });

    expect(mailWrites).toHaveLength(1);
    expect(mailWrites[0]?.id).toBe('mail-1');
    expect(mailWrites[0]?.data['from']).toBe('peer-obs@orono.k12.mn.us');
  });

  it('falls back to the default from address when the setting is absent', async () => {
    const { db, mailWrites } = fakeDb({});

    await sendEmail({ db, ...SEND_ARGS });

    expect(mailWrites[0]?.data['from']).toBe('observations@orono.k12.mn.us');
  });

  it('falls back to the default from address when the settings doc is missing', async () => {
    const { db, mailWrites } = fakeDb(undefined);

    await sendEmail({ db, ...SEND_ARGS });

    expect(mailWrites[0]?.data['from']).toBe('observations@orono.k12.mn.us');
  });

  it('treats a blank outboundEmailAddress as unset', async () => {
    const { db, mailWrites } = fakeDb({ outboundEmailAddress: '   ' });

    await sendEmail({ db, ...SEND_ARGS });

    expect(mailWrites[0]?.data['from']).toBe('observations@orono.k12.mn.us');
  });

  it('trims whitespace around a configured outboundEmailAddress', async () => {
    const { db, mailWrites } = fakeDb({ outboundEmailAddress: ' peer-obs@orono.k12.mn.us ' });

    await sendEmail({ db, ...SEND_ARGS });

    expect(mailWrites[0]?.data['from']).toBe('peer-obs@orono.k12.mn.us');
  });

  it('records the resolved sender as the audit-log actor', async () => {
    const { db, auditWrites } = fakeDb({ outboundEmailAddress: 'peer-obs@orono.k12.mn.us' });

    await sendEmail({ db, ...SEND_ARGS });

    expect(auditWrites).toHaveLength(1);
    expect(auditWrites[0]?.['userEmail']).toBe('peer-obs@orono.k12.mn.us');
  });
});

describe('staffInviteMailDocId', () => {
  it('makes the email safe as a doc id and embeds the timestamp', () => {
    expect(staffInviteMailDocId('jane@orono.k12.mn.us', 1_700_000_000_000)).toBe(
      'invite-jane-at-orono.k12.mn.us-1700000000000',
    );
  });

  it('differs across invites so a re-invite re-sends', () => {
    expect(staffInviteMailDocId('jane@orono.k12.mn.us', 1)).not.toBe(
      staffInviteMailDocId('jane@orono.k12.mn.us', 2),
    );
  });
});

// ---------------------------------------------------------------------------
// observerName resolution helpers (mirrors the pattern used at every email
// send site in functions and the web client).
// ---------------------------------------------------------------------------

/**
 * The resolution pattern used everywhere: prefer the denormalized
 * `observerName`; fall back to the email localpart for observations created
 * before the field was added.
 */
function resolveObserverName(observerName: string | undefined, observerEmail: string): string {
  return observerName || (observerEmail.split('@')[0] ?? '');
}

describe('resolveObserverName (observer name denormalization fallback)', () => {
  it('returns the stored observerName when present', () => {
    expect(resolveObserverName('Jane Doe', 'jdoe@orono.k12.mn.us')).toBe('Jane Doe');
  });

  it('falls back to the email localpart when observerName is empty string', () => {
    expect(resolveObserverName('', 'jdoe@orono.k12.mn.us')).toBe('jdoe');
  });

  it('falls back to the email localpart when observerName is undefined (pre-migration doc)', () => {
    expect(resolveObserverName(undefined, 'jdoe@orono.k12.mn.us')).toBe('jdoe');
  });

  it('uses the full email string as fallback when there is no @ character', () => {
    // Edge-case: a malformed email still produces a deterministic result
    expect(resolveObserverName('', 'noDomain')).toBe('noDomain');
  });

  it('does not strip a name that happens to start with an @', () => {
    // observerName is stored verbatim; only the fallback splits on @
    expect(resolveObserverName('@nick', 'nick@orono.k12.mn.us')).toBe('@nick');
  });
});

// ---------------------------------------------------------------------------
// loadSecurityAdminEmail
// ---------------------------------------------------------------------------

/**
 * Minimal Firestore stub for loadSecurityAdminEmail: the doc() always
 * returns the provided settings data (or undefined to simulate a missing doc).
 */
function fakeDbForSettings(settings: Record<string, unknown> | undefined): Firestore {
  return {
    doc: () => ({
      get: () => Promise.resolve({ data: () => settings }),
    }),
    collection: () => ({
      where: () => ({
        where: () => ({
          limit: () => ({
            get: () => Promise.resolve({ empty: true, docs: [] }),
          }),
        }),
      }),
    }),
  } as unknown as Firestore;
}

describe('loadSecurityAdminEmail', () => {
  it('returns the trimmed address when securityAdminEmail is set', async () => {
    const db = fakeDbForSettings({ securityAdminEmail: '  sec@orono.k12.mn.us  ' });
    expect(await loadSecurityAdminEmail(db)).toBe('sec@orono.k12.mn.us');
  });

  it('returns null when securityAdminEmail is an empty string', async () => {
    const db = fakeDbForSettings({ securityAdminEmail: '' });
    expect(await loadSecurityAdminEmail(db)).toBeNull();
  });

  it('returns null when securityAdminEmail is blank whitespace', async () => {
    const db = fakeDbForSettings({ securityAdminEmail: '   ' });
    expect(await loadSecurityAdminEmail(db)).toBeNull();
  });

  it('returns null when securityAdminEmail is absent from the doc', async () => {
    const db = fakeDbForSettings({});
    expect(await loadSecurityAdminEmail(db)).toBeNull();
  });

  it('returns null when the settings doc does not exist', async () => {
    const db = fakeDbForSettings(undefined);
    expect(await loadSecurityAdminEmail(db)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sendTemplatedEmail — admin recipient resolution
// ---------------------------------------------------------------------------

interface TemplateRecord {
  triggerType: string;
  isActive: boolean;
  subject: string;
  bodyHtml: string;
  recipient: string;
}

/**
 * Stub Firestore for sendTemplatedEmail tests: the emailTemplates collection
 * query returns the given template (or nothing), and the appSettings doc
 * returns the provided settings.
 */
function fakeDbForTemplatedEmail(
  template: TemplateRecord | null,
  settings: Record<string, unknown>,
): { db: Firestore; mailWrites: MailWrite[]; auditWrites: Record<string, unknown>[] } {
  const mailWrites: MailWrite[] = [];
  const auditWrites: Record<string, unknown>[] = [];

  const templateDocs = template
    ? [{ id: 'tpl-1', data: () => template }]
    : [];

  const db = {
    doc: () => ({
      get: () => Promise.resolve({ data: () => settings }),
    }),
    collection: (name: string) => {
      if (name === 'mail') {
        return {
          doc: (id: string) => ({
            set: (data: Record<string, unknown>) => {
              mailWrites.push({ id, data });
              return Promise.resolve();
            },
          }),
        };
      }
      if (name === 'emailTemplates') {
        return {
          where: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  get: () =>
                    Promise.resolve({
                      empty: templateDocs.length === 0,
                      docs: templateDocs,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      // auditLog
      return {
        add: (data: Record<string, unknown>) => {
          auditWrites.push(data);
          return Promise.resolve();
        },
      };
    },
  } as unknown as Firestore;

  return { db, mailWrites, auditWrites };
}

const BASE_TEMPLATE: TemplateRecord = {
  triggerType: 'manual',
  isActive: true,
  subject: 'Alert: {{appName}}',
  bodyHtml: '<p>Hello</p>',
  recipient: 'observed',
};

describe('sendTemplatedEmail — admin recipient resolution', () => {
  it('routes to securityAdminEmail when template recipient is admin', async () => {
    const { db, mailWrites } = fakeDbForTemplatedEmail(
      { ...BASE_TEMPLATE, recipient: 'admin' },
      { securityAdminEmail: 'sec@orono.k12.mn.us', branding: { appName: 'Peer Obs' } },
    );

    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'manual',
      to: 'other@orono.k12.mn.us',
      vars: {},
      mailDocId: 'tpl-mail-1',
    });

    expect(sent).toBe(true);
    expect(mailWrites).toHaveLength(1);
    expect(mailWrites[0]?.data['to']).toEqual(['sec@orono.k12.mn.us']);
  });

  it('returns false and skips send when recipient is admin but securityAdminEmail is unset', async () => {
    const { db, mailWrites } = fakeDbForTemplatedEmail(
      { ...BASE_TEMPLATE, recipient: 'admin' },
      {},
    );

    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'manual',
      to: 'other@orono.k12.mn.us',
      vars: {},
      mailDocId: 'tpl-mail-2',
    });

    expect(sent).toBe(false);
    expect(mailWrites).toHaveLength(0);
  });

  it('returns false and skips send when recipient is admin but securityAdminEmail is blank', async () => {
    const { db, mailWrites } = fakeDbForTemplatedEmail(
      { ...BASE_TEMPLATE, recipient: 'admin' },
      { securityAdminEmail: '   ' },
    );

    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'manual',
      to: 'other@orono.k12.mn.us',
      vars: {},
      mailDocId: 'tpl-mail-3',
    });

    expect(sent).toBe(false);
    expect(mailWrites).toHaveLength(0);
  });

  it('uses the provided to address unchanged when recipient is not admin', async () => {
    const { db, mailWrites } = fakeDbForTemplatedEmail(
      { ...BASE_TEMPLATE, recipient: 'observed' },
      { securityAdminEmail: 'sec@orono.k12.mn.us' },
    );

    await sendTemplatedEmail({
      db,
      triggerType: 'manual',
      to: 'jane@orono.k12.mn.us',
      vars: {},
      mailDocId: 'tpl-mail-4',
    });

    expect(mailWrites[0]?.data['to']).toEqual(['jane@orono.k12.mn.us']);
  });

  it('returns false when no active template exists for the trigger', async () => {
    const { db, mailWrites } = fakeDbForTemplatedEmail(null, {
      securityAdminEmail: 'sec@orono.k12.mn.us',
    });

    const sent = await sendTemplatedEmail({
      db,
      triggerType: 'manual',
      to: 'jane@orono.k12.mn.us',
      vars: {},
      mailDocId: 'tpl-mail-5',
    });

    expect(sent).toBe(false);
    expect(mailWrites).toHaveLength(0);
  });
});
