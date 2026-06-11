import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  incompleteReminderMailDocId,
  sendEmail,
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
