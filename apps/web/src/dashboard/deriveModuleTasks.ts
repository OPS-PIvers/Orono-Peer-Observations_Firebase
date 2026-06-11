import type { ModuleItem, ModuleProgress } from '@ops/shared';
import type { CheckpointWithStatus } from './deriveCheckpoints';

const SOON_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Parse a yyyy-mm-dd calendar date as *local* midnight. `new Date('yyyy-mm-dd')`
 * parses as UTC midnight, which renders one day early in every timezone west of
 * UTC (e.g. America/Chicago). Returns null for missing, malformed, or
 * out-of-range values.
 */
export function parseLocalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(year, month - 1, day);
  // Reject rollover (e.g. 2026-13-40 would silently become 2027-02-09).
  const valid = d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  return valid ? d : null;
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a yyyy-mm-dd due date as the calendar day the admin picked, e.g. "Jun 1". */
export function formatDueDate(value: string | undefined): string {
  const d = parseLocalDate(value);
  return d ? shortLabel(d) : '';
}

/** Format a completion timestamp as the calendar day it was completed, e.g. "Jun 1". */
export function formatCompletedDate(value: Date | string | undefined): string {
  if (!value) return '';
  try {
    const d = value instanceof Date ? value : new Date(value);
    return !Number.isNaN(d.getTime()) ? shortLabel(d) : '';
  } catch {
    return '';
  }
}

/**
 * Convert a staff member's assigned-module material items into dashboard
 * checkpoint entries. Status comes from stored completion + the item's due
 * date — never inferred from observations.
 */
export function deriveModuleTasks(args: {
  materials: ModuleItem[];
  progress: ModuleProgress[];
  now?: Date;
}): CheckpointWithStatus[] {
  const now = args.now ?? new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Index progress by itemId for O(1) lookup
  const progressByItemId = new Map(args.progress.map((p) => [p.itemId, p]));

  return args.materials
    .filter((m) => m.kind === 'material')
    .map((m) => {
      const due = parseLocalDate(m.dueDate);
      const progressRecord = progressByItemId.get(m.itemId);
      const done = !!progressRecord;
      let status: CheckpointWithStatus['status'] = 'upcoming';
      let dueRelative = '';
      let completedLabel: string | null = null;

      if (done) {
        status = 'done';
        completedLabel = formatCompletedDate(progressRecord.completedAt);
      } else if (due) {
        // Whole calendar days from local midnight today to the due date
        // (rounded to absorb DST-shifted day lengths).
        const days = Math.round((due.getTime() - startOfToday.getTime()) / MS_PER_DAY);
        if (days < 0) {
          // Past due
          status = 'soon';
          dueRelative = 'Overdue';
        } else if (days <= SOON_WINDOW_DAYS) {
          // Within the 7-day soon window
          status = 'soon';
        } else {
          status = 'upcoming';
        }
      }

      return {
        id: `module-${m.moduleId}-${m.itemId}`,
        key: 'module' as const,
        type: 'form' as const,
        typeLabel: 'Module',
        title: m.title,
        desc: m.description,
        monthLabel: due ? due.toLocaleDateString('en-US', { month: 'short' }) : '',
        dateLabel: due ? shortLabel(due) : '',
        dueRelative,
        cta: m.ctaUrl ? 'Open' : '',
        ctaUrl: m.ctaUrl ?? '',
        status,
        completedLabel,
        percent: null,
        percentLabel: '',
        moduleItemId: m.itemId,
        moduleId: m.moduleId,
      } satisfies CheckpointWithStatus;
    });
}
