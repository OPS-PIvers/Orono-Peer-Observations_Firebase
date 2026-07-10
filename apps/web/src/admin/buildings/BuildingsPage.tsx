import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ListChecks, MoreVertical, Plus, Power, PowerOff } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, PILL_COLORS, type Building, type PillColorName } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
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
import { AdminSearchInput } from '@/admin/_shared/AdminSearchInput';
import { BulkActionBar } from '@/admin/_shared/BulkActionBar';
import { bulkMerge } from '@/admin/_shared/bulkWrite';
import { useRowSelection } from '@/admin/_shared/useRowSelection';

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
  const [search, setSearch] = useState('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const { selectMode, selected, toggleRow, toggleAll, clear, toggleSelectMode } = useRowSelection();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return buildings ?? [];
    return (buildings ?? []).filter(
      (b) => b.displayName.toLowerCase().includes(q) || b.buildingId.toLowerCase().includes(q),
    );
  }, [buildings, search]);

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

  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  async function bulkSetActive(isActive: boolean) {
    setBulkError(null);
    setBulkBusy(true);
    try {
      await bulkMerge(COLLECTIONS.buildings, Array.from(selected), { isActive });
      clear();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Bulk update failed.');
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Buildings']}
      title="Buildings"
      subtitle={
        buildings
          ? `${String(sorted.length)} of ${String(buildings.length)} buildings — staff are assigned to one or more of these locations.`
          : 'Loading…'
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={selectMode ? 'default' : 'outline'}
            onClick={toggleSelectMode}
            type="button"
          >
            {selectMode ? <Check /> : <ListChecks />}
            {selectMode ? 'Done' : 'Select'}
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            <Plus />
            Add building
          </Button>
        </div>
      }
    >
      <AdminSearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by name or building ID"
        aria-label="Search buildings"
        className="mb-4"
      />

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load buildings: {error.message}
        </div>
      ) : null}

      {bulkError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          {bulkError}
        </div>
      ) : null}

      <BulkActionBar
        count={selected.size}
        noun="building"
        busy={bulkBusy}
        onClear={clear}
        actions={[
          {
            key: 'activate',
            label: 'Activate',
            icon: Power,
            onClick: () => void bulkSetActive(true),
          },
          {
            key: 'deactivate',
            label: 'Deactivate',
            icon: PowerOff,
            onClick: () => void bulkSetActive(false),
          },
        ]}
      />

      <div className={selected.size > 0 ? 'pb-20 md:pb-0' : undefined}>
        <AdminDataView
          columns={columns}
          rows={loading && !buildings ? null : sorted}
          loading={loading}
          rowKey={(b) => b.id}
          empty={
            search ? 'No buildings match that search.' : 'No buildings yet. Add one to get started.'
          }
          {...(selectMode
            ? { selection: { selected, onToggleRow: toggleRow, onToggleAll: toggleAll } }
            : { onRowClick: (b: BuildingRow) => setEditing(b) })}
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
      </div>

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

  if (open && form.buildingId !== (existing?.buildingId ?? '') && existing) {
    setForm({
      displayName: existing.displayName,
      buildingId: existing.buildingId,
      color: existing.color,
      isActive: existing.isActive,
    });
    setError(null);
    setConfirmingDelete(false);
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

    setSubmitting(true);
    try {
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
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
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
        </div>

        <DialogFooter>
          {mode === 'edit' && existing && !confirmingDelete ? (
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
          <Button onClick={() => void save()} disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
