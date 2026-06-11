import { describe, expect, it } from 'vitest';
import type { ObservationSlot, SignupField, Staff, WindowInvitee } from '@ops/shared';
import {
  applyDayCountChange,
  bookedSlotObservationIds,
  chicagoDateString,
  dayHasCapacity,
  invalidSignupFieldIds,
  isWindowBookingClosed,
  meetsLeadTime,
  preferenceShouldRevert,
  removeDayCount,
  resolveObservedIdentity,
  unknownAnswerFieldIds,
} from './bookingRules.js';
import { calendarConnectionSatisfied } from '../bookObservationSlot.js';

const HOUR = 60 * 60 * 1000;

const staffDoc = (over: Partial<Staff> = {}): Staff =>
  ({
    name: 'Live Staff',
    role: 'teacher',
    year: 3,
    buildings: ['hs'],
    ...over,
  }) as unknown as Staff;

const inviteeDoc = (over: Partial<WindowInvitee> = {}): WindowInvitee =>
  ({
    name: 'Invitee Snapshot',
    role: 'counselor',
    year: 5,
    buildings: ['ms'],
    ...over,
  }) as unknown as WindowInvitee;

describe('meetsLeadTime', () => {
  const now = Date.UTC(2025, 2, 10, 8, 0, 0);

  it('allows a slot far in the future', () => {
    expect(meetsLeadTime(now + 48 * HOUR, now, 24)).toBe(true);
  });

  it('blocks a slot inside the lead window', () => {
    expect(meetsLeadTime(now + 12 * HOUR, now, 24)).toBe(false);
  });

  it('treats the exact boundary as allowed', () => {
    expect(meetsLeadTime(now + 24 * HOUR, now, 24)).toBe(true);
  });

  it('zero lead time allows booking up to slot start', () => {
    expect(meetsLeadTime(now, now, 0)).toBe(true);
    expect(meetsLeadTime(now - 1, now, 0)).toBe(false);
  });
});

describe('dayHasCapacity', () => {
  it('null cap is always uncapped', () => {
    expect(dayHasCapacity(999, null)).toBe(true);
  });

  it('respects a numeric cap', () => {
    expect(dayHasCapacity(1, 2)).toBe(true);
    expect(dayHasCapacity(2, 2)).toBe(false);
    expect(dayHasCapacity(3, 2)).toBe(false);
  });
});

describe('applyDayCountChange', () => {
  it('increments a brand-new preference', () => {
    expect(applyDayCountChange({}, '2025-03-10', null)).toEqual({ '2025-03-10': 1 });
  });

  it('moves a preference between days', () => {
    expect(
      applyDayCountChange({ '2025-03-10': 2, '2025-03-11': 1 }, '2025-03-11', '2025-03-10'),
    ).toEqual({ '2025-03-10': 1, '2025-03-11': 2 });
  });

  it('is a no-op when the day is unchanged', () => {
    expect(applyDayCountChange({ '2025-03-10': 3 }, '2025-03-10', '2025-03-10')).toEqual({
      '2025-03-10': 3,
    });
  });

  it('never drives a count below zero', () => {
    expect(applyDayCountChange({ '2025-03-10': 0 }, '2025-03-11', '2025-03-10')).toEqual({
      '2025-03-10': 0,
      '2025-03-11': 1,
    });
  });

  it('does not mutate the input', () => {
    const input = { '2025-03-10': 1 };
    applyDayCountChange(input, '2025-03-11', '2025-03-10');
    expect(input).toEqual({ '2025-03-10': 1 });
  });
});

describe('removeDayCount', () => {
  it('decrements the count for the given day', () => {
    expect(removeDayCount({ '2025-03-10': 3 }, '2025-03-10')).toEqual({ '2025-03-10': 2 });
  });

  it('never drives a count below zero', () => {
    expect(removeDayCount({ '2025-03-10': 0 }, '2025-03-10')).toEqual({ '2025-03-10': 0 });
  });

  it('treats a missing key the same as zero', () => {
    expect(removeDayCount({}, '2025-03-10')).toEqual({ '2025-03-10': 0 });
  });

  it('does not mutate the input', () => {
    const input = { '2025-03-10': 2 };
    removeDayCount(input, '2025-03-10');
    expect(input).toEqual({ '2025-03-10': 2 });
  });

  it('does not affect other days in the map', () => {
    expect(removeDayCount({ '2025-03-10': 2, '2025-03-11': 1 }, '2025-03-10')).toEqual({
      '2025-03-10': 1,
      '2025-03-11': 1,
    });
  });
});

