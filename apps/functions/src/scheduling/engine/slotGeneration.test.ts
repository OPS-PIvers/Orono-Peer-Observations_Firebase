import { describe, expect, it, vi } from 'vitest';
import { generateSlotsForWindow, localMinuteToUTC, type SlotInput } from './slotGeneration.js';
import type { BuildingSchedule, ObservationWindow } from '@ops/shared';

// Mock Firebase + Google modules so `onBuildingScheduleWritten.js` can be
// imported for the pure `classifyBookedSlot` helper without its top-level
// initializeApp() / onDocumentWritten() / defineSecret() side-effects firing.
vi.mock('firebase-admin/app', () => ({ getApps: () => [], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => {
  // `Timestamp` must be callable for `value instanceof Timestamp` in the
  // module under test; the tests only ever pass plain Dates so the branch is
  // never taken. `fromDate` is the identity (Dates flow straight through).
  const Timestamp = Object.assign(vi.fn(), { fromDate: (d: Date) => d });
  return { FieldValue: { serverTimestamp: vi.fn() }, Timestamp, getFirestore: vi.fn() };
});
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: vi.fn() }));
vi.mock('firebase-functions/params', () => ({
  defineString: () => ({ value: () => '' }),
  defineSecret: () => ({ value: () => '' }),
}));
vi.mock('firebase-functions/v2/https', () => ({ onCall: vi.fn(), HttpsError: Error }));
vi.mock('firebase-functions', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('googleapis', () => ({ google: { auth: { OAuth2: vi.fn() }, calendar: vi.fn() } }));
vi.mock('google-auth-library', () => ({ OAuth2Client: vi.fn() }));

// Imported after the mocks above so the trigger module's side-effects no-op.
const { classifyBookedSlot } = await import('../onBuildingScheduleWritten.js');
const { freeBusyToIntervals, resolveSlotBlocking } = await import('./blocking.js');

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

describe('classifyBookedSlot (schedule-change reconcile of a booked slot)', () => {
  const slotId = `${BUILDING}-2025-06-02-p1`;
  const baseStart = new Date('2025-06-02T13:00:00.000Z');
  const baseEnd = new Date('2025-06-02T13:50:00.000Z');

  function makeBooked(
    overrides: Partial<Pick<SlotInput, 'startUTC' | 'endUTC' | 'startMinute'>> = {},
  ) {
    return {
      slotId,
      startUTC: baseStart,
      endUTC: baseEnd,
      startMinute: 8 * 60,
      ...overrides,
    };
  }

  function makeWant(
    overrides: Partial<Pick<SlotInput, 'startUTC' | 'endUTC' | 'startMinute'>> = {},
  ): SlotInput {
    return {
      slotId,
      windowId: 'w1',
      buildingId: BUILDING,
      dateYMD: '2025-06-02',
      dayTypeId: 'regular',
      periodId: 'p1',
      periodName: 'Period 1',
      startUTC: baseStart,
      endUTC: baseEnd,
      startMinute: 8 * 60,
      status: 'available',
      blockedReason: null,
      bookedBy: null,
      bookedAt: null,
      observationId: null,
      ...overrides,
    };
  }

  it('returns null when the period is unchanged', () => {
    expect(classifyBookedSlot(makeBooked(), makeWant())).toBeNull();
  });

  it('flags period-removed when the slot no longer generates', () => {
    expect(classifyBookedSlot(makeBooked(), undefined)).toEqual({
      kind: 'period-removed',
      slotId,
    });
  });

  it('flags time-changed when the start instant moved', () => {
    const want = makeWant({
      startUTC: new Date('2025-06-02T13:15:00.000Z'),
      startMinute: 8 * 60 + 15,
    });
    const action = classifyBookedSlot(makeBooked(), want);
    expect(action?.kind).toBe('time-changed');
    expect(action?.kind === 'time-changed' && action.want.startUTC.toISOString()).toBe(
      '2025-06-02T13:15:00.000Z',
    );
  });

  it('flags time-changed when only the end instant moved', () => {
    const want = makeWant({ endUTC: new Date('2025-06-02T14:00:00.000Z') });
    expect(classifyBookedSlot(makeBooked(), want)?.kind).toBe('time-changed');
  });

  it('flags time-changed when only startMinute drifts (same instants)', () => {
    // Same UTC instants but a different local minute-of-day still counts as a
    // change so the stored ordering field is corrected.
    const want = makeWant({ startMinute: 8 * 60 + 1 });
    expect(classifyBookedSlot(makeBooked(), want)?.kind).toBe('time-changed');
  });
});

describe('freeBusyToIntervals (calendar → ledger mapping)', () => {
  it('maps each busy block to a synthetic, collision-proof slotId', () => {
    const intervals = freeBusyToIntervals([
      { start: new Date('2025-06-02T15:00:00.000Z'), end: new Date('2025-06-02T16:00:00.000Z') },
      { start: new Date('2025-06-03T14:00:00.000Z'), end: new Date('2025-06-03T14:30:00.000Z') },
    ]);
    expect(intervals.map((i) => i.slotId)).toEqual(['observer-busy-0', 'observer-busy-1']);
    expect(intervals[0]?.startUTC.toISOString()).toBe('2025-06-02T15:00:00.000Z');
    expect(intervals[1]?.endUTC.toISOString()).toBe('2025-06-03T14:30:00.000Z');
  });

  it('returns an empty ledger for an empty free/busy result', () => {
    expect(freeBusyToIntervals([])).toEqual([]);
  });
});

describe('resolveSlotBlocking (pe-conflict + observer-busy precedence)', () => {
  // A 09:00–09:50 UTC slot for these cases.
  const slotStart = new Date('2025-06-02T09:00:00.000Z');
  const slotEnd = new Date('2025-06-02T09:50:00.000Z');
  const slotId = `${BUILDING}-2025-06-02-p2`;

  it('leaves a free slot available when there is no busy ledger', () => {
    expect(resolveSlotBlocking(slotStart, slotEnd, slotId, [], [], 0)).toEqual({
      status: 'available',
      blockedReason: null,
    });
  });

  it('blocks observer-busy when the calendar overlaps and there is no pe-conflict', () => {
    const observerBusy = freeBusyToIntervals([
      { start: new Date('2025-06-02T09:30:00.000Z'), end: new Date('2025-06-02T10:30:00.000Z') },
    ]);
    expect(resolveSlotBlocking(slotStart, slotEnd, slotId, [], observerBusy, 15)).toEqual({
      status: 'blocked',
      blockedReason: 'observer-busy',
    });
  });

  it('does not block when the calendar event only abuts the slot (zero buffer)', () => {
    // Calendar event starts exactly when the slot ends → adjacency, no overlap.
    const observerBusy = freeBusyToIntervals([
      { start: new Date('2025-06-02T09:50:00.000Z'), end: new Date('2025-06-02T10:30:00.000Z') },
    ]);
    expect(resolveSlotBlocking(slotStart, slotEnd, slotId, [], observerBusy, 15)).toEqual({
      status: 'available',
      blockedReason: null,
    });
  });

  it('prefers pe-conflict over observer-busy when both overlap', () => {
    const peBusy = [
      {
        slotId: `${BUILDING}-2025-06-02-other`,
        startUTC: new Date('2025-06-02T09:10:00.000Z'),
        endUTC: new Date('2025-06-02T09:40:00.000Z'),
      },
    ];
    const observerBusy = freeBusyToIntervals([
      { start: new Date('2025-06-02T09:00:00.000Z'), end: new Date('2025-06-02T10:00:00.000Z') },
    ]);
    expect(resolveSlotBlocking(slotStart, slotEnd, slotId, peBusy, observerBusy, 0)).toEqual({
      status: 'blocked',
      blockedReason: 'pe-conflict',
    });
  });

  it('ignores the observer calendar entirely when observerBusy is null (skip mode)', () => {
    expect(resolveSlotBlocking(slotStart, slotEnd, slotId, [], null, 0)).toEqual({
      status: 'available',
      blockedReason: null,
    });
  });

  it('skips the slot interval that shares its own id on the pe-conflict ledger', () => {
    // A slot is allowed to appear in the ledger as its own booking; that entry
    // must be ignored so a booked slot isn't reported as conflicting with
    // itself. Here the only pe-busy entry IS this slot, so no conflict.
    const peBusy = [{ slotId, startUTC: slotStart, endUTC: slotEnd }];
    expect(resolveSlotBlocking(slotStart, slotEnd, slotId, peBusy, [], 0)).toEqual({
      status: 'available',
      blockedReason: null,
    });
  });
});
