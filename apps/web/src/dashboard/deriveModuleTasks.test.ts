import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleItem } from '@ops/shared';
import { deriveModuleTasks, formatDueDate, parseLocalDate } from './deriveModuleTasks';

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

// Pin the district timezone (UTC-5/-6) so the UTC-midnight-parse regression —
// due dates rendering one day early — is reproducible on UTC CI runners.
// Every assertion below also holds in whatever timezone the host is in.
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Chicago');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

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

  it('labels a task with the calendar day the admin picked, not the day before', () => {
    const items: ModuleItem[] = [
      { ...base, itemId: 'today', title: 'Due today', dueDate: '2026-06-01' },
    ];
    // 8:30 AM local on the due date itself.
    const localMorning = new Date(2026, 5, 1, 8, 30);
    const tasks = deriveModuleTasks({
      materials: items,
      doneItemIds: new Set(),
      now: localMorning,
    });
    expect(tasks.at(0)?.dateLabel).toBe('Jun 1');
    expect(tasks.at(0)?.monthLabel).toBe('Jun');
    expect(tasks.at(0)?.status).toBe('soon');
  });

  it('computes the 7-day soon window from local midnight', () => {
    const localNoon = new Date(2026, 4, 20, 12, 0);
    const items: ModuleItem[] = [
      { ...base, itemId: 'overdue', title: 'Overdue', dueDate: '2026-05-19' },
      { ...base, itemId: 'edge', title: 'Edge', dueDate: '2026-05-27' },
      { ...base, itemId: 'past-edge', title: 'Past edge', dueDate: '2026-05-28' },
    ];
    const tasks = deriveModuleTasks({ materials: items, doneItemIds: new Set(), now: localNoon });
    const byId = Object.fromEntries(tasks.map((t) => [t.moduleItemId, t.status]));
    expect(byId.overdue).toBe('soon');
    expect(byId.edge).toBe('soon'); // exactly 7 days out
    expect(byId['past-edge']).toBe('upcoming'); // 8 days out
  });
});

describe('parseLocalDate', () => {
  it('parses yyyy-mm-dd as local midnight so the picked day survives in every timezone', () => {
    const d = parseLocalDate('2026-06-01');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5);
    expect(d?.getDate()).toBe(1);
    expect(d?.getHours()).toBe(0);
  });

  it('returns null for missing, malformed, or rollover values', () => {
    expect(parseLocalDate(undefined)).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('06/01/2026')).toBeNull();
    expect(parseLocalDate('2026-13-40')).toBeNull();
  });
});

describe('formatDueDate', () => {
  it('formats the calendar date the admin picked', () => {
    expect(formatDueDate('2026-06-01')).toBe('Jun 1');
    expect(formatDueDate('2026-12-25')).toBe('Dec 25');
  });

  it('returns an empty string when there is nothing to format', () => {
    expect(formatDueDate(undefined)).toBe('');
    expect(formatDueDate('not-a-date')).toBe('');
  });
});
