import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS, type ObservationWindow } from '@ops/shared';
import { deriveCheckpoints } from './deriveCheckpoints';
import type { DeriveContext } from './dashboardEvents';
import {
  DASHBOARD_WINDOW_STATUSES,
  schoolYearStartYmd,
  summarizeWindowBookings,
} from './windowBooking';

const ME = 'teacher@orono.k12.mn.us';
const NOW = new Date('2026-03-01T12:00:00');

function win(partial: {
  status: ObservationWindow['status'];
  bookedSlotId?: string | null;
  endDate?: string;
  windowId?: string;
  email?: string;
}): ObservationWindow {
  return {
    windowId: partial.windowId ?? 'w1',
    status: partial.status,
    endDate: partial.endDate ?? '2026-03-10',
    invitees: [
      {
        email: partial.email ?? ME,
        inviteToken: 'tok',
        bookedSlotId: partial.bookedSlotId ?? null,
      },
    ],
  } as unknown as ObservationWindow;
}

describe('DASHBOARD_WINDOW_STATUSES', () => {
  it('subscribes to fully-booked and expired windows, never cancelled', () => {
    expect(DASHBOARD_WINDOW_STATUSES).toContain('fully-booked');
    expect(DASHBOARD_WINDOW_STATUSES).toContain('expired');
    expect(DASHBOARD_WINDOW_STATUSES).not.toContain('cancelled');
  });
});

describe('summarizeWindowBookings', () => {
  it('counts a booking in a fully-booked window (regression: sign-up step vanished)', () => {
    const result = summarizeWindowBookings(
      [win({ status: 'fully-booked', bookedSlotId: 's1' })],
      ME,
      NOW,
    );
    expect(result.hasBookedSlot).toBe(true);
    expect(result.openBooking).toBeNull();

    // End to end: the sign-up step shows as done rather than disappearing.
    const ctx = {
      finalizedStandard: [],
      standardDraft: null,
      workProductDraft: null,
      instructionalRoundDraft: null,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      questions: [],
      appSettings: null,
      hasWorkProduct: false,
      hasInstructionalRound: false,
      ...result,
    } satisfies DeriveContext;
    expect(deriveCheckpoints(DEFAULT_STEPS, ctx, NOW).find((c) => c.id === 'signup')?.status).toBe(
      'done',
    );
  });

  it('counts a booking in a window that has since expired', () => {
    expect(
      summarizeWindowBookings([win({ status: 'expired', bookedSlotId: 's1' })], ME, NOW)
        .hasBookedSlot,
    ).toBe(true);
  });

  it('ignores a booking from a previous school year', () => {
    expect(
      summarizeWindowBookings(
        [win({ status: 'fully-booked', bookedSlotId: 's1', endDate: '2025-05-01' })],
        ME,
        NOW,
      ).hasBookedSlot,
    ).toBe(false);
  });

  it('offers the booking CTA only for windows that are still bookable', () => {
    expect(summarizeWindowBookings([win({ status: 'open' })], ME, NOW).openBooking).toEqual({
      windowId: 'w1',
      token: 'tok',
      endDate: new Date('2026-03-10T12:00:00'),
    });
    expect(
      summarizeWindowBookings([win({ status: 'partially-booked' })], ME, NOW).openBooking,
    ).not.toBeNull();
    // An unbooked invite in a window nobody can book any more is not a CTA.
    expect(
      summarizeWindowBookings([win({ status: 'fully-booked' })], ME, NOW).openBooking,
    ).toBeNull();
    expect(summarizeWindowBookings([win({ status: 'expired' })], ME, NOW).openBooking).toBeNull();
  });

  it('matches the invitee case-insensitively and ignores other invitees', () => {
    expect(
      summarizeWindowBookings(
        [win({ status: 'open', bookedSlotId: 's1', email: 'Teacher@Orono.k12.mn.us' })],
        ME,
        NOW,
      ).hasBookedSlot,
    ).toBe(true);
    expect(
      summarizeWindowBookings(
        [win({ status: 'open', bookedSlotId: 's1', email: 'other@orono.k12.mn.us' })],
        ME,
        NOW,
      ).hasBookedSlot,
    ).toBe(false);
  });
});

describe('schoolYearStartYmd', () => {
  it('starts the school year on Aug 1', () => {
    expect(schoolYearStartYmd(new Date('2026-03-01T12:00:00'))).toBe('2025-08-01');
    expect(schoolYearStartYmd(new Date('2026-09-14T12:00:00'))).toBe('2026-08-01');
  });
});
