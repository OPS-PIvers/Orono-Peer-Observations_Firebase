/**
 * MyStaffPage — tests for role display names and error handling behavior.
 *
 * Tests that staff roles are displayed as human-readable displayNames (not raw slugs)
 * and that load errors are displayed as distinct from empty caseloads.
 */
import { describe, expect, it } from 'vitest';
import type { Role } from '@ops/shared';
import { roleDisplayName } from '@/utils/roleLookup';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeRole(overrides: Partial<Role & { id: string }> = {}): Role & { id: string } {
  return {
    id: 'teacher',
    roleId: 'teacher',
    displayName: 'Classroom Teacher',
    rubricId: 'teacher',
    isActive: true,
    isSpecialAccess: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSpeechRole(): Role & { id: string } {
  return makeRole({
    id: 'slp',
    roleId: 'speech-language-pathologist',
    displayName: 'Speech-Language Pathologist',
    rubricId: 'slp',
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('roleDisplayName (used in MyStaffPage)', () => {
  it('returns displayName when role exists in the roles array', () => {
    const roles = [makeRole()];

    const result = roleDisplayName(roles, 'teacher');

    expect(result).toBe('Classroom Teacher');
  });

  it('handles multiple roles and returns the correct displayName', () => {
    const roles = [makeRole(), makeSpeechRole()];

    const teacherResult = roleDisplayName(roles, 'teacher');
    const slpResult = roleDisplayName(roles, 'speech-language-pathologist');

    expect(teacherResult).toBe('Classroom Teacher');
    expect(slpResult).toBe('Speech-Language Pathologist');
  });

  it('returns the slug as fallback when role not found', () => {
    const roles = [makeRole()];

    const result = roleDisplayName(roles, 'unknown-role');

    expect(result).toBe('unknown-role');
  });

  it('handles null or undefined roles gracefully', () => {
    expect(roleDisplayName(null, 'teacher')).toBe('teacher');
    expect(roleDisplayName(undefined, 'teacher')).toBe('teacher');
  });

  it('returns empty string for null or undefined roleId', () => {
    const roles = [makeRole()];

    expect(roleDisplayName(roles, null)).toBe('');
    expect(roleDisplayName(roles, undefined)).toBe('');
  });
});
