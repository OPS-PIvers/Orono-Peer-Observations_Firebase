import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Plus } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  PILL_COLORS,
  type Building,
  type PillColorName,
  type Staff,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { bulkMergePerRow } from '@/admin/_shared/bulkWrite';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AdminDataView,
  type AdminDataViewSort,
  type ColumnDef,
} from '@/admin/_shared/AdminDataView';
import { sortRows } from '@/admin/_shared/sortRows';
import { PILL_COLOR_CLASSES } from '@/admin/_shared/pillColors';

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type BuildingRow = Building & { id: string };

export function BuildingsPage() {
  const {
    data: buildings,
    loading,
    error,
  } = useFirestoreCollection<Building>(COLLECTIONS.buildings);
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<BuildingRow | null>(null);
  const [sort, setSort] = useState<AdminDataViewSort | null>({
    key: 'displayName',
    direction: 'asc',
  });

  const columns: ColumnDef<BuildingRow>[] = useMemo(
    () => [
      {
        key: 'displayName',
        header: 'Display name',
        cellClassName: 'font-medium',
        sortAccessor: (b) => b.displayName,
        cell: (b) => b.displayName,
        mobile: { primary: true },
      },
      {
        key: 'buildingId',
        header: 'Building ID',
        cellClassName: 'text-muted-foreground font-mono text-xs',
        sortAccessor: (b) => b.buildingId,
        cell: (b) => b.buildingId,
      },
      {
        key: 'status',
        header: 'Status',
        headClassName: 'w-24',
        sortAccessor: (b) => (b.isActive ? 1 : 0),
        cell: (b) =>
          b.isActive ? (
            <Badge tone="active">Active</Badge>
          ) : (
            <Badge tone="inactive">Inactive</Badge>
          ),
        mobile: { footer: true },
      },
    ],
    [],
  );

  const sorted = useMemo(
    () => sortRows(buildings ?? [], columns, sort),
    [buildings, columns, sort],
  );

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Buildings']}
      title="Buildings"
      subtitle={`${buildings ? `${String(buildings.length)} buildings` : 'Loading…'} — staff are assigned to one or more of these locations.`}
      actions={
        <Button onClick={() => setShowCreate(true)}>
          <Plus />
          Add building
        </Button>
      }
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load buildings: {error.message}
        </div>
      ) : null}

      <AdminDataView
        columns={columns}
        rows={loading && !buildings ? null : sorted}
        loading={loading}
        rowKey={(b) => b.id}
        onRowClick={(b) => setEditing(b)}
        empty="No buildings yet. Add one to get started."
        sort={sort}
        onSortChange={setSort}
        rowActions={(b) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 min-h-9 w-9 min-w-9"
                aria-label={`Actions for ${b.displayName}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(b)}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => navigate(`/admin/buildings/${b.buildingId}/schedule`)}
              >
                Edit schedule
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <BuildingDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        mode="create"
        existing={null}
      />
      <BuildingDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        existing={editing}
      />
    </PageHeader>
  );
}

interface BuildingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  existing: (Building & { id: string }) | null;
}

interface BuildingFormState {
  displayName: string;
  buildingId: string;
  color: PillColorName | undefined;
  isActive: boolean;
}

const empty: BuildingFormState = {
  displayName: '',
  buildingId: '',
  color: undefined,
  isActive: true,
};

function BuildingDialog({ open, onOpenChange, mode, existing }: BuildingDialogProps) {
  const initial: BuildingFormState = existing
    ? {
        displayName: existing.displayName,
        buildingId: existing.buildingId,
        color: existing.color,
        isActive: existing.isActive,
      }
    : empty;
  const [form, setForm] = useState<BuildingFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** Affected staff for a pending rename — null while no rename is staged. */
  const [pendingRename, setPendingRename] = useState<{
    oldName: string;
    newName: string;
    affected: { id: string; buildings: string[] }[];
  } | null>(null);

  if (open && form.buildingId !== (existing?.buildingId ?? '') && existing) {
    setForm({
      displayName: existing.displayName,
      buildingId: existing.buildingId,
      color: existing.color,
      isActive: existing.isActive,
    });
    setError(null);
    setConfirmingDelete(false);
    setPendingRename(null);
  }

  function autoSlug(name: string) {
    if (mode === 'create') {
      const slug = slugify(name);
      setForm((f) => ({
        ...f,
        displayName: name,
        buildingId: f.buildingId === slugify(f.displayName) || !f.buildingId ? slug : f.buildingId,
      }));
    } else {
      setForm((f) => ({ ...f, displayName: name }));
    }
  }

  /** Write the building doc with the current form values. */
  async function writeBuilding() {
    await setDoc(
      doc(db, COLLECTIONS.buildings, form.buildingId),
      {
        buildingId: form.buildingId,
        displayName: form.displayName.trim(),
        ...(form.color !== undefined ? { color: form.color } : {}),
        isActive: form.isActive,
        updatedAt: serverTimestamp(),
        ...(mode === 'create' ? { createdAt: serverTimestamp() } : {}),
      },
      { merge: true },
    );
  }

  async function save() {
    setError(null);
    if (!form.displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (!form.buildingId.trim() || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.buildingId)) {
      setError('Building ID must be lower-kebab-case (e.g. "high-school").');
      return;
    }

    const newName = form.displayName.trim();
    // Renaming a building: the display name is denormalized into each staff
    // member's `buildings` array, so we must cascade. Query the affected
    // staff first and ask the admin to confirm before writing anything.
    if (mode === 'edit' && existing && newName !== existing.displayName) {
      setSubmitting(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, COLLECTIONS.staff),
            where('buildings', 'array-contains', existing.displayName),
          ),
        );
        const affected = snap.docs.map((d) => {
          const data = d.data() as Staff;
          return { id: d.id, buildings: data.buildings };
        });
        setPendingRename({ oldName: existing.displayName, newName, affected });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not check affected staff');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      await writeBuilding();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  /** Commit a confirmed rename: write the building, then cascade the new
   *  display name into every affected staff member's `buildings` array. */
  async function confirmRename() {
    if (!pendingRename) return;
    setSubmitting(true);
    setError(null);
    try {
      await writeBuilding();
      const { oldName, newName, affected } = pendingRename;
      await bulkMergePerRow(
        COLLECTIONS.staff,
        affected.map((s) => s.id),
        (id) => {
          const staff = affected.find((s) => s.id === id);
          if (!staff) return null;
          return { buildings: staff.buildings.map((b) => (b === oldName ? newName : b)) };
        },
      );
      setPendingRename(null);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function destroy() {
    if (!existing) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.buildings, existing.buildingId));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add building' : 'Edit building'}</DialogTitle>
          <DialogDescription>
            Buildings appear in the Staff editor&apos;s building dropdown. Building ID is the slug
            used in URLs and Firestore — stable, can be reused across imports.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={form.displayName}
              onChange={(e) => autoSlug(e.target.value)}
              autoComplete="off"
              placeholder="High School"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="buildingId">Building ID</Label>
            <Input
              id="buildingId"
              value={form.buildingId}
              onChange={(e) => setForm((f) => ({ ...f, buildingId: e.target.value }))}
              disabled={mode === 'edit'}
              autoComplete="off"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid gap-2">
            <Label>Color (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {PILL_COLORS.map((c) => {
                const cls = PILL_COLOR_CLASSES[c];
                const isSelected = form.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: f.color === c ? undefined : c }))}
                    aria-label={c}
                    aria-pressed={isSelected}
                    className={`inline-flex items-center rounded px-3 py-1 text-xs capitalize ring-2 ring-offset-1 transition-all ${cls.bg} ${cls.text} ${isSelected ? cls.ring : 'ring-transparent'}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="h-4 w-4"
            />
            Active
          </label>

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          {confirmingDelete ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              <p className="mb-2">
                Permanently delete <strong>{existing?.displayName}</strong>? Staff currently
                assigned to this building will keep the building string, but the building doc will
                be gone.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void destroy()}
                  disabled={submitting}
                >
                  Yes, delete
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {pendingRename ? (
            <div className="border-ops-blue bg-ops-blue-lighter text-ops-blue-dark rounded-md border-l-4 px-3 py-2 text-sm">
              <p className="mb-2">
                Rename <strong>{pendingRename.oldName}</strong> to{' '}
                <strong>{pendingRename.newName}</strong>?{' '}
                {pendingRename.affected.length > 0
                  ? `This updates ${String(pendingRename.affected.length)} staff record${
                      pendingRename.affected.length === 1 ? '' : 's'
                    } assigned to this building.`
                  : 'No staff are currently assigned to this building.'}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void confirmRename()} disabled={submitting}>
                  {submitting ? 'Renaming…' : 'Yes, rename'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingRename(null)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {mode === 'edit' && existing && !confirmingDelete && !pendingRename ? (
            <Button
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              type="button"
              className="text-destructive mr-auto"
            >
              Delete building
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          {!pendingRename ? (
            <Button onClick={() => void save()} disabled={submitting}>
              {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
