import { useMemo, useState } from 'react';
import { Check, ListChecks, MoreVertical, Plus, Power, PowerOff } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, PILL_COLORS, type PillColorName, type Role } from '@ops/shared';
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

type RoleRow = Role & { id: string };

export function RolesPage() {
  const { data: roles, loading, error } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
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
    if (!q) return roles ?? [];
    return (roles ?? []).filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.roleId.toLowerCase().includes(q) ||
        r.rubricId.toLowerCase().includes(q),
    );
  }, [roles, search]);

  const columns: ColumnDef<RoleRow>[] = useMemo(
    () => [
      {
        key: 'displayName',
        header: 'Display name',
        cellClassName: 'font-medium',
        sortAccessor: (r) => r.displayName,
        cell: (r) => r.displayName,
        mobile: { primary: true },
      },
      {
        key: 'roleId',
        header: 'Role ID',
        cellClassName: 'text-muted-foreground font-mono text-xs',
        sortAccessor: (r) => r.roleId,
        cell: (r) => r.roleId,
      },
      {
        key: 'rubricId',
        header: 'Rubric ID',
        cellClassName: 'text-muted-foreground font-mono text-xs',
        sortAccessor: (r) => r.rubricId,
        cell: (r) => r.rubricId,
      },
      {
        key: 'special',
        header: 'Special access',
        headClassName: 'w-32',
        sortAccessor: (r) => (r.isSpecialAccess ? 1 : 0),
        cell: (r) =>
          r.isSpecialAccess ? (
            <Badge tone="warning">Special</Badge>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
        mobile: { footer: true },
      },
      {
        key: 'status',
        header: 'Status',
        headClassName: 'w-24',
        sortAccessor: (r) => (r.isActive ? 1 : 0),
        cell: (r) =>
          r.isActive ? (
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
      await bulkMerge(COLLECTIONS.roles, Array.from(selected), { isActive });
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
      breadcrumb={['Admin', 'Roles']}
      title="Roles"
      subtitle={
        roles
          ? `${String(sorted.length)} of ${String(roles.length)} roles — each role has its own rubric and (role, year) component assignments.`
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
            Add role
          </Button>
        </div>
      }
    >
      <AdminSearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by name, role ID, or rubric ID"
        aria-label="Search roles"
        className="mb-4"
      />

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load roles: {error.message}
        </div>
      ) : null}

      {bulkError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          {bulkError}
        </div>
      ) : null}

      <BulkActionBar
        count={selected.size}
        noun="role"
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
          rows={loading && !roles ? null : sorted}
          loading={loading}
          rowKey={(r) => r.id}
          empty={search ? 'No roles match that search.' : 'No roles yet. Add one to get started.'}
          {...(selectMode
            ? { selection: { selected, onToggleRow: toggleRow, onToggleAll: toggleAll } }
            : { onRowClick: (r: RoleRow) => setEditing(r) })}
          sort={sort}
          onSortChange={setSort}
          rowActions={(r) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 min-h-9 w-9 min-w-9"
                  aria-label={`Actions for ${r.displayName}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(r)}>Edit</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      </div>

      <RoleDialog open={showCreate} onOpenChange={setShowCreate} mode="create" existing={null} />
      <RoleDialog
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

interface RoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  existing: (Role & { id: string }) | null;
}

interface RoleFormState {
  displayName: string;
  roleId: string;
  rubricId: string;
  isSpecialAccess: boolean;
  isActive: boolean;
  color: PillColorName | undefined;
}

const empty: RoleFormState = {
  displayName: '',
  roleId: '',
  rubricId: '',
  isSpecialAccess: false,
  isActive: true,
  color: undefined,
};

function RoleDialog({ open, onOpenChange, mode, existing }: RoleDialogProps) {
  const initial: RoleFormState = existing
    ? {
        displayName: existing.displayName,
        roleId: existing.roleId,
        rubricId: existing.rubricId,
        isSpecialAccess: existing.isSpecialAccess,
        isActive: existing.isActive,
        color: existing.color,
      }
    : empty;
  const [form, setForm] = useState<RoleFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (open && form.roleId !== (existing?.roleId ?? '') && existing) {
    setForm({
      displayName: existing.displayName,
      roleId: existing.roleId,
      rubricId: existing.rubricId,
      isSpecialAccess: existing.isSpecialAccess,
      isActive: existing.isActive,
      color: existing.color,
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
        roleId: f.roleId === slugify(f.displayName) || !f.roleId ? slug : f.roleId,
        rubricId: f.rubricId === slugify(f.displayName) || !f.rubricId ? slug : f.rubricId,
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
    if (!form.roleId.trim() || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.roleId)) {
      setError('Role ID must be lower-kebab-case (e.g. "library-media-specialist").');
      return;
    }

    setSubmitting(true);
    try {
      await setDoc(
        doc(db, COLLECTIONS.roles, form.roleId),
        {
          roleId: form.roleId,
          displayName: form.displayName.trim(),
          rubricId: form.rubricId.trim() || form.roleId,
          isSpecialAccess: form.isSpecialAccess,
          isActive: form.isActive,
          ...(form.color !== undefined ? { color: form.color } : {}),
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
      await deleteDoc(doc(db, COLLECTIONS.roles, existing.roleId));
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
          <DialogTitle>{mode === 'create' ? 'Add role' : 'Edit role'}</DialogTitle>
          <DialogDescription>
            Roles drive who sees the filter UI (special access) and which rubric a staff member sees
            on their dashboard. Role ID is the slug used in URLs and Firestore — stable, can be
            reused across imports.
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
              placeholder="Library Media Specialist"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="roleId">Role ID</Label>
              <Input
                id="roleId"
                value={form.roleId}
                onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                disabled={mode === 'edit'}
                autoComplete="off"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rubricId">Rubric ID</Label>
              <Input
                id="rubricId"
                value={form.rubricId}
                onChange={(e) => setForm((f) => ({ ...f, rubricId: e.target.value }))}
                autoComplete="off"
                className="font-mono text-xs"
                placeholder="(defaults to role ID)"
              />
            </div>
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
            {form.color ? (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: undefined }))}
                className="text-muted-foreground w-fit text-xs underline-offset-2 hover:underline"
              >
                Clear color
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isSpecialAccess}
                onChange={(e) => setForm((f) => ({ ...f, isSpecialAccess: e.target.checked }))}
                className="h-4 w-4"
              />
              Special access (can use filter UI / view all observations)
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
          </div>

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          {confirmingDelete ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              <p className="mb-2">
                Permanently delete <strong>{existing?.displayName}</strong>? Staff currently
                assigned to this role will keep the role string, but the role doc will be gone.
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
              Delete role
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
