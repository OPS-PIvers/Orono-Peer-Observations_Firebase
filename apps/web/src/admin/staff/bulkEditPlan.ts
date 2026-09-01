import { isStaffYear, type Staff, type StaffYear } from '@ops/shared';
import type { DocumentData } from 'firebase/firestore';
import type { BulkEditField } from './bulkEditRisk';

/*
 * Pure planning half of the bulk staff editor, kept out of BulkEditDialog so
 * it can be tested without importing the component — which reaches
 * `@/lib/firebase` transitively and needs live credentials just to load.
 * Same reason bulkEditRisk.ts sits beside it.
 */

/** The values every bulk-edit field can draw on; only one is ever relevant. */
export interface BulkEditValues {
  year: StaffYear;
  roleId: string;
  building: string;
  moduleId: string;
  boolValue: boolean;
}

export type BulkEditPlan =
  /** The field's value has not been chosen yet, so there is nothing to count. */
  | { kind: 'incomplete'; message: string }
  | {
      kind: 'ready';
      /** Merge-patch per staff email, holding only the rows this edit changes. */
      patches: Map<string, DocumentData>;
      /** Selected rows the edit would leave exactly as they are. */
      skipped: number;
    };

/**
 * Resolve a bulk edit against the selected rows before anything is written.
 *
 * Add/remove building and module are set operations, so a row that already
 * has the building is never written at all. Deciding that here — instead of
 * letting bulkMergePerRow discover it mid-write — is what lets the dialog
 * state how many records will change rather than how many are selected, and
 * lets a failure be reported against that same number.
 *
 * The patches come from the rows already in hand, so they are exactly as
 * fresh as the roster snapshot the admin is looking at.
 */
export function buildBulkEditPlan(
  field: BulkEditField,
  values: BulkEditValues,
  rows: readonly (Staff & { id: string })[],
): BulkEditPlan {
  const patches = new Map<string, DocumentData>();
  const everyRow = (patch: DocumentData) => {
    for (const row of rows) patches.set(row.email, patch);
  };

  switch (field) {
    case 'year': {
      if (!isStaffYear(values.year)) return { kind: 'incomplete', message: 'Pick a year.' };
      everyRow({ year: values.year });
      break;
    }
    case 'role': {
      if (!values.roleId) return { kind: 'incomplete', message: 'Pick a role.' };
      everyRow({ role: values.roleId });
      break;
    }
    case 'hasAdminAccess': {
      everyRow({ hasAdminAccess: values.boolValue });
      break;
    }
    case 'isActive': {
      everyRow({ isActive: values.boolValue });
      break;
    }
    case 'summativeYear': {
      everyRow({ summativeYear: values.boolValue });
      break;
    }
    case 'addBuilding':
    case 'removeBuilding': {
      if (!values.building) return { kind: 'incomplete', message: 'Pick a building.' };
      for (const row of rows) {
        const has = row.buildings.includes(values.building);
        if (field === 'addBuilding' && !has) {
          patches.set(row.email, { buildings: [...row.buildings, values.building] });
        } else if (field === 'removeBuilding' && has) {
          patches.set(row.email, {
            buildings: row.buildings.filter((b) => b !== values.building),
          });
        }
      }
      break;
    }
    case 'addModule':
    case 'removeModule': {
      if (!values.moduleId) return { kind: 'incomplete', message: 'Pick a module.' };
      for (const row of rows) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
        const current = row.modules ?? [];
        const has = current.includes(values.moduleId);
        if (field === 'addModule' && !has) {
          patches.set(row.email, { modules: [...current, values.moduleId] });
        } else if (field === 'removeModule' && has) {
          patches.set(row.email, { modules: current.filter((m) => m !== values.moduleId) });
        }
      }
      break;
    }
  }

  return { kind: 'ready', patches, skipped: rows.length - patches.size };
}

const staffMembers = (count: number) => `${String(count)} staff member${count === 1 ? '' : 's'}`;

/**
 * The dialog's subtitle. Says how many records the edit will actually write,
 * which for the set-valued fields is smaller than the selection — claiming
 * the selection size there would promise writes that never happen.
 */
export function describeBulkEditPlan(plan: BulkEditPlan, selectedCount: number): string {
  if (plan.kind === 'incomplete') return `${staffMembers(selectedCount)} selected.`;
  const changing = plan.patches.size;
  if (changing === 0) {
    return `All ${staffMembers(selectedCount)} selected already match — nothing to write.`;
  }
  if (plan.skipped === 0) return `Applying to ${staffMembers(changing)}.`;
  return `Applying to ${String(changing)} of ${staffMembers(selectedCount)} selected — the other ${String(plan.skipped)} already match and will be skipped.`;
}
