import { useMemo, useState } from 'react';
import { MoreVertical, Plus } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Role } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
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
            <span className="bg-ops-red-lighter text-ops-red-dark inline-flex items-center rounded px-2 py-0.5 text-xs">
              Special
            </span>
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
            <span className="bg-accent text-accent-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
              Active
            </span>
          ) : (
            <span className="bg-muted text-muted-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
              Inactive
            </span>
          ),
        mobile: { footer: true },
      },
    ],
    [],
  );

  const sorted = useMemo(() => sortRows(roles ?? [], columns, sort), [roles, columns, sort]);

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Roles']}
      title="Roles"
      subtitle={`${roles ? `${String(roles.length)} roles` : 'Loading…'} — each role has its own rubric and (role, year) component assignments.`}
      actions={
        <Button onClick={() => setShowCreate(true)}>
          <Plus />
          Add role
        </Button>
      }
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load roles: {error.message}
        </div>
      ) : null}

      <AdminDataView
        columns={columns}
        rows={loading && !roles ? null : sorted}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEditing(r)}
        empty="No roles yet. Add one to get started."
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
}

const empty: RoleFormState = {
  displayName: '',
  roleId: '',
  rubricId: '',
  isSpecialAccess: false,
  isActive: true,
};

function RoleDialog({ open, onOpenChange, mode, existing }: RoleDialogProps) {
  const initial: RoleFormState = existing
    ? {
        displayName: existing.displayName,
        roleId: existing.roleId,
        rubricId: existing.rubricId,
        isSpecialAccess: existing.isSpecialAccess,
        isActive: existing.isActive,
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
