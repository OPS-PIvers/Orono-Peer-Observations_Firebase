import { describe, expect, it } from 'vitest';
import {
  MODULE_CONTENT_SUBCOLLECTION,
  moduleDoc,
  moduleSection,
  moduleSectionContent,
  moduleSectionContentInput,
  autoEnable,
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
  it('accepts the three section types and carries only public layout metadata', () => {
    const s = moduleSection.parse({ id: 's1', type: 'richtext' });
    // `body` is a deprecated inline field — never auto-populated now that
    // content lives in the gated /content subcollection. Check key presence
    // rather than reading the deprecated field directly.
    expect(Object.hasOwn(s, 'body')).toBe(false);
    expect(moduleSection.parse({ id: 's2', type: 'resources' }).type).toBe('resources');
    expect(moduleSection.parse({ id: 's3', type: 'materials' }).type).toBe('materials');
  });

  it('still parses a legacy section that carries an inline body', () => {
    // A pre-migration doc with an inline body must still parse (the migration
    // relies on it). The value is preserved on the deprecated field.
    const parsed = moduleSection.safeParse({ id: 's1', type: 'richtext', body: '{"type":"doc"}' });
    expect(parsed.success).toBe(true);
    expect(parsed.data && Object.hasOwn(parsed.data, 'body')).toBe(true);
  });
});

describe('moduleSectionContent', () => {
  const now = new Date('2026-05-20T00:00:00Z');

  it('parses a content doc and defaults body to empty', () => {
    const c = moduleSectionContent.parse({
      sectionId: 'sec-1',
      moduleId: 'mentor',
      createdAt: now,
      updatedAt: now,
    });
    expect(c.body).toBe('');
    expect(c.sectionId).toBe('sec-1');
    expect(c.moduleId).toBe('mentor');
  });

  it('round-trips a serialized Tiptap body', () => {
    const body = JSON.stringify({ type: 'doc', content: [] });
    const c = moduleSectionContent.parse({
      sectionId: 'sec-1',
      moduleId: 'mentor',
      body,
      createdAt: now,
      updatedAt: now,
    });
    expect(c.body).toBe(body);
  });

  it('rejects a non-slug moduleId', () => {
    expect(() =>
      moduleSectionContent.parse({
        sectionId: 'sec-1',
        moduleId: 'Not A Slug',
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it('moduleSectionContentInput omits the server timestamps', () => {
    const parsed = moduleSectionContentInput.parse({
      sectionId: 'sec-1',
      moduleId: 'mentor',
      body: 'x',
    });
    expect('createdAt' in parsed).toBe(false);
    expect('updatedAt' in parsed).toBe(false);
  });

  it('exposes the content subcollection name constant', () => {
    expect(MODULE_CONTENT_SUBCOLLECTION).toBe('content');
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
