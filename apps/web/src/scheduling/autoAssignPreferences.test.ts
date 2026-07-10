import { describe, expect, it } from 'vitest';
import type { ObservationWindow, PeBusyInterval } from '@ops/shared';
import { buildAutoAssignPlan, type PreferenceDoc, type SlotDoc } from './autoAssignPreferences';

function makePref(overrides: Partial<PreferenceDoc> = {}): PreferenceDoc {
  return {
    id: 'jane.doe@orono.k12.mn.us',
    email: 'jane.doe@orono.k12.mn.us',
    name: 'Jane Doe',
    buildingId: 'intermediate-school',
    preferredDateYMD: '2026-08-10',
    detailAnswers: [],
    submittedAt: new Date('2026-07-01T00:00:00.000Z'),
    assignedSlotId: null,
    assignedAt: null,
    ...overrides,
  };
}

function makeSlot(overrides: Partial<SlotDoc> = {}): SlotDoc {
  return {
    id: 'slot-1',
    slotId: 'slot-1',
    windowId: 'window-1',
    buildingId: 'intermediate-school',
    dateYMD: '2026-08-10',
    dayTypeId: 'a-day',
    periodId: 'period-1',
    periodName: 'Period 1',
    startUTC: new Date('2026-08-10T13:00:00.000Z'),
    endUTC: new Date('2026-08-10T13:50:00.000Z'),
    startMinute: 480,
    status: 'available',
    blockedReason: null,
    bookedBy: null,
    bookedAt: null,
    observationId: null,
    generatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeWindow(
  peBusyIntervals: PeBusyInterval[] = [],
  travelBufferMinutes = 15,
): Pick<ObservationWindow, 'peBusyIntervals' | 'travelBufferMinutes'> {
  return { peBusyIntervals, travelBufferMinutes };
}

describe('buildAutoAssignPlan', () => {
  it('proposes the earliest open slot for a single pending preference', () => {
    const prefs = [makePref()];
    const slots = [
      makeSlot({ id: 'a', slotId: 'a', startMinute: 540 }),
      makeSlot({ id: 'b', slotId: 'b', startMinute: 480 }),
    ];
    const plan = buildAutoAssignPlan(prefs, slots, makeWindow());
    expect(plan.skipped).toEqual([]);
    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0]?.slotId).toBe('b');
  });

  it('skips already-assigned preferences entirely', () => {
    const prefs = [makePref({ assignedSlotId: 'already-booked' })];
    const slots = [makeSlot()];
    const plan = buildAutoAssignPlan(prefs, slots, makeWindow());
    expect(plan.proposals).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it('assigns two preferences on the same day/building to two different slots', () => {
    const prefs = [
      makePref({ id: 'a@x', email: 'a@x', submittedAt: new Date('2026-07-01T00:00:00.000Z') }),
      makePref({ id: 'b@x', email: 'b@x', submittedAt: new Date('2026-07-02T00:00:00.000Z') }),
    ];
    const slots = [
      makeSlot({
        id: 's1',
        slotId: 's1',
        startMinute: 480,
        startUTC: new Date('2026-08-10T13:00:00.000Z'),
        endUTC: new Date('2026-08-10T13:50:00.000Z'),
      }),
      makeSlot({
        id: 's2',
        slotId: 's2',
        startMinute: 600,
        startUTC: new Date('2026-08-10T15:00:00.000Z'),
        endUTC: new Date('2026-08-10T15:50:00.000Z'),
      }),
    ];
    const plan = buildAutoAssignPlan(prefs, slots, makeWindow());
    expect(plan.proposals).toHaveLength(2);
    const slotIds = plan.proposals.map((p) => p.slotId).sort();
    expect(slotIds).toEqual(['s1', 's2']);
    // First-submitted preference gets the earlier slot.
    expect(plan.proposals.find((p) => p.email === 'a@x')?.slotId).toBe('s1');
  });

  it('skips a preference with no open slots on its preferred day', () => {
    const prefs = [makePref()];
    const plan = buildAutoAssignPlan(prefs, [], makeWindow());
    expect(plan.proposals).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toMatch(/no open slots/i);
  });

  it('skips a preference whose only open slot conflicts with an existing PE booking', () => {
    const prefs = [makePref()];
    const slots = [
      makeSlot({
        startUTC: new Date('2026-08-10T13:00:00.000Z'),
        endUTC: new Date('2026-08-10T13:50:00.000Z'),
      }),
    ];
    // An existing booking elsewhere that overlaps this slot's window once
    // padded by the travel buffer.
    const window = makeWindow(
      [
        {
          startUTC: new Date('2026-08-10T12:55:00.000Z'),
          endUTC: new Date('2026-08-10T13:10:00.000Z'),
          slotId: 'other-slot',
        },
      ],
      15,
    );
    const plan = buildAutoAssignPlan(prefs, slots, window);
    expect(plan.proposals).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.reason).toMatch(/conflicts/i);
  });

  it('does not double-book the same slot across two preferences', () => {
    const prefs = [
      makePref({ id: 'a@x', email: 'a@x', submittedAt: new Date('2026-07-01T00:00:00.000Z') }),
      makePref({ id: 'b@x', email: 'b@x', submittedAt: new Date('2026-07-02T00:00:00.000Z') }),
    ];
    const slots = [makeSlot()];
    const plan = buildAutoAssignPlan(prefs, slots, makeWindow());
    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0]?.email).toBe('a@x');
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.email).toBe('b@x');
  });

  it('ignores slots for a different building or a different preferred day', () => {
    const prefs = [makePref()];
    const slots = [makeSlot({ buildingId: 'other-building' }), makeSlot({ dateYMD: '2026-08-11' })];
    const plan = buildAutoAssignPlan(prefs, slots, makeWindow());
    expect(plan.proposals).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });
});
