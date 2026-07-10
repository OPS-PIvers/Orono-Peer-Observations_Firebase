import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUSES,
  cycleStatus,
  displayYear,
  isTenureTransition,
  nextCycleYear,
  rolloverCycle,
} from './cycle.js';
import type { StaffYear } from './schema/staff.js';

describe('CYCLE_STATUSES', () => {
  it('is the three statuses in order', () => {
    expect(CYCLE_STATUSES).toEqual(['low', 'high', 'probationary']);
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
  it('is high when summative, low otherwise, for continuing years', () => {
    expect(cycleStatus(2, true)).toBe('high');
    expect(cycleStatus(2, false)).toBe('low');
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

describe('rolloverCycle', () => {
  it('keeps continuing years 1-2 formative (low cycle)', () => {
    expect(rolloverCycle(1)).toEqual({ year: 2, summativeYear: false });
    expect(rolloverCycle(3)).toEqual({ year: 1, summativeYear: false });
  });
  it('marks continuing year 3 as the summative-review year', () => {
    expect(rolloverCycle(2)).toEqual({ year: 3, summativeYear: true });
  });
  it('keeps staff still on the probationary track summative every year', () => {
    expect(rolloverCycle(4)).toEqual({ year: 5, summativeYear: true });
    expect(rolloverCycle(5)).toEqual({ year: 6, summativeYear: true });
  });
  it('transitions P3 to tenure: continuing year 1, formative', () => {
    expect(rolloverCycle(6)).toEqual({ year: 1, summativeYear: false });
  });
  it('never leaves a rolled-over member in a probationary-with-false-summative state', () => {
    for (const y of [1, 2, 3, 4, 5, 6] as StaffYear[]) {
      const next = rolloverCycle(y);
      if (next.year >= 4) expect(next.summativeYear).toBe(true);
    }
  });
});
