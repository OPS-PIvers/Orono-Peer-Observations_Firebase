import { describe, expect, it } from 'vitest';
import type { WindowInvitee } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in resendWindowInvite.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const { findInvitee, stampResentInvitee } = await import('./resendWindowInvite.js');
const { resendWindowInviteMailDocId } = await import('../lib/emailUtils.js');

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

describe('findInvitee', () => {
  it('matches the right entry when one email is invited at two buildings', () => {
    const omsEntry = invitee();
    const ohsEntry = invitee({ buildingId: 'ohs', inviteToken: 'token-ohs' });
    const invitees = [omsEntry, ohsEntry];

    expect(findInvitee(invitees, 'jane@orono.k12.mn.us', 'ohs')).toBe(ohsEntry);
    expect(findInvitee(invitees, 'jane@orono.k12.mn.us', 'oms')).toBe(omsEntry);
  });

  it('returns undefined when no entry matches the email + building', () => {
    expect(findInvitee([invitee()], 'jane@orono.k12.mn.us', 'ohs')).toBeUndefined();
    expect(findInvitee([invitee()], 'sam@orono.k12.mn.us', 'oms')).toBeUndefined();
  });
});

describe('stampResentInvitee', () => {
  const sentAt = new Date('2026-06-11T12:00:00Z');

  it('stamps only the matching entry when one email has two entries', () => {
    const invitees = [invitee(), invitee({ buildingId: 'ohs', inviteToken: 'token-ohs' })];

    const stamped = stampResentInvitee(invitees, 'jane@orono.k12.mn.us', 'ohs', sentAt);

    expect(stamped[0]?.inviteSentAt).toBeNull();
    expect(stamped[1]?.inviteSentAt).toBe(sentAt);
  });

  it('does not mutate the input entries', () => {
    const original = invitee({ inviteSentAt: null });
    const stamped = stampResentInvitee([original], original.email, original.buildingId, sentAt);

    expect(original.inviteSentAt).toBeNull();
    expect(stamped[0]).not.toBe(original);
    expect(stamped[0]?.inviteSentAt).toBe(sentAt);
  });

  it('passes through entries that do not match', () => {
    const other = invitee({ email: 'sam@orono.k12.mn.us', inviteSentAt: null });
    const stamped = stampResentInvitee([other], 'jane@orono.k12.mn.us', 'oms', sentAt);

    expect(stamped[0]).toBe(other);
  });
});

describe('resendWindowInviteMailDocId', () => {
  it('produces distinct ids for the same entry resent at two different times', () => {
    expect(resendWindowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms', 1000)).not.toBe(
      resendWindowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms', 2000),
    );
  });

  it('distinguishes one email resent at two buildings at the same instant', () => {
    expect(resendWindowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms', 1000)).not.toBe(
      resendWindowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'ohs', 1000),
    );
  });

  it('never collides with the original static windowInvite id', () => {
    // createObservationWindow.windowInviteMailDocId is
    // `scheduling.windowInvite-{windowId}-{email}-{building}` (no -resend, no ts).
    const resendId = resendWindowInviteMailDocId('w1', 'jane@orono.k12.mn.us', 'oms', 1000);
    expect(resendId).toBe('scheduling.windowInvite-resend-w1-jane@orono.k12.mn.us-oms-1000');
    expect(resendId).not.toBe('scheduling.windowInvite-w1-jane@orono.k12.mn.us-oms');
  });
});
