/**
 * AutoAssignDialog — manual slot override regression tests (SCHED-04).
 *
 * Covers the PE's ability to override the algorithm's picked slot for a
 * pending row via the proposed-time <select>, the pre-flight duplicate-slot
 * warning badge that appears once two rows point at the same slot, and that
 * `runAssignments` actually books the overridden slot rather than the
 * algorithm's original pick.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservationWindow } from '@ops/shared';
import type { PreferenceDoc, SlotDoc } from './autoAssignPreferences';

const { mockCallable } = vi.hoisted(() => ({
  mockCallable: vi.fn(() => Promise.resolve({ data: { observationId: 'obs-1' } })),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

import { AutoAssignDialog } from './AutoAssignDialog';

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

const window: Pick<ObservationWindow, 'peBusyIntervals' | 'travelBufferMinutes'> = {
  peBusyIntervals: [],
  travelBufferMinutes: 15,
};

beforeEach(() => {
  mockCallable.mockClear();
});

describe('AutoAssignDialog — manual slot override', () => {
  it('defaults the proposed-time select to the algorithm-picked slot for each row', () => {
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
      }),
      makeSlot({
        id: 's2',
        slotId: 's2',
        startMinute: 600,
        startUTC: new Date('2026-08-10T15:00:00.000Z'),
      }),
    ];

    render(
      <AutoAssignDialog
        open
        onOpenChange={vi.fn()}
        windowId="window-1"
        preferences={prefs}
        slots={slots}
        window={window as ObservationWindow}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(2);
    // Earliest-submitted preference gets the earlier slot (s1); the other
    // gets the remaining slot (s2) — the same conflict-free pairing the
    // underlying plan produces.
    expect(selects[0]).toHaveValue('s1');
    expect(selects[1]).toHaveValue('s2');
  });

  it('shows a warning badge on both rows once an override points two rows at the same slot', () => {
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
      }),
      makeSlot({
        id: 's2',
        slotId: 's2',
        startMinute: 600,
        startUTC: new Date('2026-08-10T15:00:00.000Z'),
      }),
    ];

    render(
      <AutoAssignDialog
        open
        onOpenChange={vi.fn()}
        windowId="window-1"
        preferences={prefs}
        slots={slots}
        window={window as ObservationWindow}
      />,
    );

    expect(
      screen.queryByTitle('Another row is also pointed at this slot — one of them will fail.'),
    ).not.toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    // Point the second row's slot at the first row's slot (s1).
    const secondSelect = selects[1];
    if (!secondSelect) throw new Error('expected a second row select');
    fireEvent.change(secondSelect, { target: { value: 's1' } });

    const warnings = screen.getAllByTitle(
      'Another row is also pointed at this slot — one of them will fail.',
    );
    expect(warnings).toHaveLength(2);
  });

  it('books the overridden slot, not the algorithm original, when confirmed', async () => {
    const prefs = [
      makePref({ id: 'a@x', email: 'a@x', submittedAt: new Date('2026-07-01T00:00:00.000Z') }),
    ];
    const slots = [
      makeSlot({
        id: 's1',
        slotId: 's1',
        startMinute: 480,
        startUTC: new Date('2026-08-10T13:00:00.000Z'),
      }),
      makeSlot({
        id: 's2',
        slotId: 's2',
        startMinute: 600,
        startUTC: new Date('2026-08-10T15:00:00.000Z'),
      }),
    ];

    render(
      <AutoAssignDialog
        open
        onOpenChange={vi.fn()}
        windowId="window-1"
        preferences={prefs}
        slots={slots}
        window={window as ObservationWindow}
      />,
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('s1'); // algorithm's original pick
    fireEvent.change(select, { target: { value: 's2' } });

    fireEvent.click(screen.getByRole('button', { name: /assign 1 observation/i }));

    await vi.waitFor(() => {
      expect(mockCallable).toHaveBeenCalledWith(
        expect.objectContaining({ windowId: 'window-1', email: 'a@x', slotId: 's2' }),
      );
    });
  });
});
