/**
 * AutoAssignDialog — manual slot override regression tests (SCHED-04).
 *
 * Covers the PE's ability to override the algorithm's picked slot for a
 * pending row via the proposed-time <select>, the pre-flight duplicate-slot
 * warning badge that appears once two rows point at the same slot, that
 * `runAssignments` actually books the overridden slot rather than the
 * algorithm's original pick, and that an override which points at a slot
 * that goes unavailable underneath an open dialog (a live-refresh race —
 * another PE books it while the dialog sits open) is re-validated rather
 * than silently submitted.
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

  it('resets a stale override to the algorithm pick when the slot is booked out from under the open dialog, and submits the reset pick', async () => {
    const prefs = [
      makePref({ id: 'a@x', email: 'a@x', submittedAt: new Date('2026-07-01T00:00:00.000Z') }),
    ];
    const slot1 = makeSlot({
      id: 's1',
      slotId: 's1',
      startMinute: 480,
      startUTC: new Date('2026-08-10T13:00:00.000Z'),
    });
    const slot2 = makeSlot({
      id: 's2',
      slotId: 's2',
      startMinute: 600,
      startUTC: new Date('2026-08-10T15:00:00.000Z'),
    });
    const initialSlots = [slot1, slot2];

    const { rerender } = render(
      <AutoAssignDialog
        open
        onOpenChange={vi.fn()}
        windowId="window-1"
        preferences={prefs}
        slots={initialSlots}
        window={window as ObservationWindow}
      />,
    );

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('s1'); // algorithm's original pick

    // The PE overrides the row to the later slot.
    fireEvent.change(select, { target: { value: 's2' } });
    expect(select).toHaveValue('s2');
    expect(screen.queryByText('No longer available')).not.toBeInTheDocument();

    // While the dialog is still open, another PE books s2 out from under
    // it — the live snapshot refreshes with s2 now 'booked'.
    const refreshedSlots = [
      slot1,
      { ...slot2, status: 'booked' as const, bookedBy: 'other.pe@orono.k12.mn.us' },
    ];
    rerender(
      <AutoAssignDialog
        open
        onOpenChange={vi.fn()}
        windowId="window-1"
        preferences={prefs}
        slots={refreshedSlots}
        window={window as ObservationWindow}
      />,
    );

    // The row falls back to the algorithm's original pick (s1) and surfaces
    // that the override was reset, rather than continuing to display/submit
    // the now-booked s2.
    expect(select).toHaveValue('s1');
    expect(screen.getByText('No longer available')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /assign 1 observation/i }));

    await vi.waitFor(() => {
      expect(mockCallable).toHaveBeenCalledWith(
        expect.objectContaining({ windowId: 'window-1', email: 'a@x', slotId: 's1' }),
      );
    });
    expect(mockCallable).not.toHaveBeenCalledWith(expect.objectContaining({ slotId: 's2' }));
  });

  it('flags a duplicate warning on both rows when an override collides with a NON-overridden row (not just override-vs-override)', () => {
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
    // Row A (index 0) keeps its algorithm default (s1, non-overridden). Row
    // B is overridden to also point at s1.
    const secondSelect = selects[1];
    if (!secondSelect) throw new Error('expected a second row select');
    fireEvent.change(secondSelect, { target: { value: 's1' } });

    // Row A never had its <select> touched — its warning comes purely from
    // Row B's override colliding with it.
    const warnings = screen.getAllByTitle(
      'Another row is also pointed at this slot — one of them will fail.',
    );
    expect(warnings).toHaveLength(2);
  });
});
