import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, MoreVertical, Pencil, Plus } from 'lucide-react';
import { doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  SPECIAL_ROLES,
  isSpecialRole,
  observeBlockReason,
  type AppSettings,
  type Building,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useDevMode, useEffectiveClaims } from '@/dev/DevModeContext';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useNewObservationsDisabled } from '@/hooks/useNewObservationsDisabled';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
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
import { CreateObservationDialog } from '@/observations/CreateObservationDialog';
import { yearLabel } from '@/utils/staffFormatting';

type StaffRow = Staff & { id: string };
type StaffTab = 'all' | 'probationary' | 'highCycle';

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
 * Why saving `after` would take `before` off the administrator's evaluation
 * list (active, summative, in one of their buildings), or null when it
 * wouldn't. Used to confirm inline edits, archiving and dialog saves.
 */
function evaluationListWarning(
  before: StaffRow,
  after: StaffRow,
  myBuildings: string[],
): string | null {
  const scope = { role: SPECIAL_ROLES.administrator, buildings: myBuildings };
  if (observeBlockReason(scope, before) !== null) return null;
  if (observeBlockReason(scope, after) === null) return null;
  if (!after.isActive) {
    return `Archiving ${before.name} removes them from your evaluation list.`;
  }
  if (!after.buildings.some((b) => myBuildings.includes(b))) {
    return `${before.name} will no longer be in your building, so they'll leave My Staff and you won't be able to observe them.`;
  }
  return `Changing ${before.name} to ${cycleStatusLabel(staffCycleStatus(after))} removes them from your Probationary and High Cycle lists, and you won't be able to start new observations for them.`;
}

/**
 * Building Administrators' staff page. Everyone active in their building(s),
 * with Probationary and High Cycle tabs for the evaluation caseload and a
 * Start observation action per row. Editing (the same inline pills and
 * Add/Edit dialog as Admin Console → Staff, limited to the fields a building
 * owns) only happens after "Edit roster"; module access, the Admin Console
 * flag, CSV import and rollover stay in the console.
 */
