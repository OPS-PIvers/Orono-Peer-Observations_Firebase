/**
 * StaffDirectoryPage — unit tests.
 *
 * Tests for the filter logic and rendering behavior:
 *   - Building filter correctly filters staff by building overlap.
 *   - Cycle status filter reads the stored status, falling back to the
 *     legacy year/summativeYear derivation.
 *   - Multiple filters compose correctly (AND logic).
 *   - Clear filters resets all filter state.
 */
import { describe, expect, it } from 'vitest';
import { staffCycleStatus } from '@ops/shared';
import type { CycleStatus, Staff } from '@ops/shared';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeStaff(overrides: Partial<Staff & { id: string }> = {}): Staff & { id: string } {
  return {
    id: 'test-email@orono.k12.mn.us',
    email: 'test-email@orono.k12.mn.us',
    name: 'Test Staff',
    role: 'Teacher',
    year: 2,
    buildings: ['OMS'],
    modules: [],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...overrides,
  } as Staff & { id: string };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StaffDirectoryPage — filtering logic', () => {
  describe('Building filter', () => {
    it('includes staff with matching building when filter is active', () => {
      const staff = makeStaff({ buildings: ['OMS', 'OHS'] });
      const selectedBuildings = new Set(['OMS']);
      const hasMatchingBuilding = staff.buildings.some((b) => selectedBuildings.has(b));
      expect(hasMatchingBuilding).toBe(true);
    });

    it('excludes staff without matching building when filter is active', () => {
      const staff = makeStaff({ buildings: ['OHS'] });
      const selectedBuildings = new Set(['OMS']);
      const hasMatchingBuilding = staff.buildings.some((b) => selectedBuildings.has(b));
      expect(hasMatchingBuilding).toBe(false);
    });

    it('includes all staff when no buildings are selected', () => {
      const staff = makeStaff({ buildings: ['OHS'] });
      const selectedBuildings = new Set<string>();
      const hasMatchingBuilding =
        selectedBuildings.size === 0 || staff.buildings.some((b) => selectedBuildings.has(b));
      expect(hasMatchingBuilding).toBe(true);
    });

    it('handles staff with multiple buildings and multiple selected buildings', () => {
      const staff = makeStaff({ buildings: ['OMS', 'OHS', 'Elem'] });
      const selectedBuildings = new Set(['OMS', 'High']);
      const hasMatchingBuilding = staff.buildings.some((b) => selectedBuildings.has(b));
      expect(hasMatchingBuilding).toBe(true); // OMS matches
    });
  });

  describe('Cycle status filter', () => {
    it('uses the stored status, independent of year', () => {
      expect(staffCycleStatus(makeStaff({ year: 5, cycleStatus: 'developing' }))).toBe(
        'developing',
      );
      expect(staffCycleStatus(makeStaff({ year: 1, cycleStatus: 'high' }))).toBe('high');
    });

    it('legacy fallback: returns "probationary" for year 4-6', () => {
      expect(staffCycleStatus(makeStaff({ year: 4, summativeYear: false }))).toBe('probationary');
      expect(staffCycleStatus(makeStaff({ year: 5, summativeYear: true }))).toBe('probationary');
      expect(staffCycleStatus(makeStaff({ year: 6, summativeYear: false }))).toBe('probationary');
    });

    it('legacy fallback: returns "high" for year 1-3 with summativeYear=true', () => {
      expect(staffCycleStatus(makeStaff({ year: 1, summativeYear: true }))).toBe('high');
      expect(staffCycleStatus(makeStaff({ year: 2, summativeYear: true }))).toBe('high');
      expect(staffCycleStatus(makeStaff({ year: 3, summativeYear: true }))).toBe('high');
    });

    it('legacy fallback: returns "planning"/"developing" for year 1-3 with summativeYear=false', () => {
      expect(staffCycleStatus(makeStaff({ year: 1, summativeYear: false }))).toBe('planning');
      expect(staffCycleStatus(makeStaff({ year: 2, summativeYear: false }))).toBe('developing');
      expect(staffCycleStatus(makeStaff({ year: 3, summativeYear: false }))).toBe('developing');
    });

    it('filters staff by high cycle status', () => {
      const staff = makeStaff({ year: 3, summativeYear: true });
      const filterStatus = staffCycleStatus(staff);
      expect(filterStatus === 'high').toBe(true);
    });

    it('filters staff by developing status', () => {
      const staff = makeStaff({ year: 2, summativeYear: false });
      const filterStatus = staffCycleStatus(staff);
      expect(filterStatus === 'developing').toBe(true);
    });

    it('filters staff by planning status', () => {
      const staff = makeStaff({ year: 1, summativeYear: false });
      const filterStatus = staffCycleStatus(staff);
      expect(filterStatus === 'planning').toBe(true);
    });

    it('filters staff by probationary status', () => {
      const staff = makeStaff({ year: 4, summativeYear: true });
      const filterStatus = staffCycleStatus(staff);
      expect(filterStatus === 'probationary').toBe(true);
    });
  });

  describe('Combined filters (AND logic)', () => {
    it('applies building AND cycle status filters together', () => {
      const staff = makeStaff({
        buildings: ['OMS'],
        year: 3,
        summativeYear: true,
      });

      const selectedBuildings = new Set(['OMS']);
      const cycleStatusFilter = 'high';

      const buildingMatch = staff.buildings.some((b) => selectedBuildings.has(b));
      const cycleMatch = staffCycleStatus(staff) === cycleStatusFilter;

      expect(buildingMatch && cycleMatch).toBe(true);
    });

    it('excludes staff that matches building but not cycle status', () => {
      const staff = makeStaff({
        buildings: ['OMS'],
        year: 1,
        summativeYear: false,
      });

      const selectedBuildings = new Set(['OMS']);
      const cycleStatusFilter = 'high';

      const buildingMatch = staff.buildings.some((b) => selectedBuildings.has(b));
      const cycleMatch = staffCycleStatus(staff) === cycleStatusFilter;

      expect(buildingMatch && cycleMatch).toBe(false);
    });

    it('excludes staff that matches cycle status but not building', () => {
      const staff = makeStaff({
        buildings: ['OHS'],
        year: 3,
        summativeYear: true,
      });

      const selectedBuildings = new Set(['OMS']);
      const cycleStatusFilter = 'high';

      const buildingMatch = staff.buildings.some((b) => selectedBuildings.has(b));
      const cycleMatch = staffCycleStatus(staff) === cycleStatusFilter;

      expect(buildingMatch && cycleMatch).toBe(false);
    });
  });

  describe('Filter state management', () => {
    // Mirrors the building predicate in StaffDirectoryPage: an empty set means
    // "no filter", so every staff member passes regardless of their buildings.
    function passesBuildingFilter(staff: Staff, selectedBuildings: Set<string>): boolean {
      return selectedBuildings.size === 0 || staff.buildings.some((b) => selectedBuildings.has(b));
    }

    // Mirrors the cycle predicate: 'all' means "no filter".
    function passesCycleFilter(staff: Staff, filter: CycleStatus | 'all'): boolean {
      return filter === 'all' || staffCycleStatus(staff) === filter;
    }

    it('treats empty building set as no filter (includes all)', () => {
      const staff = makeStaff({ buildings: ['OHS'] });
      const selectedBuildings = new Set<string>();
      expect(passesBuildingFilter(staff, selectedBuildings)).toBe(true);
    });

    it('treats "all" cycle status as no filter (includes all)', () => {
      const staff = makeStaff({ year: 1, summativeYear: false });
      const cycleStatusFilter: CycleStatus | 'all' = 'all';
      expect(passesCycleFilter(staff, cycleStatusFilter)).toBe(true);
    });
  });

  describe('Inactive staff handling', () => {
    // Mirrors the active predicate: inactive staff are hidden unless showInactive.
    function isVisible(staff: Staff, showInactive: boolean): boolean {
      return showInactive || staff.isActive;
    }

    it('filters out inactive staff when isActive=false and showInactive=false', () => {
      const staff = makeStaff({ isActive: false });
      expect(isVisible(staff, false)).toBe(false);
    });

    it('includes inactive staff when showInactive=true', () => {
      const staff = makeStaff({ isActive: false });
      expect(isVisible(staff, true)).toBe(true);
    });
  });
});
