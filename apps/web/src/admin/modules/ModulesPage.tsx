import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, Plus } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, MODULE_COLORS, type ModuleColor, type ModuleDoc } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
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

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Sourced from the shared pill palette so module chips, the color picker, and
 *  every other pill use the same (now expanded) color set. Re-exported under
 *  the old name so existing importers keep working. */
export const MODULE_COLOR_CLASSES = PILL_COLOR_CLASSES;

type ModuleRow = ModuleDoc & { id: string };

export function ModulesPage() {
  const navigate = useNavigate();
  const { data: modules, loading, error } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ModuleRow | null>(null);
  const [sort, setSort] = useState<AdminDataViewSort | null>({
    key: 'displayName',
    direction: 'asc',
  });

  const columns: ColumnDef<ModuleRow>[] = useMemo(
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
        key: 'moduleId',
        header: 'Module ID',
        cellClassName: 'text-muted-foreground font-mono text-xs',
        sortAccessor: (r) => r.moduleId,
        cell: (r) => r.moduleId,
      },
      {
        key: 'color',
        header: 'Color',
        headClassName: 'w-28',
        sortAccessor: (r) => r.color,
        cell: (r) => {
          const cls = MODULE_COLOR_CLASSES[r.color];
          return (
            <span
              className={`inline-flex items-center rounded px-2 py-0.5 text-xs capitalize ${cls.bg} ${cls.text}`}
            >
              {r.color}
            </span>
          );
        },
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

  const sorted = useMemo(() => sortRows(modules ?? [], columns, sort), [modules, columns, sort]);

  return (
    <PageHeader
      title="Modules"
      subtitle={`${modules ? `${String(modules.length)} modules` : 'Loading…'} — participation tracks shown as color chips on staff dashboards.`}
      variant="light"
      breadcrumb={['Admin', 'Modules']}
      actions={
        <Button onClick={() => setShowCreate(true)}>
          <Plus />
          Add module
        </Button>
      }
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load modules: {error.message}
        </div>
      ) : null}

      <AdminDataView
        columns={columns}
        rows={loading && !modules ? null : sorted}
        loading={loading}
        rowKey={(r) => r.id}
        onRowClick={(r) => void navigate(`/admin/modules/${r.moduleId}`)}
        empty="No modules yet. Add one to get started."
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
              <DropdownMenuItem onSelect={() => void navigate(`/admin/modules/${r.moduleId}`)}>
                Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      />

      <ModuleDialog open={showCreate} onOpenChange={setShowCreate} mode="create" existing={null} />
      <ModuleDialog
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

interface ModuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  existing: (ModuleDoc & { id: string }) | null;
}

interface ModuleFormState {
  displayName: string;
  moduleId: string;
  description: string;
  color: ModuleColor;
  isActive: boolean;
}

const emptyForm: ModuleFormState = {
  displayName: '',
  moduleId: '',
  description: '',
  color: 'blue',
  isActive: true,
};

function ModuleDialog({ open, onOpenChange, mode, existing }: ModuleDialogProps) {
  const { user } = useAuth();

  const initial: ModuleFormState = existing
    ? {
        displayName: existing.displayName,
        moduleId: existing.moduleId,
        description: existing.description,
        color: existing.color,
        isActive: existing.isActive,
      }
    : emptyForm;

  const [form, setForm] = useState<ModuleFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (open && form.moduleId !== (existing?.moduleId ?? '') && existing) {
    setForm({
      displayName: existing.displayName,
      moduleId: existing.moduleId,
      description: existing.description,
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
        moduleId: f.moduleId === slugify(f.displayName) || !f.moduleId ? slug : f.moduleId,
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
    if (!form.moduleId.trim() || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.moduleId)) {
      setError('Module ID must be lower-kebab-case (e.g. "instructional-leadership").');
      return;
    }

    setSubmitting(true);
    try {
      await setDoc(
        doc(db, COLLECTIONS.modules, form.moduleId),
        {
          moduleId: form.moduleId,
          displayName: form.displayName.trim(),
          description: form.description.trim(),
          color: form.color,
          isActive: form.isActive,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
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
      await deleteDoc(doc(db, COLLECTIONS.modules, existing.moduleId));
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
          <DialogTitle>{mode === 'create' ? 'Add module' : 'Edit module'}</DialogTitle>
          <DialogDescription>
            Modules are participation tracks (e.g. Mentor, Mentee, ILT) shown as color chips on
            staff dashboards. Module ID is a stable slug used in Firestore — it cannot be changed
            after creation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="mod-displayName">Display name</Label>
            <Input
              id="mod-displayName"
              value={form.displayName}
              onChange={(e) => autoSlug(e.target.value)}
              autoComplete="off"
              placeholder="Instructional Leadership Team"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mod-moduleId">Module ID</Label>
            <Input
              id="mod-moduleId"
              value={form.moduleId}
              onChange={(e) => setForm((f) => ({ ...f, moduleId: e.target.value }))}
              disabled={mode === 'edit'}
              autoComplete="off"
              className="font-mono text-xs"
              placeholder="instructional-leadership-team"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="mod-description">Description (optional)</Label>
            <textarea
              id="mod-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={200}
              rows={3}
              placeholder="Brief description of this module…"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-muted-foreground text-xs">{form.description.length}/200</p>
          </div>

          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {MODULE_COLORS.map((color) => {
                const cls = MODULE_COLOR_CLASSES[color];
                const isSelected = form.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color }))}
                    aria-label={color}
                    aria-pressed={isSelected}
                    className={`inline-flex items-center rounded px-3 py-1 text-xs capitalize ring-2 ring-offset-1 transition-all ${cls.bg} ${cls.text} ${isSelected ? cls.ring : 'ring-transparent'}`}
                  >
                    {color}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
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
                assigned to this module will retain the ID, but the module doc will be gone.
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
              Delete module
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
