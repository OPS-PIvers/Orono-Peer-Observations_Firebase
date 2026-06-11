import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ChevronDown, MoreVertical, Plus } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { COLLECTIONS, PILL_COLORS, type PillColorName, type Role, type Rubric } from '@ops/shared';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  color: PillColorName | undefined;
  showRubricWarning: boolean;
  missingRubricId: string | null;
}

interface DeleteCheckResult {
  staffCount: number;
  observationCount: number;
  isBlocked: boolean;
}

const empty: RoleFormState = {
  displayName: '',
  roleId: '',
  rubricId: '',
  isSpecialAccess: false,
  isActive: true,
  color: undefined,
  showRubricWarning: false,
  missingRubricId: null,
};

function RoleDialog({ open, onOpenChange, mode, existing }: RoleDialogProps) {
  const navigate = useNavigate();
  const { data: rubrics, loading: rubricsLoading } = useFirestoreCollection<Rubric>(
    COLLECTIONS.rubrics,
  );

  const initial: RoleFormState = existing
    ? {
        displayName: existing.displayName,
        roleId: existing.roleId,
        rubricId: existing.rubricId,
        isSpecialAccess: existing.isSpecialAccess,
        isActive: existing.isActive,
        color: existing.color,
        showRubricWarning: false,
        missingRubricId: null,
      }
    : empty;
  const [form, setForm] = useState<RoleFormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showRubricPicker, setShowRubricPicker] = useState(false);
  const [deleteCheckResult, setDeleteCheckResult] = useState<DeleteCheckResult | null>(null);

  if (open && form.roleId !== (existing?.roleId ?? '') && existing) {
    setForm({
      displayName: existing.displayName,
      roleId: existing.roleId,
      rubricId: existing.rubricId,
      isSpecialAccess: existing.isSpecialAccess,
      isActive: existing.isActive,
      color: existing.color,
      showRubricWarning: false,
      missingRubricId: null,
    });
    setError(null);
    setConfirmingDelete(false);
    setDeleteCheckResult(null);
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

    // Determine the final rubricId (empty field defaults to roleId)
    const finalRubricId = form.rubricId.trim() || form.roleId;

    // Check if the rubric exists
    const rubricExists = rubrics?.some((r) => r.rubricId === finalRubricId);
    if (!rubricExists) {
      // Non-blocking warning: show the warning state instead of blocking
      setForm((f) => ({
        ...f,
        showRubricWarning: true,
        missingRubricId: finalRubricId,
      }));
      return;
    }

    setSubmitting(true);
    try {
      await setDoc(
        doc(db, COLLECTIONS.roles, form.roleId),
        {
          roleId: form.roleId,
          displayName: form.displayName.trim(),
          rubricId: finalRubricId,
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

  async function saveWithWarning() {
    // This bypasses the warning and saves anyway
    const finalRubricId = form.rubricId.trim() || form.roleId;
    setSubmitting(true);
    try {
      await setDoc(
        doc(db, COLLECTIONS.roles, form.roleId),
        {
          roleId: form.roleId,
          displayName: form.displayName.trim(),
          rubricId: finalRubricId,
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

  async function checkDeletable() {
    if (!existing) return;
    setSubmitting(true);
    setError(null);
    try {
      // Count staff with this role
      const staffQuery = query(
        collection(db, COLLECTIONS.staff),
        where('role', '==', existing.roleId),
      );
      const staffCount = await getCountFromServer(staffQuery);

      // Count observations with this role
      const obsQuery = query(
        collection(db, COLLECTIONS.observations),
        where('observedRole', '==', existing.roleId),
      );
      const obsCount = await getCountFromServer(obsQuery);

      const staffTotal = staffCount.data().count;
      const obsTotal = obsCount.data().count;
      const isBlocked = staffTotal > 0 || obsTotal > 0;

      setDeleteCheckResult({
        staffCount: staffTotal,
        observationCount: obsTotal,
        isBlocked,
      });

      if (!isBlocked) {
        // If not blocked, proceed with deletion
        setConfirmingDelete(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check if role is in use');
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

  async function deactivateInstead() {
    if (!existing) return;
    setSubmitting(true);
    setError(null);
    try {
      await setDoc(
        doc(db, COLLECTIONS.roles, existing.roleId),
        {
          isActive: false,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deactivation failed');
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
              <Popover open={showRubricPicker} onOpenChange={setShowRubricPicker}>
                <PopoverTrigger asChild>
                  <button
                    id="rubricId"
                    type="button"
                    className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex items-center justify-between rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="font-mono text-xs">
                      {form.rubricId || '(defaults to role ID)'}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0">
                  <div className="max-h-64 overflow-y-auto">
                    {rubricsLoading ? (
                      <div className="text-muted-foreground px-3 py-2 text-xs">Loading…</div>
                    ) : rubrics && rubrics.length > 0 ? (
                      <>
                        {/* Option: same as role ID (will need creating) */}
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f) => ({ ...f, rubricId: '' }));
                            setShowRubricPicker(false);
                          }}
                          className="hover:bg-accent w-full px-3 py-2 text-left text-xs"
                        >
                          <span className="font-mono">(same as role ID — will need creating)</span>
                        </button>
                        <div className="border-t" />
                        {/* Existing rubrics */}
                        {rubrics.map((rubric) => (
                          <button
                            key={rubric.rubricId}
                            type="button"
                            onClick={() => {
                              setForm((f) => ({ ...f, rubricId: rubric.rubricId }));
                              setShowRubricPicker(false);
                            }}
                            className={`hover:bg-accent w-full px-3 py-2 text-left text-xs ${
                              form.rubricId === rubric.rubricId ? 'bg-accent font-medium' : ''
                            }`}
                          >
                            <span className="font-mono">{rubric.rubricId}</span>
                            <span className="text-muted-foreground ml-2">{rubric.displayName}</span>
                          </button>
                        ))}
                      </>
                    ) : (
                      <div className="text-muted-foreground px-3 py-2 text-xs">
                        No rubrics found. You can type any ID here, but it must match an existing
                        rubric.
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
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

          <div className="grid gap-2">
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
            <p className="text-muted-foreground text-xs">
              Special access takes effect at each user’s next sign-in. The built-in Administrator,
              Peer Evaluator, and Full Access roles always keep it. Admin pages are separate — they
              require an admin role or per-staff admin access, not this checkbox.
            </p>
          </div>

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          {form.showRubricWarning && form.missingRubricId !== null ? (
            <div className="border-warning rounded-md border-l-4 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              <div className="flex gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="flex-1">
                  <p className="mb-1 font-medium">
                    Rubric &quot;{form.missingRubricId}&quot; does not exist yet.
                  </p>
                  <p className="mb-2 text-xs">
                    Staff members in this role won&apos;t see a rubric until one is created. You can
                    create it now or come back later.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        // Note: rubric creation page is in a future phase
                        // For now, just close and let the user know to create it manually
                        void navigate(
                          `/admin/rubrics?create=${encodeURIComponent(form.missingRubricId ?? '')}`,
                        );
                      }}
                    >
                      Create rubric
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          showRubricWarning: false,
                          missingRubricId: null,
                        }));
                      }}
                    >
                      Continue anyway
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {deleteCheckResult ? (
            deleteCheckResult.isBlocked ? (
              <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
                <p className="mb-2">
                  <strong>Cannot delete this role — it is currently in use:</strong>
                </p>
                <ul className="mb-3 ml-4 list-disc space-y-1 text-sm">
                  {deleteCheckResult.staffCount > 0 ? (
                    <li>
                      <strong>{deleteCheckResult.staffCount}</strong> staff{' '}
                      {deleteCheckResult.staffCount === 1 ? 'member' : 'members'} assigned to this
                      role
                    </li>
                  ) : null}
                  {deleteCheckResult.observationCount > 0 ? (
                    <li>
                      <strong>{deleteCheckResult.observationCount}</strong> observation
                      {deleteCheckResult.observationCount === 1 ? '' : 's'} referencing this role
                    </li>
                  ) : null}
                </ul>
                <p className="mb-3 text-xs">
                  To protect historical data, staff and observations keep their role reference even
                  after the role is deactivated. Consider deactivating instead of deleting.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void deactivateInstead()}
                    disabled={submitting}
                  >
                    Deactivate instead
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleteCheckResult(null)}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null
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
          {mode === 'edit' && existing && !confirmingDelete && !deleteCheckResult ? (
            <Button
              variant="ghost"
              onClick={() => void checkDeletable()}
              type="button"
              className="text-destructive mr-auto"
              disabled={submitting}
            >
              Delete role
            </Button>
          ) : null}
          {confirmingDelete ? (
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
              type="button"
              disabled={submitting}
              className="mr-auto"
            >
              Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          {!confirmingDelete && !deleteCheckResult && form.showRubricWarning ? (
            <Button
              onClick={() => void saveWithWarning()}
              disabled={submitting}
              className="bg-warning hover:bg-warning/90 text-warning-foreground"
            >
              {submitting ? 'Saving…' : 'Save anyway'}
            </Button>
          ) : !confirmingDelete && !deleteCheckResult ? (
            <Button onClick={() => void save()} disabled={submitting}>
              {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
