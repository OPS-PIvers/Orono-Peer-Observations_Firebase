import { describe, expect, it } from 'vitest';
import type { Staff } from '@ops/shared';
import {
  CYCLE_STATUSES,
  STAFF_YEARS,
  cycleStatusFields,
  cycleStatusLabel,
  cycleStatusOrder,
  displayYear,
  staffCycleStatus,
} from './staffCycle';
import { buildBulkEditPlan, type BulkEditValues } from './bulkEditPlan';

describe('displayYear', () => {
  it('passes continuing years through and maps probationary 4-6 to 1-3', () => {
    expect(displayYear(1)).toBe(1);
    expect(displayYear(3)).toBe(3);
    expect(displayYear(4)).toBe(1);
    expect(displayYear(6)).toBe(3);
  });
});

describe('labels', () => {
  it('exposes the four phases with human labels', () => {
    expect(CYCLE_STATUSES).toEqual(['planning', 'developing', 'high', 'probationary']);
    expect(cycleStatusLabel('planning')).toBe('Planning');
    expect(cycleStatusLabel('developing')).toBe('Developing');
    expect(cycleStatusLabel('high')).toBe('High Cycle');
    expect(cycleStatusLabel('probationary')).toBe('Probationary');
  });
});

describe('STAFF_YEARS', () => {
  it('offers all six stored years — Y1-Y3 then P1-P3', () => {
    expect(STAFF_YEARS).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('cycleStatusOrder', () => {
  it('sorts statuses in phase order', () => {
    const shuffled = ['probationary', 'planning', 'high', 'developing'] as const;
    expect([...shuffled].sort((a, b) => cycleStatusOrder(a) - cycleStatusOrder(b))).toEqual([
      ...CYCLE_STATUSES,
    ]);
  });
});

/**
 * The regression this module exists to prevent: Status and Year used to be
 * encoded into each other, so picking "Planning" snapped a year-2 teacher to
 * year 1 and picking "Probationary" moved them onto P-years. Every writer now
 * patches only its own field.
 */
describe('Status and Year are independent', () => {
  const base = { year: 2 as const, summativeYear: false, cycleStatus: 'developing' as const };

  it('a status write never carries a year', () => {
    for (const s of CYCLE_STATUSES) {
      const patch = cycleStatusFields(s);
      expect(patch).not.toHaveProperty('year');
      // Applying it leaves the year exactly where it was.
      expect({ ...base, ...patch }.year).toBe(2);
      expect(staffCycleStatus({ ...base, ...patch })).toBe(s);
    }
  });

  it('a year write (any of the six) leaves the stored status untouched', () => {
    for (const y of STAFF_YEARS) {
      const next = { ...base, year: y };
      expect(staffCycleStatus(next)).toBe('developing');
    }
  });

  it('allows any combination, e.g. P2 + Developing and Y1 + Probationary', () => {
    expect(staffCycleStatus({ year: 5, summativeYear: false, cycleStatus: 'developing' })).toBe(
      'developing',
    );
    expect(staffCycleStatus({ year: 1, summativeYear: true, cycleStatus: 'probationary' })).toBe(
      'probationary',
    );
  });

  it('bulk edits respect the split too', () => {
    const row = {
      id: 'a@x',
      email: 'a@x',
      name: 'A',
      role: 'teacher',
      buildings: [],
      modules: [],
      isActive: true,
      hasAdminAccess: false,
      ...base,
    } as unknown as Staff & { id: string };
    const values: BulkEditValues = {
      year: 6,
      roleId: '',
      building: '',
      moduleId: '',
      cycleStatus: 'probationary',
      boolValue: true,
    };
    const yearPlan = buildBulkEditPlan('year', values, [row]);
    const statusPlan = buildBulkEditPlan('cycleStatus', values, [row]);
    if (yearPlan.kind !== 'ready' || statusPlan.kind !== 'ready') throw new Error('expected ready');
    expect(yearPlan.patches.get('a@x')).toEqual({ year: 6 });
    expect(statusPlan.patches.get('a@x')).toEqual({
      cycleStatus: 'probationary',
      summativeYear: true,
    });
  });
});