export function MyStaffPage() {
  const { user } = useAuth();
  const { override } = useDevMode();
  const { role } = useEffectiveClaims();
  const navigate = useNavigate();
  const newObservationsDisabled = useNewObservationsDisabled();
  const myEmail = user?.email?.toLowerCase() ?? '';

  const { data: myStaff, loading: myStaffLoading } = useFirestoreDoc<Staff>(
    myEmail ? `${COLLECTIONS.staff}/${myEmail}` : '',
  );

  // Dev mode can override the building scope when impersonating
  // Administrator for a specific building; otherwise the admin's own doc.
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
  const staffByEmail = useMemo(
    () => new Map(buildingStaff.map((s) => [s.email, s])),
    [buildingStaff],
  );

  const [activeTab, setActiveTab] = useState<StaffTab>('all');
  const [filters, setFilters] = useState<StaffFilters>(EMPTY_FILTERS);
  // Deferred for the same reason as Admin → Staff: rebuilding rows of inline
  // pill editors at keystroke priority drops input.
  const deferredFilters = useDeferredValue(filters);
  const [sort, setSort] = useState<AdminDataViewSort | null>({ key: 'name', direction: 'asc' });
  // Editing is always off on arrival: changes only happen after an explicit
  // "Edit roster".
  const [editMode, setEditMode] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [observing, setObserving] = useState<StaffRow | null>(null);
  const [pendingPatch, setPendingPatch] = useState<{
    email: string;
    patch: Partial<Staff>;
    message: string;
  } | null>(null);

  const writePatch = useCallback<PatchStaff>((email, patch) => {
    setPatchError(null);
    setDoc(
      doc(db, COLLECTIONS.staff, email),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch((err: unknown) => {
      setPatchError(err instanceof Error ? err.message : 'Failed to save staff change');
    });
  }, []);

  // Every inline edit and archive goes through here: a change that would
  // drop someone off the evaluation list waits for confirmation.
  const patchStaff = useCallback<PatchStaff>(
    (email, patch) => {
      const row = staffByEmail.get(email);
      const message = row ? evaluationListWarning(row, { ...row, ...patch }, myBuildings) : null;
      if (message) setPendingPatch({ email, patch, message });
      else writePatch(email, patch);
    },
    [staffByEmail, myBuildings, writePatch],
  );

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

  // Tabs key off status, not year: a P-year teacher whose status is
  // Developing is not on the Probationary tab.
  const probationary = useMemo(
    () => filtered.filter((s) => staffCycleStatus(s) === 'probationary'),
    [filtered],
  );
  const highCycle = useMemo(
    () => filtered.filter((s) => staffCycleStatus(s) === 'high'),
    [filtered],
  );
  const tabRows =
    activeTab === 'all' ? filtered : activeTab === 'probationary' ? probationary : highCycle;
  const tabs: { id: StaffTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: filtered.length },
    { id: 'probationary', label: 'Probationary', count: probationary.length },
    { id: 'highCycle', label: 'High Cycle', count: highCycle.length },
  ];

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
        cell: (r) => (
          <PillChip color={colorClasses(roleById.get(r.role)?.color) ?? paletteFor(r.role)}>
            {roleById.get(r.role)?.displayName ?? r.role}
          </PillChip>
        ),
        editCell: (r) =>
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
        cell: (r) => (
          <span className="text-muted-foreground text-xs">{r.buildings.join(', ')}</span>
        ),
        editCell: (r) =>
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
        cell: (r) => (
          <PillChip color={STATUS_PILL_COLOR[staffCycleStatus(r)]}>
            {cycleStatusLabel(staffCycleStatus(r))}
          </PillChip>
        ),
        editCell: (r) =>
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
        cell: (r) => <PillChip>{yearLabel(r.year)}</PillChip>,
        editCell: (r) =>
          isLocked(r) ? (
            <PillChip>{yearLabel(r.year)}</PillChip>
          ) : (
            <YearPill row={r} onPatch={patchStaff} yearColors={yearColors} />
          ),
      },
    ],
    [roleById, assignableRoles, buildings, patchStaff, yearColors],
  );

  const sortedRows = useMemo(() => sortRows(tabRows, columns, sort), [tabRows, columns, sort]);

  const handleRowClick = useCallback(
    (r: StaffRow) => {
      if (editMode) {
        if (!isLocked(r)) setEditing(r);
      } else {
        void navigate(`/staff/${encodeURIComponent(r.email.toLowerCase())}`);
      }
    },
    [editMode, navigate],
  );

  const observerScope = useMemo(() => ({ role, buildings: myBuildings }), [role, myBuildings]);

  const renderRowActions = useCallback(
    (r: StaffRow) => {
      const blocked = newObservationsDisabled
        ? 'New observations are turned off'
        : observeBlockReason(observerScope, r);
      return (
        <div className="flex items-center justify-end gap-2">
          {/* A disabled button fires no hover events, so the reason lives
              on a wrapper. */}
          <span title={blocked ?? undefined}>
            <Button
              size="sm"
              disabled={blocked !== null}
              aria-label={blocked ? `Start observation (${blocked})` : undefined}
              onClick={(e) => {
                e.stopPropagation();
                setObserving(r);
              }}
            >
              Start observation
            </Button>
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link
              to={`/staff/${encodeURIComponent(r.email.toLowerCase())}`}
              onClick={(e) => e.stopPropagation()}
            >
              View observations
            </Link>
          </Button>
          {editMode && !isLocked(r) ? (
            <RowActions row={r} onEdit={() => setEditing(r)} onPatch={patchStaff} />
          ) : null}
        </div>
      );
    },
    [newObservationsDisabled, observerScope, editMode, patchStaff],
  );

  const scopeLabel = myBuildings.join(', ');

  return (
    <PageHeader
      title="My Staff"
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
        editMode ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCreate(true)}
              disabled={myBuildings.length === 0}
            >
              <Plus />
              Add staff
            </Button>
            <Button onClick={() => setEditMode(false)}>
              <Check />
              Done
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => setEditMode(true)}
            disabled={myBuildings.length === 0}
          >
            <Pencil />
            Edit roster
          </Button>
        )
      }
    >
      {missingBuildings ? (
        <div className="bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md px-4 py-3 text-sm">
          Your building assignment isn&apos;t configured. Contact your site admin.
        </div>
      ) : null}

      {editMode ? (
        <div
          role="status"
          className="mb-4 rounded-md border-l-4 border-amber-500 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          Editing roster: changes save as you make them. Select Done when you&apos;re finished.
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

      <div
        role="tablist"
        aria-label="Filter by status"
        className="mb-4 flex w-fit overflow-hidden rounded-lg border border-gray-200 bg-white"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-ops-blue font-semibold text-white'
                : 'text-ops-gray hover:bg-ops-blue-lighter hover:text-ops-blue-dark'
            }`}
          >
            {tab.label} ({String(tab.count)})
          </button>
        ))}
      </div>

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
        label="My staff"
        rowLabel={staffRowLabel}
        empty={
          hiddenByStatus > 0
            ? `Nothing to show here — ${String(hiddenByStatus)} ${hiddenWord} ${hiddenByStatus === 1 ? 'match is' : 'matches are'} hidden by the Status filter.`
            : deferredFilters.search
              ? 'No staff match that search.'
              : activeTab === 'all'
                ? 'No staff in your building yet.'
                : 'No staff with this status.'
        }
        onRowClick={handleRowClick}
        sort={sort}
        onSortChange={setSort}
        editing={editMode}
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
        confirmChange={(next) =>
          editing ? evaluationListWarning(editing, next, myBuildings) : null
        }
      />

      <Dialog
        open={pendingPatch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPatch(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove from your evaluation list?</DialogTitle>
            <DialogDescription>{pendingPatch?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPatch(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingPatch) writePatch(pendingPatch.email, pendingPatch.patch);
                setPendingPatch(null);
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {observing ? (
        <CreateObservationDialog
          open
          onOpenChange={(open) => {
            if (!open) setObserving(null);
          }}
          staff={observing}
          onCreated={(id) => void navigate(`/observations/${id}`)}
        />
      ) : null}
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
