import type { ModuleItem } from '@ops/shared';
import type { CheckpointWithStatus } from './deriveCheckpoints';

const SOON_WINDOW_DAYS = 7;

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shortLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Convert a staff member's assigned-module material items into dashboard
 * checkpoint entries. Status comes from stored completion + the item's due
 * date — never inferred from observations.
 */
export function deriveModuleTasks(args: {
  materials: ModuleItem[];
  doneItemIds: Set<string>;
  now?: Date;
}): CheckpointWithStatus[] {
  const now = args.now ?? new Date();
  return args.materials
    .filter((m) => m.kind === 'material')
    .map((m) => {
      const due = parseDate(m.dueDate);
      const done = args.doneItemIds.has(m.itemId);
      let status: CheckpointWithStatus['status'] = 'upcoming';
      if (done) {
        status = 'done';
      } else if (due) {
        const days = (due.getTime() - now.getTime()) / 86_400_000;
        status = days <= SOON_WINDOW_DAYS ? 'soon' : 'upcoming';
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
        dueRelative: '',
        cta: m.ctaUrl ? 'Open' : '',
        ctaUrl: m.ctaUrl ?? '',
        status,
        completedLabel: null,
        percent: null,
        percentLabel: '',
        moduleItemId: m.itemId,
        moduleId: m.moduleId,
      } satisfies CheckpointWithStatus;
    });
}
