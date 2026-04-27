import { useState } from 'react';
import { Plus } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Role } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function RolesPage() {
  const { data: roles, loading, error } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<(Role & { id: string }) | null>(null);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Roles</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {roles ? `${String(roles.length)} roles` : 'Loading…'} — each role has its own rubric
            and (role, year) component assignments.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus />
          Add role
        </Button>
      </header>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load roles: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Display name</TableHead>
              <TableHead>Role ID</TableHead>
              <TableHead>Rubric ID</TableHead>
              <TableHead className="w-32">Special access</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !roles ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : roles?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                  No roles yet. Add one to get started.
                </TableCell>
              </TableRow>
            ) : (
              roles?.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setEditing(r)}>
                  <TableCell className="font-medium">{r.displayName}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {r.roleId}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {r.rubricId}
                  </TableCell>
                  <TableCell>
                    {r.isSpecialAccess ? (
                      <span className="bg-ops-red-lighter text-ops-red-dark inline-flex items-center rounded px-2 py-0.5 text-xs">
                        Special
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isActive ? (
                      <span className="bg-accent text-accent-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
                        Active
                      </span>
                    ) : (
                      <span className="bg-muted text-muted-foreground inline-flex items-center rounded px-2 py-0.5 text-xs">
                        Inactive
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(r);
                      }}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
    </div>
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

  // Re-derive form when the dialog re-opens with a different `existing`.
  // Cheap: form is small, this just resets when the modal opens fresh.
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

          <div className="grid grid-cols-2 gap-4">
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
