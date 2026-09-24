import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { MoreVertical, Plus } from 'lucide-react';
import { doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  isSpecialRole,
  type AppSettings,
  type Building,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useDevMode } from '@/dev/DevModeContext';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
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
import { PillChip } from '@/admin/_shared/PillEditor';
import { STATUS_PILL_COLOR, colorClasses, paletteFor } from '@/admin/_shared/pillColors';
import { sortRows } from '@/admin/_shared/sortRows';
import { matchesStatusFilter } from '@/admin/_shared/statusFilter';
import { StaffDialog } from '@/admin/staff/StaffDialog';
import { StaffFilterBar, EMPTY_FILTERS, type StaffFilters } from '@/admin/staff/StaffFilterBar';
import { cycleStatusLabel, cycleStatusOrder, staffCycleStatus } from '@/admin/staff/staffCycle';
import {
  BuildingsPill,
  NameEmailCell,
  RolePill,
  StatusPill,
  YearPill,
  type PatchStaff,
} from '@/admin/staff/StaffInlineEditors';
import { yearLabel } from '@/utils/staffFormatting';

type StaffRow = Staff & { id: string };

const staffRowKey = (r: StaffRow) => r.email;
const staffRowLabel = (r: StaffRow) => r.name;

const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true)];

const byDisplayName = <T extends { displayName: string }>(a: T, b: T) =>
  a.displayName.localeCompare(b.displayName);

/** Administrator, Peer Evaluator and Full Access rows are district-managed:
 *  a building admin sees them but can't change them, so nobody can hand out
 *  (or take away) observer or console access from this page. */
const isLocked = (r: StaffRow) => isSpecialRole(r.role);

/**
 * Building Administrators' staff editor. The same inline pills and Add/Edit
 * dialog as Admin Console → Staff, limited to people in the admin's
 * building(s) and to the fields a building owns: name, role, buildings,
 * status, year, and archive. Module access, the Admin Console flag, CSV
 * import and rollover stay in the console.
 */
