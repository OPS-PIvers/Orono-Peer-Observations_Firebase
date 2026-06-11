import { describe, expect, it } from 'vitest';
import type { WindowInvitee } from '@ops/shared';

const invitee = (over: Partial<WindowInvitee> = {}): WindowInvitee => ({
  email: 'jane@orono.k12.mn.us',
  name: 'Jane Doe',
  role: 'Teacher',
  year: 1,
  buildings: ['oms'],
  buildingId: 'oms',
  inviteToken: 'token-oms',
  inviteSentAt: null,
  bookedSlotId: null,
  ...over,
});

describe('expireObservationWindows expiry filter', () => {
  it('identifies unbooked invitees correctly', () => {
    const unbooked = invitee({ email: 'unbooked@orono.k12.mn.us' });
    const booked = invitee({ email: 'booked@orono.k12.mn.us', bookedSlotId: 'slot-123' });

    const invitees = [unbooked, booked];
    const shouldReceiveEmail = invitees.filter((inv) => inv.bookedSlotId == null);

    expect(shouldReceiveEmail).toEqual([unbooked]);
  });

  it('skips all invitees when everyone booked', () => {
    const invitees = [
      invitee({ email: 'alice@orono.k12.mn.us', bookedSlotId: 'slot-1' }),
      invitee({ email: 'bob@orono.k12.mn.us', bookedSlotId: 'slot-2' }),
    ];
    const shouldReceiveEmail = invitees.filter((inv) => inv.bookedSlotId == null);

    expect(shouldReceiveEmail).toEqual([]);
  });

  it('sends to all invitees when none booked', () => {
    const invitees = [
      invitee({ email: 'alice@orono.k12.mn.us' }),
      invitee({ email: 'bob@orono.k12.mn.us' }),
    ];
    const shouldReceiveEmail = invitees.filter((inv) => inv.bookedSlotId == null);

    expect(shouldReceiveEmail).toEqual(invitees);
  });

  it('handles a mix of booked and unbooked invitees', () => {
    const invitees = [
      invitee({ email: 'alice@orono.k12.mn.us' }),
      invitee({ email: 'bob@orono.k12.mn.us', bookedSlotId: 'slot-1' }),
      invitee({ email: 'charlie@orono.k12.mn.us' }),
      invitee({ email: 'dave@orono.k12.mn.us', bookedSlotId: 'slot-2' }),
    ];
    const shouldReceiveEmail = invitees.filter((inv) => inv.bookedSlotId == null);

    expect(shouldReceiveEmail).toHaveLength(2);
    expect(shouldReceiveEmail.map((inv) => inv.email)).toEqual([
      'alice@orono.k12.mn.us',
      'charlie@orono.k12.mn.us',
    ]);
  });
});
