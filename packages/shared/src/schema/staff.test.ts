import { describe, expect, it } from 'vitest';
import { validateStaffInput } from './staff.js';

const validStaffInput = {
  email: 'teacher@orono.k12.mn.us',
  name: 'John Doe',
  role: 'teacher',
  year: 2,
  buildings: ['OHS'],
  modules: [],
  summativeYear: false,
  isActive: true,
  hasAdminAccess: false,
};

describe('validateStaffInput', () => {
  it('accepts valid staff input without domain enforcement', () => {
    const result = validateStaffInput(validStaffInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('teacher@orono.k12.mn.us');
    }
  });

  it('rejects input with missing required fields', () => {
    const result = validateStaffInput({
      email: 'teacher@orono.k12.mn.us',
      name: 'John Doe',
      // missing role
      year: 2,
      buildings: [],
      modules: [],
      summativeYear: false,
      isActive: true,
      hasAdminAccess: false,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Error should mention a validation failure (either missing role or invalid input)
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it('rejects invalid email format', () => {
    const result = validateStaffInput({
      ...validStaffInput,
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('email');
    }
  });

  it('rejects non-domain email when enforceDomain is true', () => {
    const result = validateStaffInput(
      {
        ...validStaffInput,
        email: 'teacher@gmail.com',
      },
      { enforceDomain: true },
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('orono.k12.mn.us');
    }
  });

  it('accepts domain email when enforceDomain is true', () => {
    const result = validateStaffInput(validStaffInput, { enforceDomain: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('teacher@orono.k12.mn.us');
    }
  });

  it('allows non-domain email when enforceDomain is false/undefined', () => {
    const result = validateStaffInput({
      ...validStaffInput,
      email: 'someone@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid year (outside 1-6)', () => {
    const result = validateStaffInput({
      ...validStaffInput,
      year: 7,
    });
    expect(result.success).toBe(false);
  });

  it('lowercases email before validation', () => {
    const result = validateStaffInput({
      ...validStaffInput,
      email: 'TEACHER@ORONO.K12.MN.US',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('teacher@orono.k12.mn.us');
    }
  });
});
