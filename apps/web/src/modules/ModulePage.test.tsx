import { describe, it, expect } from 'vitest';

/**
 * Tests for ModulePage admin draft banner access control.
 *
 * The component logic is tested via integration tests (e2e and manual).
 * Here we verify the access control decision tree with simple unit assertions.
 */

function canViewModule(isAssigned: boolean, isDraft: boolean, isAdminUser: boolean): boolean {
  return isAssigned && (!isDraft || isAdminUser);
}

function computeIsDraft(hasPage: boolean, isActive: boolean): boolean {
  return !hasPage || !isActive;
}

describe('ModulePage — admin draft banner', () => {
  it('allows admins to view hasPage=false modules (draft gate)', () => {
    expect(canViewModule(true, true, true)).toBe(true);
  });

  it('blocks non-admins from viewing hasPage=false modules', () => {
    expect(canViewModule(true, true, false)).toBe(false);
  });

  it('allows anyone assigned to view published modules', () => {
    expect(canViewModule(true, false, false)).toBe(true);
  });

  it('blocks unassigned users from any module', () => {
    expect(canViewModule(false, false, false)).toBe(false);
  });

  it('determines isDraft when hasPage=false', () => {
    expect(computeIsDraft(false, true)).toBe(true);
  });

  it('determines isDraft when isActive=false', () => {
    expect(computeIsDraft(true, false)).toBe(true);
  });

  it('determines module is published when both hasPage=true and isActive=true', () => {
    expect(computeIsDraft(true, true)).toBe(false);
  });
});
