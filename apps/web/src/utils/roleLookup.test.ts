import { describe, expect, it } from 'vitest';
import type { Role } from '@ops/shared';
import { resolveRole, roleDisplayName, isKnownRoleId } from './roleLookup';

const mockRoles: Role[] = [
  {
    roleId: 'primary-teacher',
    displayName: 'Primary Teacher',
    rubricId: 'rubric-1',
    isActive: true,
    isSpecialAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    roleId: 'special-ed',
    displayName: 'Special Education',
    rubricId: 'rubric-2',
    isActive: true,
    isSpecialAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('resolveRole', () => {
  it('resolves role by roleId (fast path)', () => {
    const result = resolveRole(mockRoles, 'primary-teacher');
    expect(result).toEqual(mockRoles[0]);
  });

  it('resolves role by displayName (legacy fallback)', () => {
    const result = resolveRole(mockRoles, 'Primary Teacher');
    expect(result).toEqual(mockRoles[0]);
  });

  it('prefers roleId match over displayName when both exist', () => {
    // Create a scenario where a displayName happens to match another roleId
    const complexRoles: Role[] = [
      {
        roleId: 'role-a',
        displayName: 'Display A',
        rubricId: 'rubric-1',
        isActive: true,
        isSpecialAccess: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        roleId: 'role-b',
        displayName: 'Role A', // This displayName matches the first role's roleId
        rubricId: 'rubric-2',
        isActive: true,
        isSpecialAccess: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const result = resolveRole(complexRoles, 'role-b');
    // Should get the fast-path match (by roleId), not the legacy displayName match
    expect(result?.displayName).toBe('Role A');
  });

  it('returns null for unmapped role', () => {
    const result = resolveRole(mockRoles, 'nonexistent-role');
    expect(result).toBeNull();
  });

  it('returns null for null roles array', () => {
    const result = resolveRole(null, 'primary-teacher');
    expect(result).toBeNull();
  });

  it('returns null for undefined roles array', () => {
    const result = resolveRole(undefined, 'primary-teacher');
    expect(result).toBeNull();
  });

  it('returns null for null roleValue', () => {
    const result = resolveRole(mockRoles, null);
    expect(result).toBeNull();
  });

  it('returns null for undefined roleValue', () => {
    const result = resolveRole(mockRoles, undefined);
    expect(result).toBeNull();
  });

  it('returns null for empty string roleValue', () => {
    const result = resolveRole(mockRoles, '');
    expect(result).toBeNull();
  });
});

describe('roleDisplayName', () => {
  it('returns displayName for matching roleId', () => {
    const name = roleDisplayName(mockRoles, 'primary-teacher');
    expect(name).toBe('Primary Teacher');
  });

  it('falls back to input string when no match found', () => {
    const name = roleDisplayName(mockRoles, 'legacy-role-name');
    expect(name).toBe('legacy-role-name');
  });

  it('returns empty string for null roleIdOrLegacy', () => {
    const name = roleDisplayName(mockRoles, null);
    expect(name).toBe('');
  });

  it('returns empty string for undefined roleIdOrLegacy', () => {
    const name = roleDisplayName(mockRoles, undefined);
    expect(name).toBe('');
  });

  it('handles null roles array', () => {
    const name = roleDisplayName(null, 'some-value');
    expect(name).toBe('some-value');
  });
});

describe('isKnownRoleId', () => {
  it('returns true for known roleId', () => {
    const known = isKnownRoleId(mockRoles, 'primary-teacher');
    expect(known).toBe(true);
  });

  it('returns false for unknown roleId', () => {
    const known = isKnownRoleId(mockRoles, 'unknown-role');
    expect(known).toBe(false);
  });

  it('returns false for null value', () => {
    const known = isKnownRoleId(mockRoles, null);
    expect(known).toBe(false);
  });

  it('returns false for undefined value', () => {
    const known = isKnownRoleId(mockRoles, undefined);
    expect(known).toBe(false);
  });

  it('returns false for null roles array', () => {
    const known = isKnownRoleId(null, 'primary-teacher');
    expect(known).toBe(false);
  });

  it('returns false for undefined roles array', () => {
    const known = isKnownRoleId(undefined, 'primary-teacher');
    expect(known).toBe(false);
  });
});
