import { useEffect, useMemo, useState } from 'react';
import { where, type DocumentData } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_YEARS,
  isStaffYear,
  type Building,
  type ModuleDoc,
  type Role,
  type Staff,
  type StaffYear,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { BulkWriteError, bulkMergePerRow } from '@/admin/_shared/bulkWrite';
import { yearLabel } from '@/utils/staffFormatting';
import { describeBulkEditRisk, type BulkEditField } from './bulkEditRisk';

// Equality-only filters (no wire orderBy) so these small collections don't
// need composite indexes; sorted client-side below.
const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_MODULES_CONSTRAINTS = [where('isActive', '==', true)];

const SELECT_CLASSNAME =
  'border-input bg-background ring-offset-background focus-visible:ring-ring h-11 min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden';

export type { BulkEditField };

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: BulkEditField | null;
  /** Selected staff rows. Pulled by the page so we can compute per-row patches
   *  for set-union/set-difference fields. */
  selectedRows: (Staff & { id: string })[];
  onApplied: () => void;
}

interface ProgressState {
  done: number;
  total: number;
}

/** How a bulk write ended when it did not finish. `written` is the number of
 *  records that are already durable and cannot be rolled back. */
interface FailureState {
  written: number;
  planned: number;
  message: string;
}

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

export function BulkEditDialog({
  open,
  onOpenChange,
  field,
  selectedRows,
  onApplied,
}: BulkEditDialogProps) {
  const [year, setYear] = useState<StaffYear>(1);
  const [roleId, setRoleId] = useState('');
  const [building, setBuilding] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [boolValue, setBoolValue] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<FailureState | null>(null);

  const { data: rolesRaw, loading: rolesLoading } = useFirestoreCollection<Role>(
    COLLECTIONS.roles,
    ACTIVE_ROLES_CONSTRAINTS,
  );
  const { data: buildingsRaw, loading: buildingsLoading } = useFirestoreCollection<Building>(
    COLLECTIONS.buildings,
    ACTIVE_BUILDINGS_CONSTRAINTS,
  );
  const { data: modulesRaw, loading: modulesLoading } = useFirestoreCollection<ModuleDoc>(
    COLLECTIONS.modules,
    ACTIVE_MODULES_CONSTRAINTS,
  );
  const byName = (a: { displayName: string }, b: { displayName: string }) =>
    a.displayName.localeCompare(b.displayName);
  const roles = useMemo(() => (rolesRaw ?? []).slice().sort(byName), [rolesRaw]);
  const buildings = useMemo(() => (buildingsRaw ?? []).slice().sort(byName), [buildingsRaw]);
  const modules = useMemo(() => (modulesRaw ?? []).slice().sort(byName), [modulesRaw]);

  // Reset form when re-opened or field changes.
  useEffect(() => {
    if (!open) return;
    setYear(1);
    setRoleId('');
    setBuilding('');
    setModuleId('');
    setBoolValue(true);
    setConfirming(false);
    setProgress(null);
    setSubmitting(false);
    setFailure(null);
  }, [open, field]);

  const plan = useMemo(
    () =>
      field
        ? buildBulkEditPlan(field, { year, roleId, building, moduleId, boolValue }, selectedRows)
        : null,
    [field, year, roleId, building, moduleId, boolValue, selectedRows],
  );

  if (!field || !plan) return null;

  const selectedCount = selectedRows.length;
  // Every field routes through bulkMergePerRow against the planned rows only,
  // so the progress total and the failure count are the same number the
  // subtitle promised, whichever field is being edited.
  const targets = plan.kind === 'ready' ? [...plan.patches.keys()] : [];

  async function apply() {
    // `plan` is narrowed non-null above, but a hoisted function declaration
    // does not inherit that narrowing — re-check here rather than widening
    // the guard that keeps the closed dialog from rendering.
    const current = plan;
    if (current === null || current.kind === 'incomplete') {
      setFailure({
        written: 0,
        planned: 0,
        message: current === null ? 'Pick a value first.' : current.message,
      });
      return;
    }
    const patches = current.patches;
    setFailure(null);
    setSubmitting(true);
    setProgress({ done: 0, total: targets.length });
    try {
      await bulkMergePerRow(
        COLLECTIONS.staff,
        targets,
        (id) => patches.get(id) ?? null,
        (done, total) => setProgress({ done, total }),
      );
      onApplied();
      onOpenChange(false);
    } catch (err) {
      setProgress(null);
      // A BulkWriteError knows how many records are already durable. Anything
      // else failed before the first commit, so nothing was written.
      setFailure({
        written: err instanceof BulkWriteError ? err.written : 0,
        planned: targets.length,
        message: err instanceof Error ? err.message : 'Bulk update failed.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Writes that landed before a failure cannot be undone, so the dialog stays
  // open on this state and reports them instead of closing on the count.
  const partial = failure && failure.written > 0 ? failure : null;
  // Non-null only for the edits that can take down the roster or hand out the
  // admin console; those get a second step before anything is written.
  const risk = describeBulkEditRisk(field, boolValue, targets.length);
  const titles: Record<BulkEditField, string> = {
    year: 'Set year',
    role: 'Set role',
    addBuilding: 'Add building',
    removeBuilding: 'Remove building',
    addModule: 'Add module',
    removeModule: 'Remove module',
    hasAdminAccess: 'Set admin access',
    isActive: 'Set active status',
    summativeYear: 'Set summative year',
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (submitting ? null : onOpenChange(v))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[field]}</DialogTitle>
          <DialogDescription>{describeBulkEditPlan(plan, selectedCount)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {partial ? (
            <div
              role="alert"
              className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
            >
              <p className="font-medium">
                Stopped partway — {partial.written} of {partial.planned} records were updated.
              </p>
              <p className="mt-1">
                Those {partial.written} {partial.written === 1 ? 'change is' : 'changes are'} saved
                and will not be rolled back. The remaining {partial.planned - partial.written} were
                not written.
              </p>
              <p className="mt-1">
                Applying this edit again is safe: it sets the same value, so records that already
                changed are left as they are.
              </p>
              <p className="text-muted-foreground mt-2 text-xs">{partial.message}</p>
            </div>
          ) : confirming && risk ? (
            <div
              role="alert"
              className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
            >
              <p className="font-medium">{risk.title}</p>
              <p className="mt-1">{risk.detail}</p>
            </div>
          ) : (
            <>
              {field === 'year' ? (
                <div className="grid gap-2">
                  <Label htmlFor="bulk-year">Year</Label>
                  <select
                    id="bulk-year"
                    value={year}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (isStaffYear(n)) setYear(n);
                    }}
                    className={SELECT_CLASSNAME}
                  >
                    {OBSERVATION_YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y < 4
                          ? `Year ${String(y)} (${yearLabel(y)})`
                          : `Probationary ${String(y - 3)}`}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {field === 'role' ? (
                <div className="grid gap-2">
                  <Label htmlFor="bulk-role">Role</Label>
                  <select
                    id="bulk-role"
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value)}
                    className={SELECT_CLASSNAME}
                    disabled={rolesLoading}
                  >
                    <option value="" disabled>
                      {rolesLoading ? 'Loading…' : 'Choose a role…'}
                    </option>
                    {roles.map((r) => (
                      <option key={r.roleId} value={r.roleId}>
                        {r.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {field === 'addBuilding' || field === 'removeBuilding' ? (
                <div className="grid gap-2">
                  <Label htmlFor="bulk-building">Building</Label>
                  <select
                    id="bulk-building"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                    className={SELECT_CLASSNAME}
                    disabled={buildingsLoading}
                  >
                    <option value="" disabled>
                      {buildingsLoading ? 'Loading…' : 'Choose a building…'}
                    </option>
                    {buildings.map((b) => (
                      <option key={b.buildingId} value={b.displayName}>
                        {b.displayName}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted-foreground text-xs">
                    {field === 'addBuilding'
                      ? 'Adds the building to each selected staff member who doesn’t already have it.'
                      : 'Removes the building from each selected staff member who has it.'}
                  </p>
                </div>
              ) : null}

              {field === 'addModule' || field === 'removeModule' ? (
                <div className="grid gap-2">
                  <Label htmlFor="bulk-module">Module</Label>
                  <select
                    id="bulk-module"
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                    className={SELECT_CLASSNAME}
                    disabled={modulesLoading}
                  >
                    <option value="" disabled>
                      {modulesLoading ? 'Loading…' : 'Choose a module…'}
                    </option>
                    {modules.map((m) => (
                      <option key={m.moduleId} value={m.moduleId}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                  <p className="text-muted-foreground text-xs">
                    {field === 'addModule'
                      ? 'Adds the module to each selected staff member who doesn’t already have it.'
                      : 'Removes the module from each selected staff member who has it.'}
                  </p>
                </div>
              ) : null}

              {field === 'isActive' || field === 'summativeYear' || field === 'hasAdminAccess' ? (
                <div className="flex flex-col gap-2">
                  <Label>
                    {field === 'isActive'
                      ? 'Active status'
                      : field === 'summativeYear'
                        ? 'Summative year'
                        : 'Admin access'}
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={boolValue ? 'default' : 'outline'}
                      onClick={() => setBoolValue(true)}
                      className="flex-1"
                    >
                      {field === 'isActive'
                        ? 'Active'
                        : field === 'summativeYear'
                          ? 'Summative'
                          : 'Grant'}
                    </Button>
                    <Button
                      type="button"
                      variant={!boolValue ? 'default' : 'outline'}
                      onClick={() => setBoolValue(false)}
                      className="flex-1"
                    >
                      {field === 'isActive'
                        ? 'Inactive'
                        : field === 'summativeYear'
                          ? 'Not summative'
                          : 'Revoke'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {progress ? (
            <div className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
              Updating {progress.done} of {progress.total}…
            </div>
          ) : null}

          {failure && !partial ? (
            <div
              role="alert"
              className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
            >
              {failure.message}
              {failure.planned > 0 ? ' No records were changed.' : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {partial ? (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                type="button"
                disabled={submitting}
              >
                Close
              </Button>
              <Button type="button" onClick={() => void apply()} disabled={submitting}>
                {submitting ? 'Applying…' : 'Try again'}
              </Button>
            </>
          ) : confirming && risk ? (
            <>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                type="button"
                disabled={submitting}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={() => void apply()}
                disabled={submitting}
                type="button"
              >
                {submitting ? 'Applying…' : risk.confirmLabel}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                type="button"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={risk ? () => setConfirming(true) : () => void apply()}
                disabled={submitting || targets.length === 0}
              >
                {submitting
                  ? 'Applying…'
                  : risk
                    ? 'Continue'
                    : // `targets` is the planned write set, not the selection, so the
                      // button promises the same number the subtitle does.
                      `Apply to ${String(targets.length)}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
