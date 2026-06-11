import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
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
import { bulkMerge, bulkMergePerRow } from '@/admin/_shared/bulkWrite';
import { yearLabel } from '@/utils/staffFormatting';

// Equality-only filters (no wire orderBy) so these small collections don't
// need composite indexes; sorted client-side below.
const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_MODULES_CONSTRAINTS = [where('isActive', '==', true)];

const SELECT_CLASSNAME =
  'border-input bg-background ring-offset-background focus-visible:ring-ring h-11 min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden';

export type BulkEditField =
  | 'year'
  | 'role'
  | 'addBuilding'
  | 'removeBuilding'
  | 'addModule'
  | 'removeModule'
  | 'hasAdminAccess'
  | 'isActive'
  | 'summativeYear';

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: BulkEditField | null;
  /** Selected staff rows. Pulled by the page so we can compute per-row patches
   *  for set-union/set-difference fields. */
  selectedRows: (Staff & { id: string })[];
  /** Called after a successful apply, before the dialog closes. The Staff
   *  table is a one-shot read (no live listener), so the page clears the
   *  selection and refetches the list here. */
  onApplied: () => void;
}

interface ProgressState {
  done: number;
  total: number;
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
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setProgress(null);
    setError(null);
  }, [open, field]);

  if (!field) return null;

  const ids = selectedRows.map((r) => r.email);

  async function apply() {
    setError(null);
    setProgress({ done: 0, total: ids.length });
    try {
      switch (field) {
        case 'year': {
          if (!isStaffYear(year)) throw new Error('Pick a year.');
          await bulkMerge(COLLECTIONS.staff, ids, { year }, (done, total) =>
            setProgress({ done, total }),
          );
          break;
        }
        case 'role': {
          if (!roleId) throw new Error('Pick a role.');
          await bulkMerge(COLLECTIONS.staff, ids, { role: roleId }, (done, total) =>
            setProgress({ done, total }),
          );
          break;
        }
        case 'addBuilding': {
          if (!building) throw new Error('Pick a building.');
          const byId = new Map(selectedRows.map((r) => [r.email, r]));
          await bulkMergePerRow(
            COLLECTIONS.staff,
            ids,
            (id) => {
              const row = byId.get(id);
              if (!row) return null;
              if (row.buildings.includes(building)) return null;
              return { buildings: [...row.buildings, building] };
            },
            (done, total) => setProgress({ done, total }),
          );
          break;
        }
        case 'removeBuilding': {
          if (!building) throw new Error('Pick a building.');
          const byId = new Map(selectedRows.map((r) => [r.email, r]));
          await bulkMergePerRow(
            COLLECTIONS.staff,
            ids,
            (id) => {
              const row = byId.get(id);
              if (!row) return null;
              if (!row.buildings.includes(building)) return null;
              return { buildings: row.buildings.filter((b) => b !== building) };
            },
            (done, total) => setProgress({ done, total }),
          );
          break;
        }
        case 'addModule': {
          if (!moduleId) throw new Error('Pick a module.');
          const byId = new Map(selectedRows.map((r) => [r.email, r]));
          await bulkMergePerRow(
            COLLECTIONS.staff,
            ids,
            (id) => {
              const row = byId.get(id);
              if (!row) return null;
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
              const current = row.modules ?? [];
              if (current.includes(moduleId)) return null;
              return { modules: [...current, moduleId] };
            },
            (done, total) => setProgress({ done, total }),
          );
          break;
        }
        case 'removeModule': {
          if (!moduleId) throw new Error('Pick a module.');
          const byId = new Map(selectedRows.map((r) => [r.email, r]));
          await bulkMergePerRow(
            COLLECTIONS.staff,
            ids,
            (id) => {
              const row = byId.get(id);
              if (!row) return null;
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
              const current = row.modules ?? [];
              if (!current.includes(moduleId)) return null;
              return { modules: current.filter((m) => m !== moduleId) };
            },
            (done, total) => setProgress({ done, total }),
          );
          break;
        }
        case 'hasAdminAccess': {
          await bulkMerge(COLLECTIONS.staff, ids, { hasAdminAccess: boolValue }, (done, total) =>
            setProgress({ done, total }),
          );
          break;
        }
        case 'isActive': {
          await bulkMerge(COLLECTIONS.staff, ids, { isActive: boolValue }, (done, total) =>
            setProgress({ done, total }),
          );
          break;
        }
        case 'summativeYear': {
          await bulkMerge(COLLECTIONS.staff, ids, { summativeYear: boolValue }, (done, total) =>
            setProgress({ done, total }),
          );
          break;
        }
      }
      onApplied();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk update failed.');
      setProgress(null);
    }
  }

  const submitting = progress !== null && progress.done < progress.total;
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
          <DialogDescription>
            Applying to {ids.length} staff {ids.length === 1 ? 'member' : 'members'}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
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

          {progress ? (
            <div className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
              Updating {progress.done} of {progress.total}…
            </div>
          ) : null}

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            type="button"
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={() => void apply()} disabled={submitting}>
            {submitting ? 'Applying…' : `Apply to ${String(ids.length)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
