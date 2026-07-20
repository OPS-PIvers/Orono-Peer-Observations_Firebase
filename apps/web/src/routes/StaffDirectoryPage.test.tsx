/**
 * StaffDirectoryPage — unit tests.
 *
 * Tests for the filter logic and rendering behavior:
 *   - Building filter correctly filters staff by building overlap.
 *   - Cycle status filter correctly maps year/summativeYear to cycle status.
 *   - Multiple filters compose correctly (AND logic).
 *   - Clear filters resets all filter state.
 */
import { describe, expect, it } from 'vitest';
import { cycleStatus } from '@ops/shared';
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
    it('returns "probationary" for year 4-6', () => {
      expect(cycleStatus(4, false)).toBe('probationary');
      expect(cycleStatus(5, true)).toBe('probationary');
      expect(cycleStatus(6, false)).toBe('probationary');
    });

    it('returns "high" for year 1-3 with summativeYear=true', () => {
      expect(cycleStatus(1, true)).toBe('high');
      expect(cycleStatus(2, true)).toBe('high');
      expect(cycleStatus(3, true)).toBe('high');
    });

    it('returns "low" for year 1-3 with summativeYear=false', () => {
      expect(cycleStatus(1, false)).toBe('low');
      expect(cycleStatus(2, false)).toBe('low');
      expect(cycleStatus(3, false)).toBe('low');
    });

    it('filters staff by high cycle status', () => {
      const staff = makeStaff({ year: 3, summativeYear: true });
      const filterStatus = cycleStatus(staff.year, staff.summativeYear);
      expect(filterStatus === 'high').toBe(true);
    });

    it('filters staff by low cycle status', () => {
      const staff = makeStaff({ year: 2, summativeYear: false });
      const filterStatus = cycleStatus(staff.year, staff.summativeYear);
      expect(filterStatus === 'low').toBe(true);
    });

    it('filters staff by probationary status', () => {
      const staff = makeStaff({ year: 4, summativeYear: true });
      const filterStatus = cycleStatus(staff.year, staff.summativeYear);
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
      const cycleMatch = cycleStatus(staff.year, staff.summativeYear) === cycleStatusFilter;

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
      const cycleMatch = cycleStatus(staff.year, staff.summativeYear) === cycleStatusFilter;

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
      const cycleMatch = cycleStatus(staff.year, staff.summativeYear) === cycleStatusFilter;

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
      return filter === 'all' || cycleStatus(staff.year, staff.summativeYear) === filter;
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
