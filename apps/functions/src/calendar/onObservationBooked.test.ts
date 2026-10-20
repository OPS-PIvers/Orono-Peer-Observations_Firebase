import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));

import { isNewBookingForCalendar } from './onObservationBooked.js';

const START = new Date('2026-10-21T14:00:00Z');
const END = new Date('2026-10-21T14:50:00Z');
const booked = {
  windowId: 'w1',
  scheduledStartAt: START,
  scheduledEndAt: END,
  gcalEventIds: {},
  scriptDoc: null,
};

describe('isNewBookingForCalendar', () => {
  it('creates events for a newly created booked observation', () => {
    expect(isNewBookingForCalendar(null, booked)).toBe(true);
  });

  it('skips an autosave on a booking that already had its chance', () => {
    expect(
      isNewBookingForCalendar(booked, { ...booked, scriptDoc: { type: 'doc', content: [] } }),
    ).toBe(false);
  });

  it('creates events when an existing observation is first given a slot', () => {
    expect(
      isNewBookingForCalendar({ windowId: null, scheduledStartAt: null, gcalEventIds: {} }, booked),
    ).toBe(true);
  });

  it('creates events again after a reschedule moves the time', () => {
    const moved = new Date('2026-10-22T14:00:00Z');
    expect(isNewBookingForCalendar(booked, { ...booked, scheduledStartAt: moved })).toBe(true);
  });

  it('creates events again when the event ids were cleared', () => {
    expect(isNewBookingForCalendar({ ...booked, gcalEventIds: { observer: 'e1' } }, booked)).toBe(
      true,
    );
  });

  it('treats equal instants in different encodings as unchanged', () => {
    const asTimestamp = { toDate: () => new Date(START) };
    expect(isNewBookingForCalendar({ ...booked, scheduledStartAt: asTimestamp }, booked)).toBe(
      false,
    );
  });
});
