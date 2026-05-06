import { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { doc, orderBy, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_YEARS,
  isStaffYear,
  type Building,
  type Role,
  type Staff,
  type StaffYear,
} from '@ops/shared';
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
  summativeYear: false,
  isActive: true,
  hasAdminAccess: false,
};

const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true), orderBy('displayName', 'asc')];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true), orderBy('displayName', 'asc')];

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

  useEffect(() => {
    if (mode === 'edit' && existing) {
      setForm({
        email: existing.email,
        name: existing.name,
        role: existing.role,
        year: existing.year,
        buildings: existing.buildings,
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
                value={form.year}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (isStaffYear(n)) setForm((f) => ({ ...f, year: n }));
                }}
                className={SELECT_CLASSNAME}
              >
                {OBSERVATION_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y < 4 ? `Year ${String(y)}` : `Probationary ${String(y - 3)}`}
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

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.summativeYear}
                onChange={(e) => setForm((f) => ({ ...f, summativeYear: e.target.checked }))}
                className="h-4 w-4"
              />
              Summative year
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4"
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.hasAdminAccess}
                onChange={(e) => setForm((f) => ({ ...f, hasAdminAccess: e.target.checked }))}
                className="h-4 w-4"
              />
              Admin access
            </label>
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
