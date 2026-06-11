import { describe, expect, it } from 'vitest';
import type { ObservationSlot, WindowInvitee } from '@ops/shared';

// Set fake env to satisfy the Firebase Admin/Functions initializers that run
// at module scope in cancelObservationWindow.ts before the import fires.
process.env['FIREBASE_CONFIG'] = JSON.stringify({ projectId: 'test' });
process.env['GCLOUD_PROJECT'] = 'test';
const {
  bookedSlots,
  clearInviteeBookings,
  nonBookedInvitees,
  windowCancelBookingMailDocId,
  windowCancelledNoticeMailDocId,
} = await import('./cancelObservationWindow.js');

const slot = (over: Partial<ObservationSlot> = {}): ObservationSlot =>
  ({
    slotId: 'slot-1',
    buildingId: 'oms',
    periodName: 'Period 1',
    status: 'available',
    bookedBy: null,
    observationId: null,
    ...over,
  }) as unknown as ObservationSlot;

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

describe('bookedSlots', () => {
  it('returns only the slots holding a live booking', () => {
    const booked = slot({ slotId: 'slot-b', status: 'booked', bookedBy: 'jane@orono.k12.mn.us' });
    const slots = [
      slot({ slotId: 'slot-a' }),
      booked,
      slot({ slotId: 'slot-c', status: 'blocked' }),
    ];
    expect(bookedSlots(slots)).toEqual([booked]);
  });

  it('is empty when nothing is booked', () => {
    expect(bookedSlots([slot(), slot({ status: 'blocked' })])).toEqual([]);
  });
});

describe('clearInviteeBookings', () => {
  it('clears the booking pointer on booked invitees only', () => {
    const invitees = [
      invitee({ bookedSlotId: 'slot-1' }),
      invitee({ email: 'sam@orono.k12.mn.us', bookedSlotId: null }),
    ];

    const cleared = clearInviteeBookings(invitees);

    expect(cleared.map((inv) => inv.bookedSlotId)).toEqual([null, null]);
    expect(cleared[1]).toBe(invitees[1]); // untouched entries pass through as-is
  });

  it('does not mutate the input entries', () => {
    const original = invitee({ bookedSlotId: 'slot-1' });
    const cleared = clearInviteeBookings([original]);

    expect(original.bookedSlotId).toBe('slot-1');
    expect(cleared[0]).not.toBe(original);
  });
});

describe('nonBookedInvitees', () => {
  it('returns only invitees without a booking', () => {
    const unbooked = invitee({ email: 'sam@orono.k12.mn.us' });
    const invitees = [invitee({ bookedSlotId: 'slot-1' }), unbooked];
    expect(nonBookedInvitees(invitees)).toEqual([unbooked]);
  });

  it('is empty when every invitee booked', () => {
    expect(nonBookedInvitees([invitee({ bookedSlotId: 'slot-1' })])).toEqual([]);
  });
});

describe('windowCancelBookingMailDocId', () => {
  it('is stable for the same window + slot (idempotent on retry)', () => {
    expect(windowCancelBookingMailDocId('w1', 'slot-1')).toBe(
      windowCancelBookingMailDocId('w1', 'slot-1'),
    );
  });

  it('embeds the window and slot ids with a window-cancel discriminator', () => {
    // The suffix keeps it from colliding with cancelBooking's
    // Date.now()-suffixed ids for the same slot.
    expect(windowCancelBookingMailDocId('w1', 'slot-1')).toBe(
      'scheduling.bookingCancelled-w1-slot-1-window-cancel',
    );
  });

  it('distinguishes slots within one window', () => {
    expect(windowCancelBookingMailDocId('w1', 'slot-1')).not.toBe(
      windowCancelBookingMailDocId('w1', 'slot-2'),
    );
  });
});

describe('windowCancelledNoticeMailDocId', () => {
  it('produces two distinct ids for one email invited at two buildings', () => {
    expect(windowCancelledNoticeMailDocId('w1', 'jane@orono.k12.mn.us', 'oms')).not.toBe(
      windowCancelledNoticeMailDocId('w1', 'jane@orono.k12.mn.us', 'ohs'),
    );
  });

  it('is stable for the same window + invitee entry', () => {
    expect(windowCancelledNoticeMailDocId('w1', 'jane@orono.k12.mn.us', 'oms')).toBe(
      windowCancelledNoticeMailDocId('w1', 'jane@orono.k12.mn.us', 'oms'),
    );
  });

  it('embeds the window id, email, and building id', () => {
    expect(windowCancelledNoticeMailDocId('w1', 'jane@orono.k12.mn.us', 'oms')).toBe(
      'scheduling.windowCancelled-w1-jane@orono.k12.mn.us-oms',
    );
  });
});
