import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import { orderBy } from 'firebase/firestore';
import { COLLECTIONS, type Role, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { roleDisplayName } from '@/utils/roleLookup';
import { yearBadgeClass, yearLabel } from '@/utils/staffFormatting';

const STAFF_CONSTRAINTS = [orderBy('name', 'asc')];

export function StaffDirectoryPage() {
  const {
    data: staff,
    loading,
    error,
  } = useFirestoreCollection<Staff>(COLLECTIONS.staff, STAFF_CONSTRAINTS);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);

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
    return staff.filter((s) => {
      if (!showInactive && !s.isActive) return false;
      if (roleFilter && s.role !== roleFilter) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [staff, search, roleFilter, showInactive]);

  function clearFilters() {
    setSearch('');
    setRoleFilter('');
    setShowInactive(false);
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-ops-blue-dark text-3xl font-semibold">
            Staff Directory
          </h1>
          <p className="text-ops-gray mt-1 text-sm">
            Click a staff member to view or start observations
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search
            aria-hidden="true"
            className="text-ops-gray-lighter absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="border-input bg-background h-10 w-full rounded-md border pr-3 pl-9 text-sm"
          />
        </div>
      </header>

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
        <label className="text-ops-gray flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4"
          />
          Show inactive
        </label>
      </div>

      {error ? (
        <div className="bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md px-4 py-3 text-sm">
          Failed to load staff: {error.message}
        </div>
      ) : null}

      {loading && !staff ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Users className="text-ops-gray-lighter h-10 w-10" />
          <p className="text-ops-gray font-medium">No staff match your search</p>
          {search || roleFilter || showInactive ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-ops-blue text-sm underline hover:no-underline"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
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
      )}
    </div>
  );
}
