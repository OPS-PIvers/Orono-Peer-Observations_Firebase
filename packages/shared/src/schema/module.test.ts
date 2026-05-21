import { describe, expect, it } from 'vitest';
import { moduleDoc, moduleSection } from './module.js';
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
