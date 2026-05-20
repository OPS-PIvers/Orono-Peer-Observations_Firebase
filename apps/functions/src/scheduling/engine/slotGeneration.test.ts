import { describe, expect, it } from 'vitest';
import { generateSlotsForWindow, localMinuteToUTC } from './slotGeneration.js';
import type { BuildingSchedule, ObservationWindow } from '@ops/shared';

const BUILDING = 'main-school';

function makeSchedule(overrides: Partial<BuildingSchedule> = {}): BuildingSchedule {
  return {
    buildingId: BUILDING,
    timeZone: 'America/Chicago',
    dayTypes: [
      {
        dayTypeId: 'regular',
        name: 'Regular Day',
        isNoSchool: false,
        periods: [
          {
            periodId: 'p1',
            name: 'Period 1',
            startMinute: 8 * 60,
            endMinute: 8 * 60 + 50,
            order: 0,
          },
          {
            periodId: 'p2',
            name: 'Period 2',
            startMinute: 9 * 60,
            endMinute: 9 * 60 + 50,
            order: 1,
          },
          {
            periodId: 'p3',
            name: 'Period 3',
            startMinute: 13 * 60,
            endMinute: 13 * 60 + 50,
            order: 2,
          },
        ],
      },
      { dayTypeId: 'noschool', name: 'No School', isNoSchool: true, periods: [] },
    ],
    weeklyPattern: {
      mon: 'regular',
      tue: 'regular',
      wed: 'regular',
      thu: 'regular',
      fri: 'regular',
    },
    overrides: [],
    effectiveFrom: null,
    effectiveTo: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeWindow(overrides: Partial<ObservationWindow> = {}): ObservationWindow {
  return {
    windowId: 'w1',
    observerEmail: 'pe@example.com',
    observerName: 'PE',
    bookingMode: 'direct',
    invitedEmails: ['teacher@example.com'],
    invitees: [
      {
        email: 'teacher@example.com',
        name: 'Teacher',
        role: 'Teacher',
        year: 1,
        buildings: [BUILDING],
        buildingId: BUILDING,
        inviteToken: 'tok',
        inviteSentAt: null,
        bookedSlotId: null,
      },
    ],
    startDate: '2025-06-02', // Monday
    endDate: '2025-06-06', // Friday
    weekdaysIncluded: [1, 2, 3, 4, 5],
    earliestMinute: 0,
    latestMinute: 1439,
    travelBufferMinutes: 15,
    perDayCap: null,
    dayCounts: {},
    peBusyIntervals: [],
    signupFieldIds: [],
    defaultObservationType: 'Standard',
    defaultObservationName: '',
    calendarEventTitle: '',
    calendarEventDescription: '',
    gcalSendUpdates: 'none',
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: '',
    ...overrides,
  };
}

const schedMap = (s: BuildingSchedule) => new Map([[s.buildingId, s]]);

describe('localMinuteToUTC (DST-safe composition)', () => {
  it('composes a CST date (November, UTC-6)', () => {
    // 2025-11-10 is after the fall-back, so Chicago = CST = UTC-6.
    // 09:00 local → 15:00 UTC.
    const d = localMinuteToUTC('2025-11-10', 9 * 60, 'America/Chicago');
    expect(d.toISOString()).toBe('2025-11-10T15:00:00.000Z');
  });

  it('composes a CDT date (March, UTC-5)', () => {
    // 2025-03-31 is after spring-forward, so Chicago = CDT = UTC-5.
    // 09:00 local → 14:00 UTC.
    const d = localMinuteToUTC('2025-03-31', 9 * 60, 'America/Chicago');
    expect(d.toISOString()).toBe('2025-03-31T14:00:00.000Z');
  });
});

describe('generateSlotsForWindow', () => {
  it('produces deterministic slot ids and ordering', () => {
    const slots = generateSlotsForWindow(makeWindow(), schedMap(makeSchedule()));
    // 5 weekdays * 3 periods
    expect(slots).toHaveLength(15);
    const mondaySlots = slots.filter((s) => s.dateYMD === '2025-06-02');
    expect(mondaySlots.map((s) => s.slotId)).toEqual([
      `${BUILDING}-2025-06-02-p1`,
      `${BUILDING}-2025-06-02-p2`,
      `${BUILDING}-2025-06-02-p3`,
    ]);
    // running twice yields identical ids
    const again = generateSlotsForWindow(makeWindow(), schedMap(makeSchedule()));
    expect(again.map((s) => s.slotId)).toEqual(slots.map((s) => s.slotId));
  });

  it('filters by weekday', () => {
    const slots = generateSlotsForWindow(
      makeWindow({ weekdaysIncluded: [1] }), // Mondays only
      schedMap(makeSchedule()),
    );
    expect(new Set(slots.map((s) => s.dateYMD))).toEqual(new Set(['2025-06-02']));
  });

  it('respects time-of-day window intersection', () => {
    // Only periods fully within 8:00–10:00 → p1 and p2, not p3 (13:00).
    const slots = generateSlotsForWindow(
      makeWindow({ earliestMinute: 8 * 60, latestMinute: 10 * 60, weekdaysIncluded: [1] }),
      schedMap(makeSchedule()),
    );
    expect(slots.map((s) => s.periodId)).toEqual(['p1', 'p2']);
  });

  it('applies override precedence: explicit no-school date is skipped', () => {
    const sched = makeSchedule({
      overrides: [{ date: '2025-06-02', dayTypeId: null, note: 'Holiday' }],
    });
    const slots = generateSlotsForWindow(makeWindow({ weekdaysIncluded: [1, 2] }), schedMap(sched));
    expect(slots.some((s) => s.dateYMD === '2025-06-02')).toBe(false);
    expect(slots.some((s) => s.dateYMD === '2025-06-03')).toBe(true);
  });

  it('skips dayTypes flagged isNoSchool via weekly pattern', () => {
    const sched = makeSchedule({
      weeklyPattern: {
        mon: 'noschool',
        tue: 'regular',
        wed: 'regular',
        thu: 'regular',
        fri: 'regular',
      },
    });
    const slots = generateSlotsForWindow(makeWindow({ weekdaysIncluded: [1, 2] }), schedMap(sched));
    expect(slots.some((s) => s.dateYMD === '2025-06-02')).toBe(false); // Monday no-school
    expect(slots.some((s) => s.dateYMD === '2025-06-03')).toBe(true);
  });

  it('skips buildings without a schedule', () => {
    const slots = generateSlotsForWindow(makeWindow(), new Map());
    expect(slots).toHaveLength(0);
  });

  it('respects effectiveFrom / effectiveTo bounds', () => {
    const sched = makeSchedule({ effectiveFrom: '2025-06-04', effectiveTo: '2025-06-05' });
    const slots = generateSlotsForWindow(makeWindow(), schedMap(sched));
    expect(new Set(slots.map((s) => s.dateYMD))).toEqual(new Set(['2025-06-04', '2025-06-05']));
  });

  it('composes correct UTC across a DST boundary date (March)', () => {
    const win = makeWindow({
      startDate: '2025-03-31',
      endDate: '2025-03-31',
      weekdaysIncluded: [1],
    });
    const slots = generateSlotsForWindow(win, schedMap(makeSchedule()));
    const p1 = slots.find((s) => s.periodId === 'p1');
    // 08:00 CDT → 13:00 UTC
    expect(p1?.startUTC.toISOString()).toBe('2025-03-31T13:00:00.000Z');
  });

  it('composes correct UTC across a CST boundary date (November)', () => {
    const win = makeWindow({
      startDate: '2025-11-10',
      endDate: '2025-11-10',
      weekdaysIncluded: [1],
    });
    const slots = generateSlotsForWindow(win, schedMap(makeSchedule()));
    const p1 = slots.find((s) => s.periodId === 'p1');
    // 08:00 CST → 14:00 UTC
    expect(p1?.startUTC.toISOString()).toBe('2025-11-10T14:00:00.000Z');
  });
});
