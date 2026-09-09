import { dashboardQuickMaterial, dashboardSectionsConfig, dashboardStep } from '@ops/shared';
import type { DashboardDraft } from './useDashboardDraft';
import type { TabKey } from './copyStrings';

/**
 * Pre-save validation for the admin dashboard draft.
 *
 * `useDashboardDraft.save()` used to write the draft to Firestore with no
 * zod parse at all, so an "Add link" card left blank (`label: ''`) was
 * persisted even though `dashboardQuickMaterial` requires `label.min(1)`.
 * Every write now goes through this module first; on any failure the save
 * is refused and the page routes the admin to the offending card + field.
 *
 * Errors are addressed three ways so each consumer can do its job:
 *   - `tab`       — which editor tab to switch to
 *   - `itemIndex` — position in the draft array (quick materials are
 *                   index-addressed; steps additionally carry `itemId`)
 *   - `field`     — the property name, so the editor can highlight the input
 */

export interface DraftValidationError {
  tab: TabKey;
  /** Index into `draft.steps` / `draft.quickMaterials`; -1 for page-level fields. */
  itemIndex: number;
  /** Stable step id (steps only) — the step list is sorted by `order` at
   *  render time, so index alone is not a safe key there. */
  itemId?: string;
  /** Property path on the item (e.g. `label`, `buttonUrl`). Empty for whole-item issues. */
  field: string;
  message: string;
  /** Human-readable name of the card, for the save banner. */
  cardLabel: string;
}

/** The subset of a zod issue this module reads. Kept structural so it
 *  works across zod majors (message wording differs; codes do not). */
interface IssueLike {
  path: PropertyKey[];
  message: string;
  code?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
}

/** Friendlier rewrite of zod's default messages for the fields admins touch. */
function humanize(field: string, issue: IssueLike): string {
  if (issue.code === 'too_small') return 'Required.';
  if (issue.code === 'too_big') {
    return issue.maximum !== undefined
      ? `Too long — keep it under ${String(issue.maximum)} characters.`
      : 'Too long.';
  }
  if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_value') {
    return `Not a valid choice for ${field || 'this field'}.`;
  }
  return issue.message;
}

function issuesToErrors(
  issues: readonly IssueLike[],
  base: Omit<DraftValidationError, 'field' | 'message'>,
): DraftValidationError[] {
  // One error per field — zod can emit several issues for one input and the
  // inline UI only has room for one line.
  const byField = new Map<string, DraftValidationError>();
  for (const issue of issues) {
    const field = issue.path.map(String).join('.');
    if (byField.has(field)) continue;
    byField.set(field, { ...base, field, message: humanize(field, issue) });
  }
  return [...byField.values()];
}

export function validateQuickMaterials(
  items: DashboardDraft['quickMaterials'],
): DraftValidationError[] {
  const errors: DraftValidationError[] = [];
  items.forEach((item, idx) => {
    const result = dashboardQuickMaterial.safeParse(item);
    if (result.success) return;
    errors.push(
      ...issuesToErrors(result.error.issues, {
        tab: 'materials',
        itemIndex: idx,
        cardLabel: item.label.trim() || `Link ${String(idx + 1)} (untitled)`,
      }),
    );
  });
  return errors;
}

export function validateSteps(steps: DashboardDraft['steps']): DraftValidationError[] {
  const errors: DraftValidationError[] = [];
  steps.forEach((step, idx) => {
    const result = dashboardStep.safeParse(step);
    if (result.success) return;
    errors.push(
      ...issuesToErrors(result.error.issues, {
        tab: 'steps',
        itemIndex: idx,
        itemId: step.id,
        cardLabel: step.title.trim() || `Step ${String(idx + 1)} (untitled)`,
      }),
    );
  });
  return errors;
}

export function validateLayout(
  sections: DashboardDraft['sections'],
  cycleCloseLabel: string,
): DraftValidationError[] {
  const errors: DraftValidationError[] = [];
  const sec = dashboardSectionsConfig.safeParse(sections);
  if (!sec.success) {
    errors.push(
      ...issuesToErrors(sec.error.issues, {
        tab: 'layout',
        itemIndex: -1,
        cardLabel: 'Page layout',
      }),
    );
  }
  if (cycleCloseLabel.trim().length > 50) {
    errors.push({
      tab: 'layout',
      itemIndex: -1,
      field: 'cycleCloseLabel',
      message: 'Too long — keep it under 50 characters.',
      cardLabel: 'Cycle close date',
    });
  }
  return errors;
}

export function validateDashboardDraft(draft: DashboardDraft): DraftValidationError[] {
  return [
    ...validateLayout(draft.sections, draft.cycleCloseLabel),
    ...validateSteps(draft.steps),
    ...validateQuickMaterials(draft.quickMaterials),
  ];
}

const TAB_NOUN: Record<TabKey, string> = {
  layout: 'Layout',
  steps: 'Cycle steps',
  materials: 'Quick materials',
};

/** Banner text for a refused save: names the first offending card and field. */
export function describeValidationFailure(errors: DraftValidationError[]): string {
  const first = errors[0];
  if (!first) return '';
  const where = first.field ? `“${first.cardLabel}” → ${first.field}` : `“${first.cardLabel}”`;
  const rest = errors.length > 1 ? ` (${String(errors.length - 1)} more)` : '';
  return `Not saved. ${TAB_NOUN[first.tab]}: ${where} — ${first.message}${rest}`;
}

/** Convenience for editors: find the error for one item + field. */
export function findFieldError(
  errors: readonly DraftValidationError[] | undefined,
  match: { itemIndex?: number; itemId?: string; field: string },
): string | undefined {
  if (!errors) return undefined;
  return errors.find(
    (e) =>
      e.field === match.field &&
      (match.itemId !== undefined ? e.itemId === match.itemId : e.itemIndex === match.itemIndex),
  )?.message;
}
