import { useCallback, useMemo, useState } from 'react';
import {
  CalendarClock,
  Check,
  ListChecks,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
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
import { useFirestoreCollectionOnce } from '@/hooks/useFirestoreCollectionOnce';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db, functions } from '@/lib/firebase';
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
import { StaffFilterBar, EMPTY_FILTERS, type StaffFilters } from './StaffFilterBar';
import { BulkEditBar } from './BulkEditBar';
import { BulkEditDialog, type BulkEditField } from './BulkEditDialog';
import { AdvanceYearDialog } from './AdvanceYearDialog';
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

// ── Callables ─────────────────────────────────────────────────────────────

const resendStaffInviteFn = httpsCallable<{ email: string }, { sent: boolean }>(
  functions,
  'resendStaffInvite',
);

// Equality-only filters (no orderBy on the wire) so these small admin
// collections don't need composite indexes; sorted client-side below.
const ACTIVE_ROLES_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_BUILDINGS_CONSTRAINTS = [where('isActive', '==', true)];
const ACTIVE_MODULES_CONSTRAINTS = [where('isActive', '==', true)];

const byDisplayName = <T extends { displayName: string }>(a: T, b: T) =>
  a.displayName.localeCompare(b.displayName);

export function StaffPage() {
  // One-shot read (no live listener): the full staff collection is large and
  // a live onSnapshot re-renders this admin table on every staff write.
  // Inline edits merge their patch into the cached rows via `mutate` so the
  // table reflects them immediately; dialog saves and bulk edits call
  // `refresh()`. The Refresh control covers everything else (e.g. another
  // admin's concurrent edits).
  const {
    data: staff,
    loading,
    error,
    fetching,
    refresh,
    mutate,
  } = useFirestoreCollectionOnce<Staff>(COLLECTIONS.staff);
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
  const [showAdvanceYear, setShowAdvanceYear] = useState(false);

  const patchStaff = useCallback<PatchStaff>(
    (email, patch) => {
      void setDoc(
        doc(db, COLLECTIONS.staff, email),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
      // The list is a one-shot read, so fold the patch into the cached row —
      // pills and archive/restore render the new value without a refetch.
      mutate((rows) => rows.map((r) => (r.email === email ? { ...r, ...patch } : r)));
    },
    [mutate],
  );

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

  return (
    <PageHeader
      title="Staff"
      variant="light"
      breadcrumb={['Admin', 'Staff']}
      subtitle={
        staff ? `${String(sortedRows.length)} of ${String(staff.length)} staff` : 'Loading…'
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={refresh}
            disabled={fetching}
            aria-label="Refresh staff list"
          >
            <RefreshCw className={fetching ? 'animate-spin' : undefined} />
            Refresh
          </Button>
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
          <Button onClick={() => setShowCreate(true)}>
            <Plus />
            Add staff
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More staff actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setShowAdvanceYear(true)}>
                <CalendarClock />
                Advance school year
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

      <StaffDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        mode="create"
        existing={null}
        onSaved={refresh}
      />
      <StaffDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        mode="edit"
        existing={editing}
        onSaved={refresh}
      />

      <BulkEditDialog
        open={bulkField !== null}
        onOpenChange={(open) => {
          if (!open) setBulkField(null);
        }}
        field={bulkField}
        selectedRows={selectedRows}
        onApplied={() => {
          setSelected(new Set());
          refresh();
        }}
      />

      <AdvanceYearDialog
        open={showAdvanceYear}
        onOpenChange={setShowAdvanceYear}
        staff={staff ?? []}
        onMutate={mutate}
        onApplied={() => {
          toast.success('School year advanced');
        }}
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
  const [resending, setResending] = useState(false);

  async function handleResendInvite() {
    setResending(true);
    try {
      const result = await resendStaffInviteFn({ email: row.email });
      if (result.data.sent) {
        toast.success('Invite email sent', {
          description: `An invite was sent to ${row.email}.`,
        });
      } else {
        toast.warning('No active invite template', {
          description:
            'No active "staff.created" email template is configured. Enable one in Email Templates first.',
        });
      }
    } catch (err) {
      toast.error('Failed to send invite', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 min-h-9 w-9 min-w-9"
          aria-label={`Actions for ${row.name}`}
          disabled={resending}
        >
          {resending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MoreVertical className="h-4 w-4" />
          )}
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
          <DropdownMenuItem onSelect={() => void handleResendInvite()} disabled={resending}>
            Resend invite email
          </DropdownMenuItem>
        ) : null}
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