export function BuildingStaffPage() {
  const { user } = useAuth();
  const { override } = useDevMode();
  const myEmail = user?.email?.toLowerCase() ?? '';

  const { data: myStaff, loading: myStaffLoading } = useFirestoreDoc<Staff>(
    myEmail ? `${COLLECTIONS.staff}/${myEmail}` : '',
  );

  // Same scope source as MyStaffPage: dev-mode's impersonated building wins,
  // otherwise the admin's own staff doc.
  const overrideBuilding =
    override.role === 'administrator' && override.building ? override.building : null;
  const myBuildings = useMemo<string[]>(
    () => (overrideBuilding ? [overrideBuilding] : (myStaff?.buildings ?? [])),
    [overrideBuilding, myStaff],
  );
  const missingBuildings = !overrideBuilding && !myStaffLoading && myBuildings.length === 0;

  const { data: staff, loading, error } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const { data: rolesRaw } = useFirestoreCollection<Role>(
    COLLECTIONS.roles,
    ACTIVE_ROLES_CONSTRAINTS,
  );
  const { data: buildingsRaw } = useFirestoreCollection<Building>(
    COLLECTIONS.buildings,
    ACTIVE_BUILDINGS_CONSTRAINTS,
  );
  const { data: appSettings } = useFirestoreDoc<AppSettings>(
    `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
  );

  const allRoles = useMemo(() => (rolesRaw ?? []).slice().sort(byDisplayName), [rolesRaw]);
  // Only non-special roles are assignable here (see isLocked).
  const assignableRoles = useMemo(
    () => allRoles.filter((r) => !isSpecialRole(r.roleId)),
    [allRoles],
  );
  const buildings = useMemo(() => (buildingsRaw ?? []).slice().sort(byDisplayName), [buildingsRaw]);
  // The Building filter chip only offers the admin's own buildings.
  const myBuildingDocs = useMemo(
    () => buildings.filter((b) => myBuildings.includes(b.displayName)),
    [buildings, myBuildings],
  );
  const yearColors = useMemo(() => appSettings?.yearColors ?? {}, [appSettings]);

  const roleById = useMemo(() => new Map(allRoles.map((r) => [r.roleId, r])), [allRoles]);

  const buildingStaff = useMemo(() => {
    if (!staff || missingBuildings) return [];
    return staff.filter(
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
      (s) => (s.buildings ?? []).some((b) => myBuildings.includes(b)),
    );
  }, [staff, myBuildings, missingBuildings]);

  const [filters, setFilters] = useState<StaffFilters>(EMPTY_FILTERS);
  // Deferred for the same reason as Admin → Staff: rebuilding rows of inline
  // pill editors at keystroke priority drops input.
  const deferredFilters = useDeferredValue(filters);
  const [sort, setSort] = useState<AdminDataViewSort | null>({ key: 'name', direction: 'asc' });
  const [patchError, setPatchError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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

  const { filtered, hiddenByStatus } = useMemo(() => {
    const q = deferredFilters.search.trim().toLowerCase();
    const matched = buildingStaff.filter((s) => {
      if (q) {
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.buildings.some((b) => b.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (deferredFilters.roles.size > 0 && !deferredFilters.roles.has(s.role)) return false;
      if (deferredFilters.years.size > 0 && !deferredFilters.years.has(s.year)) return false;
      if (deferredFilters.buildings.size > 0) {
        if (!s.buildings.some((b) => deferredFilters.buildings.has(b))) return false;
      }
      return true;
    });
    const visible = matched.filter((s) => matchesStatusFilter(s.isActive, deferredFilters.status));
    return { filtered: visible, hiddenByStatus: matched.length - visible.length };
  }, [buildingStaff, deferredFilters]);

  const hiddenWord = deferredFilters.status === 'active' ? 'archived' : 'active';

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
        sortAccessor: (r) => roleById.get(r.role)?.displayName ?? r.role,
        cell: (r) =>
          isLocked(r) ? (
            <PillChip color={colorClasses(roleById.get(r.role)?.color) ?? paletteFor(r.role)}>
              {roleById.get(r.role)?.displayName ?? r.role}
            </PillChip>
          ) : (
            <RolePill row={r} roles={assignableRoles} onPatch={patchStaff} />
          ),
      },
      {
        key: 'buildings',
        header: 'Buildings',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
        sortAccessor: (r) => (r.buildings ?? []).join(', '),
        cell: (r) =>
          isLocked(r) ? (
            <span className="text-muted-foreground text-xs">{r.buildings.join(', ')}</span>
          ) : (
            <BuildingsPill row={r} buildings={buildings} onPatch={patchStaff} />
          ),
      },
      {
        key: 'status',
        header: 'Status',
        headClassName: 'w-36',
        sortAccessor: (r) => cycleStatusOrder(staffCycleStatus(r)),
        cell: (r) =>
          isLocked(r) ? (
            <PillChip color={STATUS_PILL_COLOR[staffCycleStatus(r)]}>
              {cycleStatusLabel(staffCycleStatus(r))}
            </PillChip>
          ) : (
            <StatusPill row={r} onPatch={patchStaff} />
          ),
      },
      {
        key: 'year',
        header: 'Year',
        headClassName: 'w-20',
        sortAccessor: (r) => r.year,
        cell: (r) =>
          isLocked(r) ? (
            <PillChip>{yearLabel(r.year)}</PillChip>
          ) : (
            <YearPill row={r} onPatch={patchStaff} yearColors={yearColors} />
          ),
      },
    ],
    [roleById, assignableRoles, buildings, patchStaff, yearColors],
  );

  const sortedRows = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  const handleRowClick = useCallback((r: StaffRow) => {
    if (!isLocked(r)) setEditing(r);
  }, []);

  const renderRowActions = useCallback(
    (r: StaffRow) =>
      isLocked(r) ? null : <RowActions row={r} onEdit={() => setEditing(r)} onPatch={patchStaff} />,
    [patchStaff],
  );

  const scopeLabel = myBuildings.join(', ');

  return (
    <PageHeader
      title="Building Staff"
      variant="light"
      subtitle={
        missingBuildings ? undefined : staff ? (
          <>
            {scopeLabel ? `${scopeLabel} · ` : null}
            {sortedRows.length} of {buildingStaff.length} staff
            {hiddenByStatus > 0 ? (
              <>
                {' · '}
                {hiddenByStatus} {hiddenWord} hidden{' '}
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, status: 'all' })}
                  className="text-ops-blue hover:text-ops-blue-dark focus-visible:ring-ring rounded-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
                >
                  Show all
                </button>
              </>
            ) : null}
          </>
        ) : (
          'Loading…'
        )
      }
      actions={
        <Button onClick={() => setShowCreate(true)} disabled={myBuildings.length === 0}>
          <Plus />
          Add staff
        </Button>
      }
    >
      {missingBuildings ? (
        <div className="bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md px-4 py-3 text-sm">
          Your building assignment isn&apos;t configured. Contact your site admin.
        </div>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {staff
          ? `${String(sortedRows.length)} of ${String(buildingStaff.length)} staff shown`
          : 'Loading staff'}
      </div>

      <StaffFilterBar
        filters={filters}
        onChange={setFilters}
        roles={allRoles}
        buildings={myBuildingDocs}
      />

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

      <AdminDataView
        columns={columns}
        rows={loading && !staff ? null : sortedRows}
        loading={loading}
        rowKey={staffRowKey}
        label="Building staff"
        rowLabel={staffRowLabel}
        empty={
          hiddenByStatus > 0
            ? `Nothing to show here — ${String(hiddenByStatus)} ${hiddenWord} ${hiddenByStatus === 1 ? 'match is' : 'matches are'} hidden by the Status filter.`
            : deferredFilters.search
              ? 'No staff match that search.'
              : 'No staff in your building yet.'
        }
        onRowClick={handleRowClick}
        sort={sort}
        onSortChange={setSort}
        rowActions={renderRowActions}
      />

      <StaffDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        mode="create"
        existing={null}
        buildingScope={myBuildings}
      />
      <StaffDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        existing={editing}
        buildingScope={myBuildings}
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