describe('chicagoDateString', () => {
  it('formats an instant as the Chicago calendar date', () => {
    // 2025-03-10 06:00Z is still 2025-03-10 in Chicago (CDT, UTC-5).
    expect(chicagoDateString(new Date('2025-03-10T06:00:00Z'))).toBe('2025-03-10');
  });

  it('rolls the date back for instants before Chicago midnight', () => {
    // 2025-03-11 02:00Z is 2025-03-10 21:00 in Chicago.
    expect(chicagoDateString(new Date('2025-03-11T02:00:00Z'))).toBe('2025-03-10');
  });
});

describe('isWindowBookingClosed', () => {
  const now = new Date('2025-03-10T15:00:00Z'); // 2025-03-10 in Chicago

  it('is open on the final day of the window', () => {
    expect(isWindowBookingClosed('2025-03-10', now)).toBe(false);
  });

  it('is open for a window ending in the future', () => {
    expect(isWindowBookingClosed('2025-03-20', now)).toBe(false);
  });

  it('is closed once the end date is strictly before today', () => {
    expect(isWindowBookingClosed('2025-03-09', now)).toBe(true);
  });
});

describe('resolveObservedIdentity', () => {
  it('prefers the live staff doc', () => {
    expect(resolveObservedIdentity('s@orono.k12.mn.us', staffDoc(), inviteeDoc())).toEqual({
      name: 'Live Staff',
      role: 'teacher',
      year: 3,
      buildings: ['hs'],
    });
  });

  it('falls back to the invitee snapshot when the staff doc is missing', () => {
    expect(resolveObservedIdentity('s@orono.k12.mn.us', null, inviteeDoc())).toEqual({
      name: 'Invitee Snapshot',
      role: 'counselor',
      year: 5,
      buildings: ['ms'],
    });
  });

  it('never defaults role/year when an invitee snapshot exists', () => {
    const resolved = resolveObservedIdentity('s@orono.k12.mn.us', null, inviteeDoc());
    expect(resolved.role).not.toBe('unknown');
    expect(resolved.year).not.toBe(1);
  });

  it('uses placeholders only when both sources are absent', () => {
    expect(resolveObservedIdentity('s@orono.k12.mn.us', null, undefined)).toEqual({
      name: 's@orono.k12.mn.us',
      role: 'unknown',
      year: 1,
      buildings: [],
    });
  });
});

describe('bookedSlotObservationIds', () => {
  const slot = (over: Partial<ObservationSlot>): ObservationSlot =>
    ({ status: 'available', observationId: null, ...over }) as unknown as ObservationSlot;

  it('returns observationIds of booked slots only', () => {
    const slots = [
      slot({ status: 'booked', observationId: 'obs-a' }),
      slot({ status: 'available', observationId: null }),
      slot({ status: 'blocked', observationId: null }),
      slot({ status: 'booked', observationId: 'obs-b' }),
    ];
    expect(bookedSlotObservationIds(slots)).toEqual(['obs-a', 'obs-b']);
  });

  it('skips booked slots that never spawned an observation', () => {
    const slots = [slot({ status: 'booked', observationId: null })];
    expect(bookedSlotObservationIds(slots)).toEqual([]);
  });
});

describe('unknownAnswerFieldIds', () => {
  const answer = (fieldId: string) => ({ fieldId });

  it('accepts answers that all reference window-selected fields', () => {
    expect(
      unknownAnswerFieldIds(
        [answer('grade-level'), answer('subject')],
        ['grade-level', 'subject', 'period'],
      ),
    ).toEqual([]);
  });

  it('returns the fieldIds missing from the window selection', () => {
    expect(
      unknownAnswerFieldIds(
        [answer('grade-level'), answer('rogue'), answer('also-rogue')],
        ['grade-level'],
      ),
    ).toEqual(['rogue', 'also-rogue']);
  });

  it('flags every answer when the window selected no fields', () => {
    expect(unknownAnswerFieldIds([answer('grade-level')], [])).toEqual(['grade-level']);
  });

  it('accepts an empty answer list regardless of the selection', () => {
    expect(unknownAnswerFieldIds([], [])).toEqual([]);
    expect(unknownAnswerFieldIds([], ['grade-level'])).toEqual([]);
  });
});

