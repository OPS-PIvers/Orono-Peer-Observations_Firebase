/**
 * Unit tests for the synthetic dev seed data in scripts/seed-dev.ts.
 *
 * These tests validate that every synthetic record conforms to the @ops/shared
 * Zod schemas so typos in seed data are caught before the script is run against
 * an emulator.
 *
 * Run with:
 *   pnpm test:scripts
 */

import { describe, expect, it } from 'vitest';
import {
  staff as staffSchema,
  role as roleSchema,
  rubric as rubricSchema,
  roleYearMapping as roleYearMappingSchema,
  building as buildingSchema,
  moduleDoc as moduleDocSchema,
  roleYearMappingDocId,
  SPECIAL_ROLES,
} from '@ops/shared';
import {
  STAFF,
  ROLES,
  TEACHER_RUBRIC,
  ROLE_YEAR_MAPPINGS,
  BUILDINGS,
  MODULE_DOC,
  TEACHER_RUBRIC_ID,
  MODULE_ID,
} from './seed-dev.js';

const NOW = new Date();

/** Helper: attach the required Date timestamps to a plain object so Zod's
 *  isoDate (z.date()) check passes without hitting a Firestore FieldValue. */
function withTimestamps<T extends object>(obj: T): T & { createdAt: Date; updatedAt: Date } {
  return { ...obj, createdAt: NOW, updatedAt: NOW };
}

describe('seed-dev — staff records', () => {
  it('contains at least one admin staff member', () => {
    const admins = STAFF.filter((s) => s.role === SPECIAL_ROLES.administrator);
    expect(admins.length).toBeGreaterThanOrEqual(1);
  });

  it('contains at least one peer evaluator', () => {
    const pes = STAFF.filter((s) => s.role === SPECIAL_ROLES.peerEvaluator);
    expect(pes.length).toBeGreaterThanOrEqual(1);
  });

  it('contains at least two teacher staff members', () => {
    const teachers = STAFF.filter((s) => s.role === 'teacher');
    expect(teachers.length).toBeGreaterThanOrEqual(2);
  });

  it('every staff record validates against the staff schema', () => {
    for (const s of STAFF) {
      const result = staffSchema.safeParse(withTimestamps(s));
      expect(
        result.success,
        `staff/${s.email}: ${!result.success ? JSON.stringify(result.error.issues) : ''}`,
      ).toBe(true);
    }
  });

  it('all staff emails belong to @orono.k12.mn.us (no real PII)', () => {
    for (const s of STAFF) {
      expect(s.email, `${s.email} should end with @orono.k12.mn.us`).toMatch(
        /@orono\.k12\.mn\.us$/,
      );
    }
  });

  it('all staff email doc IDs are unique', () => {
    const emails = STAFF.map((s) => s.email);
    const unique = new Set(emails);
    expect(unique.size).toBe(emails.length);
  });
});

describe('seed-dev — role records', () => {
  it('includes administrator, peer-evaluator, and teacher roles', () => {
    const ids = ROLES.map((r) => r.roleId);
    expect(ids).toContain(SPECIAL_ROLES.administrator);
    expect(ids).toContain(SPECIAL_ROLES.peerEvaluator);
    expect(ids).toContain('teacher');
  });

  it('every role validates against the role schema', () => {
    for (const r of ROLES) {
      const result = roleSchema.safeParse(withTimestamps(r));
      expect(
        result.success,
        `roles/${r.roleId}: ${!result.success ? JSON.stringify(result.error.issues) : ''}`,
      ).toBe(true);
    }
  });

  it('administrator and peer-evaluator roles have isSpecialAccess=true', () => {
    const special = ROLES.filter(
      (r) => r.roleId === SPECIAL_ROLES.administrator || r.roleId === SPECIAL_ROLES.peerEvaluator,
    );
    for (const r of special) {
      expect(r.isSpecialAccess, `${r.roleId} should have isSpecialAccess=true`).toBe(true);
    }
  });
});

