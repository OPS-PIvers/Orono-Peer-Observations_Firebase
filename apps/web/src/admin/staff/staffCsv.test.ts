import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EMAIL_PREFERENCES, type ModuleDoc, type Role, type Staff } from '@ops/shared';
import {
  STAFF_CSV_COLUMNS,
  csvSerializeRow,
  parseCsv,
  parseStaffCsv,
  serializeStaffCsv,
} from './staffCsv';

// Mock firebase so staffCsv's bulkWrite import doesn't trigger a real
// Firebase initialization (which requires valid env vars) during tests.
vi.mock('@/lib/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  functions: {},
  functionsHttpUrl: vi.fn(),
}));

const roles: Role[] = [
  {
    roleId: 'teacher',
    displayName: 'Teacher',
    isSpecialAccess: false,
    rubricId: 'teacher',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const modules: ModuleDoc[] = [
  {
    moduleId: 'mentor',
    displayName: 'Mentor',
    description: '',
    color: 'blue',
    isActive: true,
    hasPage: false,
    icon: 'shapes',
    sections: [],
    autoEnable: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

/** noUncheckedIndexedAccess helper: assert an array element exists and
 *  narrow it, so tests can index into `result.rows` without repeating
 *  undefined-guards. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected value to be defined');
  return value;
}

function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    email: 'jane.doe@orono.k12.mn.us',
    name: 'Jane Doe',
    role: 'teacher',
    year: 1,
    buildings: ['Intermediate School'],
    modules: ['mentor'],
    summativeYear: false,
    isActive: true,
    hasAdminAccess: false,
    emailPreferences: DEFAULT_EMAIL_PREFERENCES,
    lastSignInAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('parseCsv', () => {
  it('splits simple rows on commas and lines on newlines', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with embedded commas and escaped quotes', () => {
    const text = 'name,note\n"Doe, Jane","She said ""hi"""\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'She said "hi"'],
    ]);
  });

  it('handles CRLF line endings and a trailing blank line', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('csvSerializeRow', () => {
  it('quotes fields containing commas or quotes', () => {
    expect(csvSerializeRow(['plain', 'has,comma', 'has"quote'])).toBe(
      'plain,"has,comma","has""quote"',
    );
  });
});

describe('serializeStaffCsv + parseStaffCsv round-trip', () => {
  it('re-parses an exported roster with every row unchanged', () => {
    const staff = [makeStaff()];
    const csv = serializeStaffCsv(staff, roles, modules);
    const result = parseStaffCsv(csv, {
      roles,
      modules,
      existingByEmail: new Map(staff.map((s) => [s.email, s])),
    });

    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(must(result.rows[0]).action).toBe('unchanged');
    expect(must(result.rows[0]).errors).toEqual([]);
  });

  it('flags a new email as create and a changed field as update', () => {
    const existing = makeStaff();
    const csv = [
      'email,name,role,year,summativeYear,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,2,false,Intermediate School,Mentor,true,false',
      'new.person@orono.k12.mn.us,New Person,Teacher,1,false,,,true,false',
    ].join('\n');

    const result = parseStaffCsv(csv, {
      roles,
      modules,
      existingByEmail: new Map([[existing.email, existing]]),
    });

    expect(result.rows).toHaveLength(2);
    expect(must(result.rows[0]).action).toBe('update');
    expect(must(result.rows[0]).input?.year).toBe(2);
    expect(must(result.rows[1]).action).toBe('create');
  });

  it('reports an error for an unknown role and blocks the row', () => {
    const csv = [
      'email,name,role,year,summativeYear,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Not A Real Role,1,false,,,true,false',
    ].join('\n');

    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });

    expect(result.rows).toHaveLength(1);
    expect(must(result.rows[0]).action).toBe('error');
    expect(must(result.rows[0]).input).toBeNull();
    expect(must(must(result.rows[0]).errors[0])).toMatch(/Unknown role/);
  });

  it('rejects an email outside the allowed domain', () => {
    const csv = [
      'email,name,role,year,summativeYear,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@example.com,Jane Doe,Teacher,1,false,,,true,false',
    ].join('\n');

    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });

    expect(must(result.rows[0]).action).toBe('error');
    expect(must(result.rows[0]).errors.some((e) => e.includes('orono.k12.mn.us'))).toBe(true);
  });

  it('flags duplicate emails within the same file', () => {
    const csv = [
      'email,name,role,year,summativeYear,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,1,false,,,true,false',
      'jane.doe@orono.k12.mn.us,Jane Doe Again,Teacher,1,false,,,true,false',
    ].join('\n');

    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });

    expect(must(result.rows[1]).action).toBe('error');
    expect(must(must(result.rows[1]).errors[0])).toMatch(/Duplicate email/);
  });

  it('exports the stored status, and the summativeYear it implies', () => {
    const csv = serializeStaffCsv(
      [makeStaff({ year: 5, summativeYear: true, cycleStatus: 'developing' })],
      roles,
      modules,
    );
    const [header, line] = csv.split('\r\n');
    expect(header).toBe(STAFF_CSV_COLUMNS.join(','));
    expect(line).toContain(',5,developing,false,');
  });

  it('exports a legacy row (no stored status) with the derived status and round-trips unchanged', () => {
    const legacy = makeStaff({ year: 4, summativeYear: false });
    const csv = serializeStaffCsv([legacy], roles, modules);
    expect(csv).toContain(',4,probationary,true,');
    const result = parseStaffCsv(csv, {
      roles,
      modules,
      existingByEmail: new Map([[legacy.email, legacy]]),
    });
    expect(must(result.rows[0]).action).toBe('unchanged');
  });

  it('reads status independently of year, syncing summativeYear to the status', () => {
    const existing = makeStaff({ year: 2, summativeYear: false, cycleStatus: 'developing' });
    const csv = [
      'email,name,role,year,cycleStatus,summativeYear,buildings,modules,isActive,hasAdminAccess',
      // A label, a contradictory summativeYear cell, and a P-year.
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,5,High Cycle,false,Intermediate School,Mentor,true,false',
      'new.person@orono.k12.mn.us,New Person,Teacher,1,probationary,,,,true,false',
    ].join('\n');
    const result = parseStaffCsv(csv, {
      roles,
      modules,
      existingByEmail: new Map([[existing.email, existing]]),
    });
    expect(must(result.rows[0]).action).toBe('update');
    expect(must(result.rows[0]).input).toMatchObject({
      year: 5,
      cycleStatus: 'high',
      summativeYear: true,
    });
    expect(must(result.rows[1]).input).toMatchObject({
      year: 1,
      cycleStatus: 'probationary',
      summativeYear: true,
    });
  });

  it('flags a status-only change as an update', () => {
    const existing = makeStaff({ year: 2, cycleStatus: 'developing' });
    const csv = [
      'email,name,role,year,cycleStatus,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,2,planning,Intermediate School,Mentor,true,false',
    ].join('\n');
    const result = parseStaffCsv(csv, {
      roles,
      modules,
      existingByEmail: new Map([[existing.email, existing]]),
    });
    expect(result.missingColumns).toEqual([]);
    expect(must(result.rows[0]).action).toBe('update');
    expect(must(result.rows[0]).input?.year).toBe(2);
  });

  it('derives the status from year + summativeYear for a file with no status column', () => {
    const csv = [
      'email,name,role,year,summativeYear,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,3,true,,,true,false',
    ].join('\n');
    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });
    expect(must(result.rows[0]).input).toMatchObject({ cycleStatus: 'high', summativeYear: true });
  });

  it('rejects an unknown status', () => {
    const csv = [
      'email,name,role,year,cycleStatus,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,1,low,,,true,false',
    ].join('\n');
    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });
    expect(must(result.rows[0]).action).toBe('error');
    expect(must(must(result.rows[0]).errors[0])).toMatch(/Status must be one of/);
  });

  it('requires a status column (cycleStatus, or summativeYear on an older file)', () => {
    const csv = [
      'email,name,role,year,buildings,modules,isActive,hasAdminAccess',
      'jane.doe@orono.k12.mn.us,Jane Doe,Teacher,1,,,true,false',
    ].join('\n');
    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });
    expect(result.missingColumns).toEqual(['cycleStatus']);
  });

  it('reports missing required columns', () => {
    const csv = 'email,name\njane.doe@orono.k12.mn.us,Jane Doe\n';
    const result = parseStaffCsv(csv, { roles, modules, existingByEmail: new Map() });
    expect(result.missingColumns.length).toBeGreaterThan(0);
    expect(result.rows).toEqual([]);
  });
});
