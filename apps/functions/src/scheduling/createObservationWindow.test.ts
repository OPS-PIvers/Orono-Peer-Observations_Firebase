import { describe, expect, it } from 'vitest';
import type { WindowInvitee } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in createObservationWindow.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { inviteeEntryKey, stampInviteSentAt, windowInviteMailDocId } =
  await import('./createObservationWindow.js');

const invitee = (over: Partial<WindowInvitee> = {}): WindowInvitee => ({
  email: 'jane@orono.k12.mn.us',
  name: 'Jane Doe',
  role: 'Teacher',
  year: 1,
  buildings: ['oms', 'ohs'],
  buildingId: 'oms',
  inviteToken: 'token-oms',
  inviteSentAt: null,
  bookedSlotId: null,
  ...over,
});

describe('inviteeEntryKey', () => {
  it('distinguishes the same email invited at two buildings', () => {
    expect(inviteeEntryKey('jane@orono.k12.mn.us', 'oms')).not.toBe(
      inviteeEntryKey('jane@orono.k12.mn.us', 'ohs'),
    );
  });

  it('is stable for the same email + building', () => {
    expect(inviteeEntryKey('jane@orono.k12.mn.us', 'oms')).toBe(
      inviteeEntryKey('jane@orono.k12.mn.us', 'oms'),
    );
  });
});

describe('windowInviteMailDocId', () => {
  it('produces two distinct mail doc ids for one email invited at two buildings', () => {
    expect(windowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms')).not.toBe(
      windowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'ohs'),
    );
  });

  it('is stable for the same window + entry (idempotent on retry)', () => {
    expect(windowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms')).toBe(
      windowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms'),
    );
  });

  it('embeds the window id, email, and building id', () => {
    expect(windowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms')).toBe(
      'scheduling.windowInvite-w1-jane@orono.k12.mn.us-oms',
    );
  });
});

describe('stampInviteSentAt', () => {
  const sentAt = new Date('2026-06-10T12:00:00Z');

  it('stamps only the entry whose invite was sent when one email has two entries', () => {
    const invitees = [invitee(), invitee({ buildingId: 'ohs', inviteToken: 'token-ohs' })];
    const sentKeys = new Set([inviteeEntryKey('jane@orono.k12.mn.us', 'ohs')]);

    const stamped = stampInviteSentAt(invitees, sentKeys, sentAt);

    expect(stamped[0]?.inviteSentAt).toBeNull();
    expect(stamped[1]?.inviteSentAt).toBe(sentAt);
  });

  it('stamps every entry when both sends succeed', () => {
    const invitees = [invitee(), invitee({ buildingId: 'ohs', inviteToken: 'token-ohs' })];
    const sentKeys = new Set([
      inviteeEntryKey('jane@orono.k12.mn.us', 'oms'),
      inviteeEntryKey('jane@orono.k12.mn.us', 'ohs'),
    ]);

    const stamped = stampInviteSentAt(invitees, sentKeys, sentAt);

    expect(stamped.map((inv) => inv.inviteSentAt)).toEqual([sentAt, sentAt]);
  });

  it('does not mutate the input entries', () => {
    const original = invitee();
    const stamped = stampInviteSentAt(
      [original],
      new Set([inviteeEntryKey(original.email, original.buildingId)]),
      sentAt,
    );

    expect(original.inviteSentAt).toBeNull();
    expect(stamped[0]).not.toBe(original);
  });
});