describe('seed-dev — rubric', () => {
  it('rubric id matches the expected constant', () => {
    expect(TEACHER_RUBRIC.rubricId).toBe(TEACHER_RUBRIC_ID);
  });

  it('rubric validates against the rubric schema', () => {
    const result = rubricSchema.safeParse(withTimestamps(TEACHER_RUBRIC));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues) : '').toBe(true);
  });

  it('rubric has exactly 4 domains', () => {
    expect(TEACHER_RUBRIC.domains).toHaveLength(4);
  });

  it('every domain has at least one component', () => {
    for (const domain of TEACHER_RUBRIC.domains) {
      expect(
        domain.components.length,
        `domain ${domain.id} should have components`,
      ).toBeGreaterThan(0);
    }
  });

  it('all component IDs follow Danielson convention (digit + letter)', () => {
    for (const domain of TEACHER_RUBRIC.domains) {
      for (const component of domain.components) {
        expect(component.id, `component id "${component.id}" should match /^[1-9][a-z]$/`).toMatch(
          /^[1-9][a-z]$/,
        );
      }
    }
  });
});

describe('seed-dev — role-year mappings', () => {
  it('all mappings validate against the roleYearMapping schema', () => {
    for (const m of ROLE_YEAR_MAPPINGS) {
      const doc = {
        roleId: m.roleId,
        year: m.year,
        assignedComponentIds: m.components,
        updatedAt: NOW,
      };
      const result = roleYearMappingSchema.safeParse(doc);
      const docId = roleYearMappingDocId(m.roleId, m.year);
      expect(
        result.success,
        `roleYearMappings/${docId}: ${!result.success ? JSON.stringify(result.error.issues) : ''}`,
      ).toBe(true);
    }
  });

  it('covers teacher years 1-6', () => {
    const teacherYears = ROLE_YEAR_MAPPINGS.filter((m) => m.roleId === 'teacher').map(
      (m) => m.year,
    );
    for (const y of [1, 2, 3, 4, 5, 6] as const) {
      expect(teacherYears, `teacher year ${y.toString()} should have a mapping`).toContain(y);
    }
  });

  it('all component IDs referenced in mappings exist in the rubric', () => {
    const allComponentIds = new Set(
      TEACHER_RUBRIC.domains.flatMap((d) => d.components.map((c) => c.id)),
    );
    for (const m of ROLE_YEAR_MAPPINGS) {
      for (const compId of m.components) {
        expect(
          allComponentIds.has(compId),
          `component "${compId}" in ${m.roleId}_${m.year.toString()} not found in rubric`,
        ).toBe(true);
      }
    }
  });
});

describe('seed-dev — buildings', () => {
  it('every building validates against the building schema', () => {
    for (const b of BUILDINGS) {
      const result = buildingSchema.safeParse(withTimestamps(b));
      expect(
        result.success,
        `buildings/${b.buildingId}: ${!result.success ? JSON.stringify(result.error.issues) : ''}`,
      ).toBe(true);
    }
  });

  it('all staff buildingId references exist in BUILDINGS', () => {
    const validIds = new Set(BUILDINGS.map((b) => b.buildingId));
    for (const s of STAFF) {
      for (const buildingId of s.buildings) {
        expect(
          validIds.has(buildingId),
          `staff/${s.email} references unknown buildingId "${buildingId}"`,
        ).toBe(true);
      }
    }
  });
});

describe('seed-dev — module', () => {
  it('module id matches the expected constant', () => {
    expect(MODULE_DOC.moduleId).toBe(MODULE_ID);
  });

  it('module doc validates against the moduleDoc schema', () => {
    const result = moduleDocSchema.safeParse(withTimestamps(MODULE_DOC));
    expect(result.success, !result.success ? JSON.stringify(result.error.issues) : '').toBe(true);
  });

  it('staff who reference the module have it in their modules array', () => {
    const staffWithModule = STAFF.filter((s) => s.modules.includes(MODULE_ID));
    expect(staffWithModule.length).toBeGreaterThanOrEqual(1);
  });
});
