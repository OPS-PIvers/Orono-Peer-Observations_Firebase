import { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { doc, orderBy, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  isStaffYear,
  type Building,
  type ModuleColor,
  type ModuleDoc,
  type Role,
  type Staff,
  type StaffYear,
} from '@ops/shared';
import { MODULE_COLOR_CLASSES } from '@/admin/modules/ModulesPage';
import { db } from '@/lib/firebase';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface StaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  existing: (Staff & { id: string }) | null;
}

interface FormState {
  email: string;
  name: string;
  role: string;
  year: StaffYear;
  buildings: string[];
  modules: string[];
  summativeYear: boolean;
  isActive: boolean;
  hasAdminAccess: boolean;
}

const empty: FormState = {
  email: '',
  name: '',
  role: '',
  year: 1,
  buildings: [],
  modules: [],
  summativeYear: false,
  isActive: true,
  hasAdminAccess: false,
};

const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true), orderBy('displayName', 'asc')];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true), orderBy('displayName', 'asc')];
// Modules: no orderBy on the wire. The collection is small (a handful of
// modules per district) and dropping the orderBy means new deployments
// don't need to wait for the composite index to finish building before
// the dropdown is usable. We sort client-side below.
const ACTIVE_MODULES_CONSTRAINTS = [where('isActive', '==', true)];

const SELECT_CLASSNAME =
  'border-input bg-background ring-offset-background focus-visible:ring-ring h-11 min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden';

