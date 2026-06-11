import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LayoutGrid, List, Search, Users, X } from 'lucide-react';
import {
  COLLECTIONS,
  type Building,
  type CycleStatus,
  type Role,
  type Staff,
  cycleStatus,
} from '@ops/shared';
import { PageHeader } from '@/components/PageHeader';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { cn } from '@/lib/utils';
import { roleDisplayName } from '@/utils/roleLookup';
import { yearBadgeClass, yearLabel } from '@/utils/staffFormatting';
import { buildStaffDirectoryConstraints } from './staffDirectoryQuery';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

const VIEW_MODE_KEY = 'staffDir:viewMode';
type ViewMode = 'list' | 'cards';

export function StaffDirectoryPage() {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedBuildings, setSelectedBuildings] = useState<Set<string>>(new Set());
  const [cycleStatusFilter, setCycleStatusFilter] = useState<CycleStatus | 'all'>('all');

  // Filter inactive staff out server-side by default (sorted by name
  // client-side below) instead of fetching every record and hiding them.
  const staffConstraints = useMemo(
    () => buildStaffDirectoryConstraints(showInactive),
    [showInactive],
  );
  const {
    data: staff,
    loading,
    error,
  } = useFirestoreCollection<Staff>(COLLECTIONS.staff, staffConstraints, [showInactive]);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: buildings } = useFirestoreCollection<Building>(COLLECTIONS.buildings);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'list';
    const raw = window.sessionStorage.getItem(VIEW_MODE_KEY);
    return raw === 'cards' ? 'cards' : 'list';
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      // sessionStorage may be unavailable; harmless.
    }
  }, [viewMode]);

  // Filter is keyed on the staff role slug (or legacy free-text value).
  // Build the dropdown from the union of (a) loaded roles and (b) any
  // legacy values present on staff records, so unmapped values stay
  // selectable rather than vanishing from the UI.
  const distinctRoles = useMemo(() => {
    const map = new Map<string, string>();
    roles?.forEach((r) => map.set(r.roleId, r.displayName));
    staff?.forEach((s) => {
      if (!map.has(s.role)) map.set(s.role, s.role);
    });
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [staff, roles]);

  const filtered = useMemo(() => {
    if (!staff) return [];
    const q = search.trim().toLowerCase();
    // `staff.filter` returns a fresh array, so sorting it in place is safe and
    // doesn't mutate the cached snapshot. Name sort happens here now that the
    // query no longer issues a server-side orderBy.
    return staff
      .filter((s) => {
        if (!showInactive && !s.isActive) return false;
        if (roleFilter && s.role !== roleFilter) return false;
        if (q && !s.name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q))
          return false;
        // Building filter: if any buildings are selected, staff must have at least one overlap.
        if (selectedBuildings.size > 0) {
          const hasMatchingBuilding = s.buildings.some((b) => selectedBuildings.has(b));
          if (!hasMatchingBuilding) return false;
        }
        // Cycle status filter: map staff year/summativeYear to cycle status and check match.
        if (cycleStatusFilter !== 'all') {
          const staffCycleStatus = cycleStatus(s.year, s.summativeYear);
          if (staffCycleStatus !== cycleStatusFilter) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, search, roleFilter, showInactive, selectedBuildings, cycleStatusFilter]);

  function clearFilters() {
    setSearch('');
    setRoleFilter('');
    setShowInactive(false);
    setSelectedBuildings(new Set());
    setCycleStatusFilter('all');
  }

  return (
    <PageHeader
      title="Staff Directory"
      subtitle="Click a staff member to view or start observations"
      actions={
        <div className="relative w-full max-w-xs sm:w-72">
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-white/60"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="h-10 w-full rounded-md border border-white/30 bg-white/10 pr-3 pl-9 text-sm text-white placeholder:text-white/60 focus:border-white/60 focus:bg-white/15 focus:outline-none"
          />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
        >
          <option value="">All roles</option>
          {distinctRoles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-10 min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                selectedBuildings.size > 0
                  ? 'border-ops-blue bg-ops-blue hover:bg-ops-blue-dark text-white'
                  : 'border-input bg-background hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span>Building</span>
              {selectedBuildings.size > 0 ? (
                <>
                  <span className="max-w-[140px] truncate text-xs opacity-90">
                    {Array.from(selectedBuildings).slice(0, 2).join(', ')}
                    {selectedBuildings.size > 2 ? '…' : ''}
                  </span>
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1 text-[11px] font-semibold">
                    {selectedBuildings.size}
                  </span>
                </>
              ) : null}
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuLabel>Filter by building</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(buildings ?? []).map((b) => (
              <DropdownMenuCheckboxItem
                key={b.buildingId}
                checked={selectedBuildings.has(b.displayName)}
                onCheckedChange={() => {
                  const next = new Set(selectedBuildings);
                  if (next.has(b.displayName)) {
                    next.delete(b.displayName);
                  } else {
                    next.add(b.displayName);
                  }
                  setSelectedBuildings(next);
                }}
                onSelect={(e) => e.preventDefault()}
              >
                {b.displayName}
              </DropdownMenuCheckboxItem>
            ))}
            {(buildings?.length ?? 0) === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-sm">
                No buildings configured.
              </div>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex h-10 min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                cycleStatusFilter !== 'all'
                  ? 'border-ops-blue bg-ops-blue hover:bg-ops-blue-dark text-white'
                  : 'border-input bg-background hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span>Cycle</span>
              {cycleStatusFilter !== 'all' ? (
                <>
                  <span className="text-xs opacity-90">
                    {cycleStatusFilter === 'high'
                      ? 'High Cycle'
                      : cycleStatusFilter === 'probationary'
                        ? 'Probationary'
                        : 'Low Cycle'}
                  </span>
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/20 px-1 text-[11px] font-semibold">
                    1
                  </span>
                </>
              ) : null}
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Filter by cycle status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={cycleStatusFilter === 'all'}
              onCheckedChange={() => setCycleStatusFilter('all')}
              onSelect={(e) => e.preventDefault()}
            >
              All
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={cycleStatusFilter === 'low'}
              onCheckedChange={() => setCycleStatusFilter('low')}
              onSelect={(e) => e.preventDefault()}
            >
              Low Cycle
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={cycleStatusFilter === 'high'}
              onCheckedChange={() => setCycleStatusFilter('high')}
              onSelect={(e) => e.preventDefault()}
            >
              High Cycle
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={cycleStatusFilter === 'probationary'}
              onCheckedChange={() => setCycleStatusFilter('probationary')}
              onSelect={(e) => e.preventDefault()}
            >
              Probationary
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <label className="text-ops-gray flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4"
          />
          Show inactive
        </label>

        {search ||
        roleFilter ||
        showInactive ||
        selectedBuildings.size > 0 ||
        cycleStatusFilter !== 'all' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-muted-foreground h-9 min-h-9 gap-1"
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        ) : null}

        <div
          className="border-input ml-auto inline-flex h-10 overflow-hidden rounded-md border"
          role="group"
          aria-label="View mode"
        >
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-pressed={viewMode === 'list'}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 text-sm transition-colors',
              viewMode === 'list'
                ? 'bg-ops-blue-dark text-white'
                : 'text-ops-gray hover:bg-gray-50',
            )}
          >
            <List className="h-4 w-4" /> List
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            aria-pressed={viewMode === 'cards'}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 text-sm transition-colors',
              viewMode === 'cards'
                ? 'bg-ops-blue-dark text-white'
                : 'text-ops-gray hover:bg-gray-50',
            )}
          >
            <LayoutGrid className="h-4 w-4" /> Cards
          </button>
        </div>
      </div>

      {error ? (
        <div className="bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md px-4 py-3 text-sm">
          Failed to load staff: {error.message}
        </div>
      ) : null}

      {loading && !staff ? (
        viewMode === 'cards' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse bg-gray-50" />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Users className="text-ops-gray-lighter h-10 w-10" />
          <p className="text-ops-gray font-medium">No staff match your search</p>
          {search ||
          roleFilter ||
          showInactive ||
          selectedBuildings.size > 0 ||
          cycleStatusFilter !== 'all' ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-ops-blue text-sm underline hover:no-underline"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) => (
            <Link
              key={s.id}
              to={`/staff/${encodeURIComponent(s.email.toLowerCase())}`}
              className="hover:border-ops-blue focus:ring-ops-blue block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-all hover:shadow-md focus:ring-2 focus:ring-offset-2 focus:outline-none active:scale-[0.99]"
            >
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="font-heading text-ops-blue-dark text-sm leading-tight font-semibold">
                  {s.name}
                </p>
                <span
                  className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${yearBadgeClass(s.year)}`}
                >
                  {yearLabel(s.year)}
                </span>
              </div>
              <p className="text-ops-gray mb-2 text-xs">{roleDisplayName(roles, s.role)}</p>
              {s.summativeYear ? (
                <span className="bg-ops-blue-lighter text-ops-blue-dark mb-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold">
                  High Cycle
                </span>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {s.buildings.map((b) => (
                  <span
                    key={b}
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200 bg-white">
          {filtered.map((s) => (
            <li key={s.id}>
              <Link
                to={`/staff/${encodeURIComponent(s.email.toLowerCase())}`}
                className="hover:bg-ops-blue-lighter/30 focus:ring-ops-blue block px-4 py-2.5 transition-colors focus:ring-2 focus:-outline-offset-2 focus:outline-none"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-heading text-ops-blue-dark truncate text-sm font-semibold">
                    {s.name}
                  </p>
                  <p className="text-ops-gray shrink-0 text-xs">{roleDisplayName(roles, s.role)}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${yearBadgeClass(s.year)}`}
                  >
                    {yearLabel(s.year)}
                  </span>
                  {s.summativeYear ? (
                    <span className="bg-ops-blue-lighter text-ops-blue-dark inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold">
                      High Cycle
                    </span>
                  ) : null}
                  {s.buildings.map((b) => (
                    <span
                      key={b}
                      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageHeader>
  );
}
