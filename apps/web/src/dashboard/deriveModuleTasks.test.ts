import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModuleItem, ModuleProgress } from '@ops/shared';
import {
  deriveModuleTasks,
  formatDueDate,
  parseLocalDate,
  formatCompletedDate,
} from './deriveModuleTasks';

const testNow = new Date('2026-05-20T12:00:00Z');
const base = {
  moduleId: 'mentor',
  kind: 'material' as const,
  sectionId: 's1',
  order: 0,
  description: '',
  createdAt: testNow,
  updatedAt: testNow,
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
  it('marks a completed material as done with completion date', () => {
    const items: ModuleItem[] = [{ ...base, itemId: 'i1', title: 'Read handbook' }];
    const progress: ModuleProgress[] = [
      {
        itemId: 'i1',
        moduleId: 'mentor',
        status: 'done',
        completedAt: new Date('2026-05-15T14:30:00Z'),
      },
    ];
    const tasks = deriveModuleTasks({ materials: items, progress, now });
    expect(tasks).toHaveLength(1);
    expect(tasks.at(0)?.status).toBe('done');
    expect(tasks.at(0)?.moduleItemId).toBe('i1');
    expect(tasks.at(0)?.completedLabel).toBe('May 15');
  });

  it('marks an item due within a week as soon, later as upcoming', () => {
    const items: ModuleItem[] = [
      { ...base, itemId: 'soon', title: 'Soon', dueDate: '2026-05-23' },
      { ...base, itemId: 'later', title: 'Later', dueDate: '2026-08-01' },
    ];
    const tasks = deriveModuleTasks({ materials: items, progress: [], now });
    const byId = Object.fromEntries(tasks.map((t) => [t.moduleItemId, t.status]));
    expect(byId.soon).toBe('soon');
    expect(byId.later).toBe('upcoming');
  });

  it('treats a no-due-date item as upcoming', () => {
    const items: ModuleItem[] = [{ ...base, itemId: 'nd', title: 'No date' }];
    const tasks = deriveModuleTasks({ materials: items, progress: [], now });
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
      progress: [],
      now: localMorning,
    });
    expect(tasks.at(0)?.dateLabel).toBe('Jun 1');
    expect(tasks.at(0)?.monthLabel).toBe('Jun');
    expect(tasks.at(0)?.status).toBe('soon');
  });

  it('computes the 7-day soon window from local midnight', () => {
    const localNoon = new Date(2026, 4, 20, 12, 0);
    const items: ModuleItem[] = [
      { ...base, itemId: 'future-soon', title: 'Future soon', dueDate: '2026-05-27' },
      { ...base, itemId: 'future-later', title: 'Future later', dueDate: '2026-05-28' },
    ];
    const tasks = deriveModuleTasks({ materials: items, progress: [], now: localNoon });
    const byId = Object.fromEntries(tasks.map((t) => [t.moduleItemId, t.status]));
    expect(byId['future-soon']).toBe('soon'); // exactly 7 days out
    expect(byId['future-later']).toBe('upcoming'); // 8 days out
  });

  it('marks a past-due incomplete item as soon with dueRelative: Overdue', () => {
    const localNoon = new Date(2026, 4, 20, 12, 0);
    const items: ModuleItem[] = [
      { ...base, itemId: 'past', title: 'Overdue', dueDate: '2026-05-19' },
    ];
    const tasks = deriveModuleTasks({ materials: items, progress: [], now: localNoon });
    const task = tasks.at(0);
    expect(task?.status).toBe('soon');
    expect(task?.dueRelative).toBe('Overdue');
  });

  it('does not mark a completed item as overdue even if originally past-due', () => {
    const localNoon = new Date(2026, 4, 20, 12, 0);
    const items: ModuleItem[] = [
      { ...base, itemId: 'late-complete', title: 'Completed late', dueDate: '2026-05-19' },
    ];
    const progress: ModuleProgress[] = [
      {
        itemId: 'late-complete',
        moduleId: 'mentor',
        status: 'done',
        completedAt: new Date('2026-05-20T10:00:00Z'),
      },
    ];
    const tasks = deriveModuleTasks({ materials: items, progress, now: localNoon });
    const task = tasks.at(0);
    expect(task?.status).toBe('done');
    expect(task?.dueRelative).toBe('');
    expect(task?.completedLabel).toBe('May 20');
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

describe('formatCompletedDate', () => {
  it('formats a Date object to the calendar day it was completed', () => {
    expect(formatCompletedDate(new Date('2026-06-01T14:30:00Z'))).toBe('Jun 1');
    expect(formatCompletedDate(new Date('2026-05-15T08:15:30.123Z'))).toBe('May 15');
  });

  it('formats an ISO string to the calendar day it was completed', () => {
    expect(formatCompletedDate('2026-06-01T14:30:00Z')).toBe('Jun 1');
    expect(formatCompletedDate('2026-05-15T08:15:30.123Z')).toBe('May 15');
  });

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatCompletedDate(undefined)).toBe('');
    expect(formatCompletedDate('')).toBe('');
    expect(formatCompletedDate('not-a-date')).toBe('');
  });
});