export function StaffDialog({ open, onOpenChange, mode, existing }: StaffDialogProps) {
  const [form, setForm] = useState<FormState>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: roles, loading: rolesLoading } = useFirestoreCollection<Role>(
    COLLECTIONS.roles,
    ACTIVE_ROLES_CONSTRAINTS,
  );
  const { data: buildings, loading: buildingsLoading } = useFirestoreCollection<Building>(
    COLLECTIONS.buildings,
    ACTIVE_BUILDINGS_CONSTRAINTS,
  );
  const { data: modulesRaw, loading: modulesLoading } = useFirestoreCollection<ModuleDoc>(
    COLLECTIONS.modules,
    ACTIVE_MODULES_CONSTRAINTS,
  );
  const modules = useMemo(
    () => (modulesRaw ?? []).slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [modulesRaw],
  );

  useEffect(() => {
    if (mode === 'edit' && existing) {
      setForm({
        email: existing.email,
        name: existing.name,
        role: existing.role,
        year: existing.year,
        buildings: existing.buildings,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs lack this field
        modules: existing.modules ?? [],
        summativeYear: existing.summativeYear,
        isActive: existing.isActive,
        hasAdminAccess: existing.hasAdminAccess,
      });
    } else if (mode === 'create') {
      setForm(empty);
    }
    setError(null);
  }, [mode, existing, open]);

  const isUnmappedRole =
    form.role !== '' && (roles?.length ?? 0) > 0 && !roles?.some((r) => r.roleId === form.role);

  const knownBuildingNames = useMemo(
    () => new Set((buildings ?? []).map((b) => b.displayName)),
    [buildings],
  );
  const availableBuildingsToAdd = useMemo(
    () => (buildings ?? []).filter((b) => !form.buildings.includes(b.displayName)),
    [buildings, form.buildings],
  );

  const knownModuleIds = useMemo(() => new Set((modules ?? []).map((m) => m.moduleId)), [modules]);

  // Probationary status is derived from the year: 1-3 = continuing, 4-6 =
  // probationary (P1/P2/P3). The dialog splits this into a 1-3 dropdown
  // plus a checkbox so the admin can see and toggle each independently;
  // the canonical `staff.year` field still uses the 1-6 convention every
  // other consumer (dashboard, derivation logic) relies on.
  const isProbationary = form.year >= 4;
  const displayYear = isProbationary ? form.year - 3 : form.year;

  // Unified rows for the Modules picker. System flags (summative, prob,
  // admin) sit at the top in a fixed order; custom modules follow.
  // Each row maps the underlying state change back to the appropriate
  // form field so the rest of the codebase keeps using the existing
  // schema fields (staff.summativeYear, staff.year, staff.hasAdminAccess,
  // staff.modules[]) without knowing about this UI grouping.
  interface ModuleRow {
    id: string;
    name: string;
    description: string;
    color: ModuleColor;
    checked: boolean;
    onToggle: () => void;
  }
  const moduleRows: ModuleRow[] = [
    {
      id: 'sys-summative',
      name: 'Summative year',
      description: 'Marks this cycle as summative (vs formative).',
      color: 'red',
      checked: form.summativeYear,
      onToggle: () => setForm((f) => ({ ...f, summativeYear: !f.summativeYear })),
    },
    {
      id: 'sys-probationary',
      name: 'Probationary',
      description: 'Contract status — P1/P2/P3 (year shifts internally to 4–6).',
      color: 'amber',
      checked: isProbationary,
      onToggle: () => {
        const real = isProbationary ? displayYear : displayYear + 3;
        if (isStaffYear(real)) setForm((f) => ({ ...f, year: real }));
      },
    },
    {
      id: 'sys-admin',
      name: 'Admin access',
      description: 'Grants access to the Admin Console.',
      color: 'purple',
      checked: form.hasAdminAccess,
      onToggle: () => setForm((f) => ({ ...f, hasAdminAccess: !f.hasAdminAccess })),
    },
    ...modules.map((m) => ({
      id: `mod-${m.moduleId}`,
      name: m.displayName,
      description: m.description,
      color: m.color,
      checked: form.modules.includes(m.moduleId),
      onToggle: () =>
        form.modules.includes(m.moduleId) ? removeModule(m.moduleId) : addModule(m.moduleId),
    })),
  ];

  async function save() {
    setError(null);
    if (!form.email.trim() || !form.email.includes('@')) {
      setError('Email is required.');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!form.role.trim()) {
      setError('Role is required.');
      return;
    }
    if (!isStaffYear(form.year)) {
      setError('Year must be 1-6.');
      return;
    }

    setSubmitting(true);
    const email = form.email.trim().toLowerCase();
    try {
      await setDoc(
        doc(db, COLLECTIONS.staff, email),
        {
          email,
          name: form.name.trim(),
          role: form.role.trim(),
          year: form.year,
          buildings: form.buildings,
          modules: form.modules,
          summativeYear: form.summativeYear,
          isActive: form.isActive,
          hasAdminAccess: form.hasAdminAccess,
          updatedAt: serverTimestamp(),
          ...(mode === 'create' ? { createdAt: serverTimestamp() } : {}),
        },
        { merge: true },
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  function addBuilding(value: string) {
    const v = value.trim();
    if (!v) return;
    setForm((f) => (f.buildings.includes(v) ? f : { ...f, buildings: [...f.buildings, v] }));
  }

  function removeBuilding(b: string) {
    setForm((f) => ({ ...f, buildings: f.buildings.filter((x) => x !== b) }));
  }

  function addModule(moduleId: string) {
    setForm((f) =>
      f.modules.includes(moduleId) ? f : { ...f, modules: [...f.modules, moduleId] },
    );
  }

  function removeModule(moduleId: string) {
    setForm((f) => ({ ...f, modules: f.modules.filter((m) => m !== moduleId) }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add staff' : 'Edit staff'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Create a new staff record. Email is the unique key — case-insensitive.'
              : `Editing ${existing?.name ?? existing?.email ?? ''}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              disabled={mode === 'edit'}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <select
                id="role"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                disabled={rolesLoading || (roles?.length ?? 0) === 0}
                className={SELECT_CLASSNAME}
              >
                <option value="" disabled>
                  {rolesLoading
                    ? 'Loading roles…'
                    : (roles?.length ?? 0) === 0
                      ? 'No roles configured'
                      : 'Choose a role…'}
                </option>
                {isUnmappedRole ? (
                  <option value={form.role}>⚠ {form.role} (unmapped)</option>
                ) : null}
                {roles?.map((r) => (
                  <option key={r.roleId} value={r.roleId}>
                    {r.displayName}
                  </option>
                ))}
              </select>
              {isUnmappedRole ? (
                <p className="text-muted-foreground text-xs">
                  This role is not in the configured list. Pick a valid role to update.
                </p>
              ) : (roles?.length ?? 0) === 0 && !rolesLoading ? (
                <p className="text-muted-foreground text-xs">
                  Add roles in Admin → Roles before assigning.
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="year">Year</Label>
              <select
                id="year"
                value={displayYear}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const real = isProbationary ? n + 3 : n;
                  if (isStaffYear(real)) setForm((f) => ({ ...f, year: real }));
                }}
                className={SELECT_CLASSNAME}
              >
                {[1, 2, 3].map((y) => (
                  <option key={y} value={y}>
                    Year {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Buildings</Label>
            <div className="flex flex-wrap gap-2">
              {form.buildings.map((b) => {
                const unmapped = !knownBuildingNames.has(b);
                return (
                  <span
                    key={b}
                    className="bg-accent text-accent-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                  >
                    {b}
                    {unmapped ? (
                      <span className="text-muted-foreground ml-1 text-[10px]">(unmapped)</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeBuilding(b)}
                      className="hover:text-destructive"
                      aria-label={`Remove ${b}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                );
              })}
            </div>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) {
                  addBuilding(v);
                  e.currentTarget.selectedIndex = 0;
                }
              }}
              disabled={buildingsLoading || availableBuildingsToAdd.length === 0}
              className={SELECT_CLASSNAME}
              aria-label="Add a building"
            >
              <option value="">
                {buildingsLoading
                  ? 'Loading buildings…'
                  : (buildings?.length ?? 0) === 0
                    ? 'No buildings configured'
                    : availableBuildingsToAdd.length === 0
                      ? 'All buildings added'
                      : 'Add a building…'}
              </option>
              {availableBuildingsToAdd.map((b) => (
                <option key={b.buildingId} value={b.displayName}>
                  {b.displayName}
                </option>
              ))}
            </select>
            {(buildings?.length ?? 0) === 0 && !buildingsLoading ? (
              <p className="text-muted-foreground text-xs">
                Add buildings in Admin → Buildings before assigning.
              </p>
            ) : null}
          </div>

          {/* Unified module list — built-in status flags (Summative year,
              Probationary, Admin access) sit alongside admin-defined
              custom modules (Mentor, Mentee, ILT, …) so the admin sees one
              picker, not a fragmented row of checkboxes plus a separate
              custom-modules list. "Active" is intentionally not here —
              the Deactivate/Activate button in the dialog footer owns
              that state to avoid two controls fighting over the same
              field. */}
          <div className="grid gap-2">
            <Label>Modules</Label>
            <p className="text-muted-foreground -mt-1 text-xs">
              Tracks and status flags for this staff member. Toggle on or off; chips show on the
              staff dashboard where applicable.
            </p>
            <ul className="border-border bg-background divide-border divide-y overflow-hidden rounded-md border">
              {moduleRows.map((row) => {
                const palette = MODULE_COLOR_CLASSES[row.color];
                return (
                  <li key={row.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors ${
                        row.checked ? 'bg-muted/40' : 'hover:bg-muted/30'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={row.checked}
                        onChange={row.onToggle}
                        className="h-4 w-4"
                      />
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${palette.bg} ${palette.text}`}
                      >
                        {row.name}
                      </span>
                      {row.description ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {row.description}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
            {modules.length === 0 && !modulesLoading ? (
              <p className="text-muted-foreground text-xs">
                No custom modules configured yet. Add them in Admin → Modules to extend this list.
              </p>
            ) : null}
            {/* Surface any unmapped module IDs from staff.modules that don't
                resolve to a module doc (e.g., a module was deleted while
                assigned). */}
            {form.modules
              .filter((id) => !knownModuleIds.has(id))
              .map((id) => (
                <p key={id} className="text-muted-foreground text-xs">
                  ⚠ Unknown module <code className="text-xs">{id}</code> is assigned but no longer
                  exists.{' '}
                  <button
                    type="button"
                    className="text-ops-blue underline"
                    onClick={() => removeModule(id)}
                  >
                    Remove
                  </button>
                </p>
              ))}
          </div>

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {mode === 'edit' && existing ? (
            <Button
              variant="outline"
              onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
              type="button"
              className="mr-auto"
            >
              <Trash2 />
              {form.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
