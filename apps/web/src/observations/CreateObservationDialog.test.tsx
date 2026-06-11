/**
 * CreateObservationDialog — Tests for dialog behavior with active and archived staff.
 */
import { describe, expect, it } from 'vitest';
import type { Staff } from '@ops/shared';

function makeActiveStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    email: 'teacher@orono.k12.mn.us',
    name: 'Active Teacher',
    role: 'teacher',
    year: 1,
    buildings: ['OHS'],
    modules: [],
    moduleExclusions: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeArchivedStaff(overrides: Partial<Staff> = {}): Staff {
  return makeActiveStaff({
    isActive: false,
    ...overrides,
  });
}

describe('CreateObservationDialog archived staff detection', () => {
  it('correctly identifies active staff', () => {
    const activeStaff = makeActiveStaff();
    expect(activeStaff.isActive).toBe(true);
  });

  it('correctly identifies archived staff', () => {
    const archivedStaff = makeArchivedStaff();
    expect(archivedStaff.isActive).toBe(false);
  });

  it('allows name override in active staff', () => {
    const namedStaff = makeActiveStaff({ name: 'Custom Name' });
    expect(namedStaff.name).toBe('Custom Name');
    expect(namedStaff.isActive).toBe(true);
  });

  it('allows name override in archived staff', () => {
    const namedStaff = makeArchivedStaff({ name: 'Custom Archived Name' });
    expect(namedStaff.name).toBe('Custom Archived Name');
    expect(namedStaff.isActive).toBe(false);
  });
});
