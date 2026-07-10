import { useCallback, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  Download,
  ListChecks,
  MoreVertical,
  Plus,
  Upload,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  type AppSettings,
  type Building,
  type ModuleDoc,
  type Role,
  type Staff,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
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
import {
  AdminDataView,
  type AdminDataViewSort,
  type ColumnDef,
} from '@/admin/_shared/AdminDataView';
import { sortRows } from '@/admin/_shared/sortRows';
import { StaffDialog } from './StaffDialog';
import { StaffImportDialog } from './StaffImportDialog';
import { RolloverDialog } from './RolloverDialog';
import { StaffFilterBar, EMPTY_FILTERS, type StaffFilters } from './StaffFilterBar';
import { BulkEditBar } from './BulkEditBar';
import { BulkEditDialog, type BulkEditField } from './BulkEditDialog';
import { downloadTextFile, serializeStaffCsv } from './staffCsv';
import {
  BuildingsPill,
  ModuleAccessPill,
  NameEmailCell,
  RolePill,
  StatusPill,
  YearPill,
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

  const { data: appSettings } = useFirestoreDoc<AppSettings>(
    `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
  );

  // Unfiltered roles/modules for the CSV export's display-name maps: staff
  // can still reference a deactivated role/module, and exporting the raw id
  // for those would break the export→import round trip (the import dialog
  // resolves against the full lists for the same reason).
  const { data: allRolesRaw } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: allModulesRaw } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules);

  const roles = useMemo(() => (rolesRaw ?? []).slice().sort(byDisplayName), [rolesRaw]);
  const buildings = useMemo(() => (buildingsRaw ?? []).slice().sort(byDisplayName), [buildingsRaw]);
  const modules = useMemo(() => (modulesRaw ?? []).slice().sort(byDisplayName), [modulesRaw]);
  const yearColors = useMemo(() => appSettings?.yearColors ?? {}, [appSettings]);

  const [filters, setFilters] = useState<StaffFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<AdminDataViewSort | null>({ key: 'name', direction: 'asc' });
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkField, setBulkField] = useState<BulkEditField | null>(null);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showRollover, setShowRollover] = useState(false);

  const patchStaff = useCallback<PatchStaff>((email, patch) => {
    setPatchError(null);
    setDoc(
      doc(db, COLLECTIONS.staff, email),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch((err: unknown) => {
      setPatchError(err instanceof Error ? err.message : 'Failed to save staff change');
    });
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
      if (filters.status === 'archived' && s.isActive) return false;
      return true;
    });
  }, [staff, filters]);

  const columns: ColumnDef<StaffRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        sortAccessor: (r) => r.name,
        cell: (r) => <NameEmailCell row={r} />,
        mobile: { primary: true },
      },
      {
        key: 'role',
        header: 'Role',
        sortAccessor: (r) => roleLabelByRoleId.get(r.role) ?? r.role,
        cell: (r) => <RolePill row={r} roles={roles} onPatch={patchStaff} />,
      },
      {
        key: 'buildings',
        header: 'Buildings',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
        sortAccessor: (r) => (r.buildings ?? []).join(', '),
        cell: (r) => <BuildingsPill row={r} buildings={buildings} onPatch={patchStaff} />,
      },
      {
        key: 'status',
        header: 'Status',
        headClassName: 'w-36',
        sortAccessor: (r) => (r.summativeYear ? 1 : 0),
        cell: (r) => <StatusPill row={r} onPatch={patchStaff} />,
      },
      {
        key: 'year',
        header: 'Year',
        headClassName: 'w-20',
        sortAccessor: (r) => r.year,
        cell: (r) => <YearPill row={r} onPatch={patchStaff} yearColors={yearColors} />,
      },
      {
        key: 'moduleAccess',
        header: 'Module Access',
        sortAccessor: (r) =>
          (r.hasAdminAccess ? 1 : 0) +
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults
          (r.modules ?? []).length,
        cell: (r) => <ModuleAccessPill row={r} modules={modules} onPatch={patchStaff} />,
      },
    ],
    [roleLabelByRoleId, roles, buildings, modules, patchStaff, yearColors],
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

  function handleExport() {
    if (!staff) return;
    const csv = serializeStaffCsv(staff, allRolesRaw ?? roles, allModulesRaw ?? modules);
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(csv, `staff-roster-${date}.csv`, 'text/csv;charset=utf-8');
  }

  return (
    <PageHeader
      title="Staff"
      variant="light"
      breadcrumb={['Admin', 'Staff']}
      subtitle={
        staff ? `${String(sortedRows.length)} of ${String(staff.length)} staff` : 'Loading…'
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={selectMode ? 'default' : 'outline'}
            onClick={() => {
              setSelectMode((m) => !m);
              setSelected(new Set());
            }}
          >
            {selectMode ? <Check /> : <ListChecks />}
            {selectMode ? 'Done' : 'Select'}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={!staff}>
            <Download />
            Export CSV
          </Button>
          <Button variant="outline" onClick={() => setShowImport(true)}>
            <Upload />
            Import CSV
          </Button>
          <Button variant="outline" onClick={() => setShowRollover(true)} disabled={!staff}>
            <CalendarClock />
            Annual rollover
          </Button>
          <Button onClick={() => setShowCreate(true)}>
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

      {patchError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          {patchError}
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
          empty={filters.search ? 'No staff match that search.' : 'No staff yet.'}
          {...(selectMode
            ? { selection: { selected, onToggleRow: toggleRow, onToggleAll: toggleAll } }
            : { onRowClick: (r: StaffRow) => setEditing(r) })}
          sort={sort}
          onSortChange={setSort}
          rowActions={(r) => (
            <RowActions row={r} onEdit={() => setEditing(r)} onPatch={patchStaff} />
          )}
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

      <StaffImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        staff={staff ?? []}
        onApplied={() => setSelected(new Set())}
      />

      <RolloverDialog
        open={showRollover}
        onOpenChange={setShowRollover}
        staff={staff ?? []}
        onApplied={() => setSelected(new Set())}
      />
    </PageHeader>
  );
}

function RowActions({
  row,
  onEdit,
  onPatch,
}: {
  row: StaffRow;
  onEdit: () => void;
  onPatch: PatchStaff;
}) {
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
        <DropdownMenuItem onSelect={onEdit}>Edit staff member</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(row.email);
          }}
        >
          Copy email
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {row.isActive ? (
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => onPatch(row.email, { isActive: false })}
          >
            Archive staff member
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onPatch(row.email, { isActive: true })}>
            Restore staff member
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
