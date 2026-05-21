import { describe, expect, it } from 'vitest';
import type { ModuleItem } from '@ops/shared';
import { deriveModuleTasks } from './deriveModuleTasks';

const base = {
  moduleId: 'mentor',
  kind: 'material' as const,
  sectionId: 's1',
  order: 0,
  description: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const now = new Date('2026-05-20T12:00:00Z');

describe('deriveModuleTasks', () => {
  it('marks a completed material as done', () => {
    const items: ModuleItem[] = [{ ...base, itemId: 'i1', title: 'Read handbook' }];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(['i1']), now });
    expect(tasks).toHaveLength(1);
    expect(tasks.at(0)?.status).toBe('done');
    expect(tasks.at(0)?.moduleItemId).toBe('i1');
  });

  it('marks an item due within a week as soon, later as upcoming', () => {
    const items: ModuleItem[] = [
      { ...base, itemId: 'soon', title: 'Soon', dueDate: '2026-05-23' },
      { ...base, itemId: 'later', title: 'Later', dueDate: '2026-08-01' },
    ];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(), now });
    const byId = Object.fromEntries(tasks.map((t) => [t.moduleItemId, t.status]));
    expect(byId.soon).toBe('soon');
    expect(byId.later).toBe('upcoming');
  });

  it('treats a no-due-date item as upcoming', () => {
    const items: ModuleItem[] = [{ ...base, itemId: 'nd', title: 'No date' }];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(), now });
    expect(tasks.at(0)?.status).toBe('upcoming');
  });
});
