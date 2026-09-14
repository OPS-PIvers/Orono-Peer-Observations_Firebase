import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUSES,
  cycleStatus,
  cycleStatusFields,
  displayYear,
  isSummative,
  isSummativeStatus,
  isTenureTransition,
  nextCycleYear,
  rolloverCycle,
  staffCycleStatus,
  suggestedCycleStatus,
} from './cycle.js';
import type { StaffYear } from './schema/staff.js';

describe('CYCLE_STATUSES', () => {
  it('is the four phases in order', () => {
    expect(CYCLE_STATUSES).toEqual(['planning', 'developing', 'high', 'probationary']);
  });
});

describe('displayYear', () => {
  it('passes continuing years through and maps probationary 4-6 to 1-3', () => {
    expect(displayYear(1)).toBe(1);
    expect(displayYear(3)).toBe(3);
    expect(displayYear(4)).toBe(1);
    expect(displayYear(6)).toBe(3);
  });
});

describe('cycleStatus', () => {
  it('is probationary for year >= 4 regardless of summative', () => {
    expect(cycleStatus(4, false)).toBe('probationary');
    expect(cycleStatus(6, true)).toBe('probationary');
  });
  it('is high whenever summative, for continuing years', () => {
    expect(cycleStatus(2, true)).toBe('high');
  });
  it('splits non-summative continuing years by year: 1 planning, 2-3 developing', () => {
    expect(cycleStatus(1, false)).toBe('planning');
    expect(cycleStatus(2, false)).toBe('developing');
    expect(cycleStatus(3, false)).toBe('developing');
  });
});

describe('nextCycleYear', () => {
  it('advances the continuing 3-year loop 1 → 2 → 3 → 1', () => {
    expect(nextCycleYear(1)).toBe(2);
    expect(nextCycleYear(2)).toBe(3);
    expect(nextCycleYear(3)).toBe(1);
  });
  it('advances the probationary track P1 → P2 → P3 → continuing year 1', () => {
    expect(nextCycleYear(4)).toBe(5);
    expect(nextCycleYear(5)).toBe(6);
    expect(nextCycleYear(6)).toBe(1);
  });
  it('always returns a valid stored year', () => {
    for (const y of [1, 2, 3, 4, 5, 6] as StaffYear[]) {
      expect([1, 2, 3, 4, 5, 6]).toContain(nextCycleYear(y));
    }
  });
});

describe('isTenureTransition', () => {
  it('is true only when leaving P3 (stored year 6)', () => {
    expect(isTenureTransition(6)).toBe(true);
    for (const y of [1, 2, 3, 4, 5] as StaffYear[]) {
      expect(isTenureTransition(y)).toBe(false);
    }
  });
});

describe('staffCycleStatus', () => {
  it('returns the stored status when present', () => {
    expect(staffCycleStatus({ year: 5, summativeYear: true, cycleStatus: 'developing' })).toBe(
      'developing',
    );
    expect(staffCycleStatus({ year: 1, summativeYear: false, cycleStatus: 'high' })).toBe('high');
    expect(staffCycleStatus({ year: 2, cycleStatus: 'probationary' })).toBe('probationary');
  });
  it('falls back to the legacy derivation when no status is stored', () => {
    for (const year of [1, 2, 3, 4, 5, 6]) {
      for (const summativeYear of [true, false]) {
        expect(staffCycleStatus({ year, summativeYear })).toBe(cycleStatus(year, summativeYear));
        expect(staffCycleStatus({ year, summativeYear, cycleStatus: null })).toBe(
          cycleStatus(year, summativeYear),
        );
      }
    }
  });
  it('treats a missing summativeYear as formative in the fallback', () => {
    expect(staffCycleStatus({ year: 1 })).toBe('planning');
    expect(staffCycleStatus({ year: 4 })).toBe('probationary');
  });
  it('ignores an unrecognised stored value and falls back', () => {
    const legacyLow = { year: 3, summativeYear: true, cycleStatus: 'low' } as unknown as {
      year: number;
      summativeYear: boolean;
    };
    expect(staffCycleStatus(legacyLow)).toBe('high');
  });
});

describe('isSummative / cycleStatusFields', () => {
  it('is summative exactly for high and probationary', () => {
    expect(CYCLE_STATUSES.filter(isSummativeStatus)).toEqual(['high', 'probationary']);
  });
  it('follows the stored status, not the stored summativeYear flag', () => {
    expect(isSummative({ year: 2, summativeYear: false, cycleStatus: 'high' })).toBe(true);
    expect(isSummative({ year: 5, summativeYear: true, cycleStatus: 'planning' })).toBe(false);
    expect(isSummative({ year: 5, summativeYear: false })).toBe(true);
  });
  it('writes the status with its synced summativeYear and never a year', () => {
    expect(cycleStatusFields('planning')).toEqual({
      cycleStatus: 'planning',
      summativeYear: false,
    });
    expect(cycleStatusFields('developing')).toEqual({
      cycleStatus: 'developing',
      summativeYear: false,
    });
    expect(cycleStatusFields('high')).toEqual({ cycleStatus: 'high', summativeYear: true });
    expect(cycleStatusFields('probationary')).toEqual({
      cycleStatus: 'probationary',
      summativeYear: true,
    });
  });
});

describe('suggestedCycleStatus', () => {
  it('proposes planning, developing, high for years 1-3 and probationary for P1-P3', () => {
    expect(suggestedCycleStatus(1)).toBe('planning');
    expect(suggestedCycleStatus(2)).toBe('developing');
    expect(suggestedCycleStatus(3)).toBe('high');
    expect(suggestedCycleStatus(4)).toBe('probationary');
    expect(suggestedCycleStatus(5)).toBe('probationary');
    expect(suggestedCycleStatus(6)).toBe('probationary');
  });
  it('agrees with the pre-status rollover summative rule (next >= 4 || next === 3)', () => {
    for (const y of [1, 2, 3, 4, 5, 6] as StaffYear[]) {
      expect(isSummativeStatus(suggestedCycleStatus(y))).toBe(y >= 4 || y === 3);
    }
  });
});

describe('rolloverCycle', () => {
  it('moves continuing years 3 → 1 into planning and 1 → 2 into developing', () => {
    expect(rolloverCycle(1)).toEqual({ year: 2, cycleStatus: 'developing', summativeYear: false });
    expect(rolloverCycle(3)).toEqual({ year: 1, cycleStatus: 'planning', summativeYear: false });
  });
  it('marks continuing year 3 as the high-cycle summative year', () => {
    expect(rolloverCycle(2)).toEqual({ year: 3, cycleStatus: 'high', summativeYear: true });
  });
  it('keeps staff still on the probationary track probationary and summative', () => {
    expect(rolloverCycle(4)).toEqual({ year: 5, cycleStatus: 'probationary', summativeYear: true });
    expect(rolloverCycle(5)).toEqual({ year: 6, cycleStatus: 'probationary', summativeYear: true });
  });
  it('transitions P3 to tenure: continuing year 1, planning', () => {
    expect(rolloverCycle(6)).toEqual({ year: 1, cycleStatus: 'planning', summativeYear: false });
  });
  it('always syncs summativeYear to the proposed status', () => {
    for (const y of [1, 2, 3, 4, 5, 6] as StaffYear[]) {
      const next = rolloverCycle(y);
      expect(next.summativeYear).toBe(isSummativeStatus(next.cycleStatus));
    }
  });
});
