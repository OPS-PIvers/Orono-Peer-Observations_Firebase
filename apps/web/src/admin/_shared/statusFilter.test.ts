import { describe, expect, it } from 'vitest';
import { DEFAULT_STATUS_FILTER, matchesStatusFilter } from './statusFilter';

describe('DEFAULT_STATUS_FILTER', () => {
  it('defaults to active, matching StaffFilterBar', () => {
    expect(DEFAULT_STATUS_FILTER).toBe('active');
  });
});

describe('matchesStatusFilter', () => {
  it('active keeps only active rows', () => {
    expect(matchesStatusFilter(true, 'active')).toBe(true);
    expect(matchesStatusFilter(false, 'active')).toBe(false);
  });

  it('archived keeps only inactive rows', () => {
    expect(matchesStatusFilter(true, 'archived')).toBe(false);
    expect(matchesStatusFilter(false, 'archived')).toBe(true);
  });

  it('all keeps every row regardless of isActive', () => {
    expect(matchesStatusFilter(true, 'all')).toBe(true);
    expect(matchesStatusFilter(false, 'all')).toBe(true);
  });
});
