import { describe, expect, it } from 'vitest';
import {
  computeStaffConflictedSlotIds,
  staffBusyIntervalsFromObservations,
} from './staffConflicts';

describe('staffBusyIntervalsFromObservations', () => {
  it('builds an interval for each other-window Draft observation', () => {
    const intervals = staffBusyIntervalsFromObservations(
      [
        {
          windowId: 'window-other',
          scheduledStartAt: new Date('2026-08-10T13:00:00.000Z'),
          scheduledEndAt: new Date('2026-08-10T13:50:00.000Z'),
        },
      ],
      'window-current',
    );
    expect(intervals).toEqual([
      {
        startMs: Date.parse('2026-08-10T13:00:00.000Z'),
        endMs: Date.parse('2026-08-10T13:50:00.000Z'),
      },
    ]);
  });

  it('excludes the observation belonging to the current window', () => {
    const intervals = staffBusyIntervalsFromObservations(
      [
        {
          windowId: 'window-current',
          scheduledStartAt: new Date('2026-08-10T13:00:00.000Z'),
          scheduledEndAt: new Date('2026-08-10T13:50:00.000Z'),
        },
      ],
      'window-current',
    );
    expect(intervals).toEqual([]);
  });

  it('skips observations with no scheduled time (manually created)', () => {
    const intervals = staffBusyIntervalsFromObservations(
      [{ windowId: null, scheduledStartAt: null, scheduledEndAt: null }],
      'window-current',
    );
    expect(intervals).toEqual([]);
  });
});

describe('computeStaffConflictedSlotIds', () => {
  const slot = (overrides: { slotId?: string; startUTC?: unknown; endUTC?: unknown } = {}) => ({
    slotId: overrides.slotId ?? 'slot-1',
    startUTC: overrides.startUTC ?? new Date('2026-08-10T13:00:00.000Z'),
    endUTC: overrides.endUTC ?? new Date('2026-08-10T13:50:00.000Z'),
  });

  it('returns an empty set when there are no busy intervals', () => {
    expect(computeStaffConflictedSlotIds([slot()], [])).toEqual(new Set());
  });

  it('flags a slot whose interval overlaps a busy interval', () => {
    const busy = [
      {
        startMs: Date.parse('2026-08-10T13:10:00.000Z'),
        endMs: Date.parse('2026-08-10T13:20:00.000Z'),
      },
    ];
    const result = computeStaffConflictedSlotIds([slot()], busy);
    expect(result).toEqual(new Set(['slot-1']));
  });

  it('does not flag a slot that ends exactly when the busy interval starts', () => {
    const busy = [
      {
        startMs: Date.parse('2026-08-10T13:50:00.000Z'),
        endMs: Date.parse('2026-08-10T14:40:00.000Z'),
      },
    ];
    const result = computeStaffConflictedSlotIds([slot()], busy);
    expect(result).toEqual(new Set());
  });

  it('does not flag a slot with no overlap', () => {
    const busy = [
      {
        startMs: Date.parse('2026-08-11T13:00:00.000Z'),
        endMs: Date.parse('2026-08-11T13:50:00.000Z'),
      },
    ];
    const result = computeStaffConflictedSlotIds([slot()], busy);
    expect(result).toEqual(new Set());
  });

  it('skips a slot with an unparseable time', () => {
    const busy = [
      {
        startMs: Date.parse('2026-08-10T13:10:00.000Z'),
        endMs: Date.parse('2026-08-10T13:20:00.000Z'),
      },
    ];
    const result = computeStaffConflictedSlotIds(
      [slot({ startUTC: 'not-a-date', endUTC: null })],
      busy,
    );
    expect(result).toEqual(new Set());
  });
});
