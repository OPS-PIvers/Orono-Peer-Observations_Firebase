import { useCallback, useMemo, useState } from 'react';
import { Check, MoreVertical, Pencil, Plus } from 'lucide-react';
import { doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { COLLECTIONS, type Building, type ModuleDoc, type Role, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { yearLabel } from '@/utils/staffFormatting';
import {
  AdminDataView,
  type AdminDataViewSort,
  type ColumnDef,
} from '@/admin/_shared/AdminDataView';
import { sortRows } from '@/admin/_shared/sortRows';
import { StaffDialog } from './StaffDialog';
import { StaffFilterBar, EMPTY_FILTERS, type StaffFilters } from './StaffFilterBar';
import { BulkEditBar } from './BulkEditBar';
import { BulkEditDialog, type BulkEditField } from './BulkEditDialog';
import {
  BuildingsCell,
  PermissionsCell,
  PermissionsChips,
  RoleCell,
  StatusCell,
  YearCell,
  type PatchStaff,
} from './StaffInlineEditors';

type StaffRow = Staff & { id: string };

// Equality-only filters (no orderBy on the wire) so these small admin
// collections don't need composite indexes; sorted client-side below.
const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_MODULES_CONSTRAINTS = [where('isActive', '==', true)];

const byDisplayName = <T extends { displayName: string }>(a: T, b: T) =>
  a.displayName.localeCompare(b.displayName);

export function StaffPage() {
  const { data: staff, loading, error } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const { data: rolesRaw } = useFirestoreCollection<Role>(
    COLLECTIONS.roles,
    ACTIVE_ROLES_CONSTRAINTS,
  );
  const { data: buildingsRaw } = useFirestoreCollection<Building>(
    COLLECTIONS.buildings,
    ACTIVE_BUILDINGS_CONSTRAINTS,
  );
  const { data: modulesRaw } = useFirestoreCollection<ModuleDoc>(
    COLLECTIONS.modules,
    ACTIVE_MODULES_CONSTRAINTS,
  );

  const roles = useMemo(() => (rolesRaw ?? []).slice().sort(byDisplayName), [rolesRaw]);
  const buildings = useMemo(() => (buildingsRaw ?? []).slice().sort(byDisplayName), [buildingsRaw]);
  const modules = useMemo(() => (modulesRaw ?? []).slice().sort(byDisplayName), [modulesRaw]);
  const buildingNames = useMemo(() => buildings.map((b) => b.displayName), [buildings]);

  const [filters, setFilters] = useState<StaffFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<AdminDataViewSort | null>({ key: 'name', direction: 'asc' });
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkEditField | null>(null);

  const patchStaff = useCallback<PatchStaff>((email, patch) => {
    void setDoc(
      doc(db, COLLECTIONS.staff, email),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }, []);

  const roleLabelByRoleId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(r.roleId, r.displayName);
    return map;
  }, [roles]);

  const filtered = useMemo(() => {
    if (!staff) return [];
    const q = filters.search.trim().toLowerCase();
    return staff.filter((s) => {
      if (q) {
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.buildings.some((b) => b.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (filters.roles.size > 0 && !filters.roles.has(s.role)) return false;
      if (filters.years.size > 0 && !filters.years.has(s.year)) return false;
      if (filters.buildings.size > 0) {
        const overlap = s.buildings.some((b) => filters.buildings.has(b));
        if (!overlap) return false;
      }
      if (filters.status === 'active' && !s.isActive) return false;
      if (filters.status === 'inactive' && s.isActive) return false;
      return true;
    });
  }, [staff, filters]);

  const columns: ColumnDef<StaffRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        cellClassName: 'font-medium',
        sortAccessor: (r) => r.name,
        cell: (r) => r.name,
        mobile: { primary: true },
      },
      {
        key: 'email',
        header: 'Email',
        cellClassName: 'text-muted-foreground',
        sortAccessor: (r) => r.email,
        cell: (r) => r.email,
      },
      {
        key: 'role',
        header: 'Role',
        sortAccessor: (r) => roleLabelByRoleId.get(r.role) ?? r.role,
        cell: (r) => roleLabelByRoleId.get(r.role) ?? r.role,
        editCell: (r) => <RoleCell row={r} roles={roles} onPatch={patchStaff} />,
      },
      {
        key: 'year',
        header: 'Year',
        headClassName: 'w-20',
        sortAccessor: (r) => r.year,
        cell: (r) => yearLabel(r.year),
        editCell: (r) => <YearCell row={r} onPatch={patchStaff} />,
      },
      {
        key: 'buildings',
        header: 'Buildings',
        sortAccessor: (r) => r.buildings.join(', '),
        cell: (r) =>
          r.buildings.length > 0 ? (
            r.buildings.join(', ')
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        editCell: (r) => (
          <BuildingsCell row={r} buildingNames={buildingNames} onPatch={patchStaff} />
        ),
      },
      {
        key: 'permissions',
        header: 'Permissions',
        sortAccessor: (r) =>
          (r.hasAdminAccess ? 1 : 0) +
          (r.summativeYear ? 1 : 0) +
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
          (r.modules ?? []).length,
        cell: (r) => <PermissionsChips row={r} modules={modules} />,
        editCell: (r) => <PermissionsCell row={r} modules={modules} onPatch={patchStaff} />,
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
        editCell: (r) => <StatusCell row={r} onPatch={patchStaff} />,
        mobile: { footer: true },
      },
    ],
    [roleLabelByRoleId, roles, buildingNames, modules, patchStaff],
  );

  const sortedRows = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(visibleIds: string[]) {
    setSelected((prev) => {
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  const selectedRows = useMemo(
    () => (staff ?? []).filter((r) => selected.has(r.email)),
    [staff, selected],
  );

  return (
    <PageHeader
      title="Staff"
      subtitle={
        staff ? `${String(sortedRows.length)} of ${String(staff.length)} staff` : 'Loading…'
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant={editMode ? 'default' : 'outline'}
            onClick={() => {
              setEditMode((m) => !m);
              setSelected(new Set());
            }}
            className={editMode ? undefined : 'bg-white/10 text-white hover:bg-white/20'}
          >
            {editMode ? <Check /> : <Pencil />}
            {editMode ? 'Done' : 'Edit'}
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
            className="text-ops-blue-dark bg-white hover:bg-white/90"
          >
            <Plus />
            Add staff
          </Button>
        </div>
      }
    >
      <StaffFilterBar filters={filters} onChange={setFilters} roles={roles} buildings={buildings} />

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load staff: {error.message}
        </div>
      ) : null}

      <BulkEditBar
        count={selected.size}
        onAction={setBulkField}
        onClear={() => setSelected(new Set())}
      />

      {/* Pad the bottom on mobile so the fixed BulkEditBar doesn't cover the
          last card. Only adds padding when there's a selection. */}
      <div className={selected.size > 0 ? 'pb-20 md:pb-0' : undefined}>
        <AdminDataView
          columns={columns}
          rows={loading && !staff ? null : sortedRows}
          loading={loading}
          rowKey={(r) => r.email}
          editing={editMode}
          empty={filters.search ? 'No staff match that search.' : 'No staff yet.'}
          {...(editMode
            ? { selection: { selected, onToggleRow: toggleRow, onToggleAll: toggleAll } }
            : { onRowClick: (r: StaffRow) => setEditing(r) })}
          sort={sort}
          onSortChange={setSort}
          rowActions={(r) => <RowActions row={r} onEdit={() => setEditing(r)} />}
        />
      </div>

      <StaffDialog open={showCreate} onOpenChange={setShowCreate} mode="create" existing={null} />
      <StaffDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        existing={editing}
      />

      <BulkEditDialog
        open={bulkField !== null}
        onOpenChange={(open) => {
          if (!open) setBulkField(null);
        }}
        field={bulkField}
        selectedRows={selectedRows}
        onApplied={() => setSelected(new Set())}
      />
    </PageHeader>
  );
}

function RowActions({ row, onEdit }: { row: StaffRow; onEdit: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 min-h-9 w-9 min-w-9"
          aria-label={`Actions for ${row.name}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(row.email);
          }}
        >
          Copy email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEdit}>
          {row.isActive ? 'Deactivate…' : 'Reactivate…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
