import { describe, expect, it } from 'vitest';
import {
  moduleDoc,
  moduleSection,
  autoEnable,
  effectiveModuleIdsFor,
  effectiveModulesFor,
  staffHasModule,
  staffMatchesAutoEnable,
} from './module.js';
import { moduleItem, moduleProgress } from './moduleItem.js';

const now = new Date('2026-05-20T00:00:00Z');

describe('moduleDoc new fields', () => {
  it('defaults hasPage=false, icon=shapes, sections=[]', () => {
    const parsed = moduleDoc.parse({
      moduleId: 'mentor',
      displayName: 'Mentor',
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.hasPage).toBe(false);
    expect(parsed.icon).toBe('shapes');
    expect(parsed.sections).toEqual([]);
  });

  it('rejects an unknown icon slug', () => {
    expect(() =>
      moduleDoc.parse({
        moduleId: 'mentor',
        displayName: 'Mentor',
        icon: 'not-a-real-icon',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });
});

describe('moduleSection', () => {
  it('accepts the three section types and defaults body to empty', () => {
    const s = moduleSection.parse({ id: 's1', type: 'richtext' });
    expect(s.body).toBe('');
    expect(moduleSection.parse({ id: 's2', type: 'resources' }).type).toBe('resources');
    expect(moduleSection.parse({ id: 's3', type: 'materials' }).type).toBe('materials');
  });
});

describe('moduleItem', () => {
  it('parses a resource with a link', () => {
    const item = moduleItem.parse({
      itemId: 'i1',
      moduleId: 'mentor',
      kind: 'resource',
      sectionId: 's2',
      title: 'Handbook',
      linkUrl: 'https://example.com/handbook',
      createdAt: now,
      updatedAt: now,
    });
    expect(item.kind).toBe('resource');
    expect(item.order).toBe(0);
  });

  it('parses a material with a due date', () => {
    const item = moduleItem.parse({
      itemId: 'i2',
      moduleId: 'mentor',
      kind: 'material',
      sectionId: 's3',
      title: 'Watch onboarding video',
      dueDate: '2026-06-01',
      createdAt: now,
      updatedAt: now,
    });
    expect(item.kind).toBe('material');
    expect(item.description).toBe('');
  });

  it('rejects a malformed resource URL', () => {
    expect(() =>
      moduleItem.parse({
        itemId: 'i3',
        moduleId: 'mentor',
        kind: 'resource',
        sectionId: 's2',
        title: 'Bad link',
        linkUrl: 'not a url',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it('rejects a due date that is not yyyy-mm-dd', () => {
    expect(() =>
      moduleItem.parse({
        itemId: 'i4',
        moduleId: 'mentor',
        kind: 'material',
        sectionId: 's3',
        title: 'Bad due date',
        dueDate: '06/01/2026',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });
});

describe('moduleProgress', () => {
  it('parses a done record', () => {
    const p = moduleProgress.parse({
      itemId: 'i2',
      moduleId: 'mentor',
      status: 'done',
      completedAt: now,
    });
    expect(p.status).toBe('done');
  });
});

describe('autoEnable schema', () => {
  it('parses a status rule', () => {
    expect(autoEnable.parse({ dimension: 'status', value: 'high' })).toEqual({
      dimension: 'status',
      value: 'high',
    });
  });
  it('parses a year rule', () => {
    expect(autoEnable.parse({ dimension: 'year', value: 2 })).toEqual({
      dimension: 'year',
      value: 2,
    });
  });
  it('rejects an unknown status value', () => {
    expect(() => autoEnable.parse({ dimension: 'status', value: 'medium' })).toThrow();
  });
  it('rejects a year outside 1-3', () => {
    expect(() => autoEnable.parse({ dimension: 'year', value: 4 })).toThrow();
  });
  it('defaults moduleDoc.autoEnable to null', () => {
    const parsed = moduleDoc.parse({
      moduleId: 'mentor',
      displayName: 'Mentor',
      createdAt: now,
      updatedAt: now,
    });
    expect(parsed.autoEnable).toBeNull();
  });
});

describe('staffMatchesAutoEnable', () => {
  it('returns false for a null/undefined rule', () => {
    expect(staffMatchesAutoEnable({ year: 2, summativeYear: true }, null)).toBe(false);
    expect(staffMatchesAutoEnable({ year: 2, summativeYear: true }, undefined)).toBe(false);
  });
  it('matches on status', () => {
    expect(
      staffMatchesAutoEnable(
        { year: 2, summativeYear: true },
        { dimension: 'status', value: 'high' },
      ),
    ).toBe(true);
    expect(
      staffMatchesAutoEnable(
        { year: 2, summativeYear: false },
        { dimension: 'status', value: 'high' },
      ),
    ).toBe(false);
  });
  it('matches probationary on status for year >= 4', () => {
    expect(
      staffMatchesAutoEnable(
        { year: 5, summativeYear: false },
        { dimension: 'status', value: 'probationary' },
      ),
    ).toBe(true);
  });
  it('matches on display year, including probationary 4-6 -> 1-3', () => {
    expect(
      staffMatchesAutoEnable({ year: 2, summativeYear: false }, { dimension: 'year', value: 2 }),
    ).toBe(true);
    expect(
      staffMatchesAutoEnable({ year: 5, summativeYear: false }, { dimension: 'year', value: 2 }),
    ).toBe(true);
    expect(
      staffMatchesAutoEnable({ year: 1, summativeYear: false }, { dimension: 'year', value: 2 }),
    ).toBe(false);
  });
});

const YEAR_2 = { year: 2 as const, summativeYear: false };

function modulesNamed(ids: readonly string[]) {
  return ids.map((moduleId) => ({ moduleId, autoEnable: null }));
}

describe('staffHasModule', () => {
  it('matches a manually assigned module', () => {
    expect(
      staffHasModule({ ...YEAR_2, modules: ['mentor'] }, { moduleId: 'mentor', autoEnable: null }),
    ).toBe(true);
  });
  it('matches an auto-enabled module the staff member never picked', () => {
    expect(
      staffHasModule(
        { ...YEAR_2, modules: [] },
        { moduleId: 'ilt', autoEnable: { dimension: 'year', value: 2 } },
      ),
    ).toBe(true);
  });
  it('does not match an unassigned, unmatched module', () => {
    expect(
      staffHasModule(
        { ...YEAR_2, modules: ['mentor'] },
        { moduleId: 'ilt', autoEnable: { dimension: 'year', value: 3 } },
      ),
    ).toBe(false);
  });
  it('treats a staff doc with no `modules` field as manually unassigned', () => {
    expect(staffHasModule(YEAR_2, { moduleId: 'mentor', autoEnable: null })).toBe(false);
    expect(
      staffHasModule(YEAR_2, { moduleId: 'ilt', autoEnable: { dimension: 'year', value: 2 } }),
    ).toBe(true);
  });
});

describe('effectiveModulesFor', () => {
  it('keeps input order and the full module objects', () => {
    const modules = [
      { moduleId: 'a', autoEnable: null, displayName: 'A' },
      { moduleId: 'b', autoEnable: { dimension: 'year', value: 2 } as const, displayName: 'B' },
      { moduleId: 'c', autoEnable: null, displayName: 'C' },
    ];
    expect(effectiveModulesFor({ ...YEAR_2, modules: ['c'] }, modules)).toEqual([
      modules[1],
      modules[2],
    ]);
  });
  it('returns [] for a null/undefined module list', () => {
    expect(effectiveModulesFor(YEAR_2, null)).toEqual([]);
    expect(effectiveModulesFor(YEAR_2, undefined)).toEqual([]);
  });
});

describe('effectiveModuleIdsFor', () => {
  it('unions manual assignments with auto-enable matches', () => {
    const modules = [
      { moduleId: 'mentor', autoEnable: null },
      { moduleId: 'ilt', autoEnable: { dimension: 'year', value: 2 } as const },
      { moduleId: 'other', autoEnable: { dimension: 'year', value: 3 } as const },
    ];
    expect(effectiveModuleIdsFor({ ...YEAR_2, modules: ['mentor'] }, modules)).toEqual([
      'mentor',
      'ilt',
    ]);
  });

  it('de-duplicates a module that is both manually assigned and auto-enabled', () => {
    const modules = [{ moduleId: 'ilt', autoEnable: { dimension: 'year', value: 2 } as const }];
    expect(effectiveModuleIdsFor({ ...YEAR_2, modules: ['ilt'] }, modules)).toEqual(['ilt']);
  });

  it('keeps a manual id that has no matching module doc', () => {
    expect(effectiveModuleIdsFor({ ...YEAR_2, modules: ['deleted'] }, [])).toEqual(['deleted']);
  });

  it("does not truncate at Firestore's 30-value `in` limit", () => {
    const manual = Array.from({ length: 20 }, (_, i) => `manual-${String(i)}`);
    const autoIds = Array.from({ length: 20 }, (_, i) => `auto-${String(i)}`);
    const modules = [
      ...modulesNamed(manual),
      ...autoIds.map((moduleId) => ({
        moduleId,
        autoEnable: { dimension: 'year', value: 2 } as const,
      })),
    ];

    const ids = effectiveModuleIdsFor({ ...YEAR_2, modules: manual }, modules);

    expect(ids).toHaveLength(40);
    expect(new Set(ids)).toEqual(new Set([...manual, ...autoIds]));
  });

  it('keeps every id when a staff member is auto-enabled into more than 30 modules', () => {
    const modules = Array.from({ length: 31 }, (_, i) => ({
      moduleId: `auto-${String(i)}`,
      autoEnable: { dimension: 'year', value: 2 } as const,
    }));

    expect(effectiveModuleIdsFor(YEAR_2, modules)).toHaveLength(31);
  });
});
