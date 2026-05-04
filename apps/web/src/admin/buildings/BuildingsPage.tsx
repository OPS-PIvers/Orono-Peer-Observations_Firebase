import { useState } from 'react';
import { Plus } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Building } from '@ops/shared';
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

export function BuildingsPage() {
  const {
    data: buildings,
    loading,
    error,
  } = useFirestoreCollection<Building>(COLLECTIONS.buildings);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<(Building & { id: string }) | null>(null);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Buildings</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {buildings ? `${String(buildings.length)} buildings` : 'Loading…'} — staff are assigned
            to one or more of these locations.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus />
          Add building
        </Button>
      </header>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load buildings: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Display name</TableHead>
              <TableHead>Building ID</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !buildings ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : buildings?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                  No buildings yet. Add one to get started.
                </TableCell>
              </TableRow>
            ) : (
              buildings?.map((b) => (
                <TableRow key={b.id} className="cursor-pointer" onClick={() => setEditing(b)}>
                  <TableCell className="font-medium">{b.displayName}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {b.buildingId}
                  </TableCell>
                  <TableCell>
                    {b.isActive ? (
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
                        setEditing(b);
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
    </div>
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
  isActive: boolean;
}

const empty: BuildingFormState = {
  displayName: '',
  buildingId: '',
  isActive: true,
};

function BuildingDialog({ open, onOpenChange, mode, existing }: BuildingDialogProps) {
  const initial: BuildingFormState = existing
    ? {
        displayName: existing.displayName,
        buildingId: existing.buildingId,
        isActive: existing.isActive,
      }
    : empty;
  const [form, setForm] = useState<BuildingFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Re-derive form when the dialog re-opens with a different `existing`.
  if (open && form.buildingId !== (existing?.buildingId ?? '') && existing) {
    setForm({
      displayName: existing.displayName,
      buildingId: existing.buildingId,
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