describe('preferenceShouldRevert', () => {
  it('reverts when the preference points at the cancelled slot', () => {
    expect(preferenceShouldRevert('slot-1', 'slot-1')).toBe(true);
  });

  it('does not revert a preference assigned to a different slot', () => {
    expect(preferenceShouldRevert('slot-2', 'slot-1')).toBe(false);
  });

  it('does not revert an unassigned preference', () => {
    expect(preferenceShouldRevert(null, 'slot-1')).toBe(false);
    expect(preferenceShouldRevert(undefined, 'slot-1')).toBe(false);
  });
});

// ── requireCalendarConnect enforcement (day-preference + direct booking) ────
// calendarConnectionSatisfied is the pure guard extracted from the booking
// callables so it can be tested without touching Firestore. Both
// bookObservationSlot and submitDayPreference use it to enforce the admin
// setting before any other validation.

describe('calendarConnectionSatisfied', () => {
  it('returns true when the setting is off, regardless of token status', () => {
    expect(calendarConnectionSatisfied(false, undefined)).toBe(true);
    expect(calendarConnectionSatisfied(false, 'revoked')).toBe(true);
    expect(calendarConnectionSatisfied(false, 'connected')).toBe(true);
  });

  it('returns true when setting is on and the token is connected', () => {
    expect(calendarConnectionSatisfied(true, 'connected')).toBe(true);
  });

  it('returns false when setting is on and the token doc is absent (undefined status)', () => {
    expect(calendarConnectionSatisfied(true, undefined)).toBe(false);
  });

  it('returns false when setting is on and the token is revoked', () => {
    expect(calendarConnectionSatisfied(true, 'revoked')).toBe(false);
  });

  it('returns false when setting is on and the token is in error state', () => {
    expect(calendarConnectionSatisfied(true, 'error')).toBe(false);
  });

  it('returns false when setting is on and status is an unrecognised string', () => {
    expect(calendarConnectionSatisfied(true, 'disconnected')).toBe(false);
  });
});

describe('invalidSignupFieldIds', () => {
  const field = (over: Partial<SignupField>): SignupField =>
    ({
      fieldId: 'field-1',
      label: 'Test',
      type: 'select',
      options: [],
      appliesTo: 'both',
      required: false,
      order: 0,
      isActive: true,
      createdAt: '2025-03-10T00:00:00Z',
      updatedAt: '2025-03-10T00:00:00Z',
      ...over,
    }) as unknown as SignupField;

  it('accepts field ids that are active and applicable to the mode', () => {
    const fields = [
      field({ fieldId: 'grade', appliesTo: 'both' }),
      field({ fieldId: 'period', appliesTo: 'direct' }),
    ];
    expect(invalidSignupFieldIds(['grade', 'period'], fields, 'direct')).toEqual([]);
  });

  it('rejects field ids that are inactive', () => {
    const fields = [field({ fieldId: 'grade', isActive: false })];
    expect(invalidSignupFieldIds(['grade'], fields, 'direct')).toEqual(['grade']);
  });

  it('rejects field ids not applicable to the requested mode', () => {
    const fields = [field({ fieldId: 'period', appliesTo: 'day-preference' })];
    expect(invalidSignupFieldIds(['period'], fields, 'direct')).toEqual(['period']);
  });

  it('accepts fields applicable to both modes regardless of the mode', () => {
    const fields = [field({ fieldId: 'grade', appliesTo: 'both' })];
    expect(invalidSignupFieldIds(['grade'], fields, 'direct')).toEqual([]);
    expect(invalidSignupFieldIds(['grade'], fields, 'day-preference')).toEqual([]);
  });

  it('returns unknown field ids', () => {
    const fields = [field({ fieldId: 'grade' })];
    expect(invalidSignupFieldIds(['grade', 'unknown'], fields, 'direct')).toEqual(['unknown']);
  });

  it('accepts an empty requested field list', () => {
    const fields = [field({ fieldId: 'grade' })];
    expect(invalidSignupFieldIds([], fields, 'direct')).toEqual([]);
  });

  it('returns all fields when none are available', () => {
    expect(invalidSignupFieldIds(['grade', 'period'], [], 'direct')).toEqual(['grade', 'period']);
  });

  it('handles mixed valid and invalid ids', () => {
    const fields = [
      field({ fieldId: 'grade', appliesTo: 'both' }),
      field({ fieldId: 'period', appliesTo: 'direct', isActive: false }),
    ];
    expect(invalidSignupFieldIds(['grade', 'period', 'unknown'], fields, 'direct')).toEqual([
      'period',
      'unknown',
    ]);
  });
});
