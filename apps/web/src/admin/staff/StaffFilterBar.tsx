import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { OBSERVATION_YEARS, type Building, type Role, type StaffYear } from '@ops/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { yearLabel } from '@/utils/staffFormatting';
import { FilterChip } from '@/admin/_shared/FilterChip';
import { StatusFilterChip } from '@/admin/_shared/StatusFilterChip';
import { DEFAULT_STATUS_FILTER, type StatusFilter } from '@/admin/_shared/statusFilter';

export type { StatusFilter };

export interface StaffFilters {
  search: string;
  roles: ReadonlySet<string>;
  years: ReadonlySet<StaffYear>;
  buildings: ReadonlySet<string>;
  status: StatusFilter;
}

export const EMPTY_FILTERS: StaffFilters = {
  search: '',
  roles: new Set<string>(),
  years: new Set<StaffYear>(),
  buildings: new Set<string>(),
  status: DEFAULT_STATUS_FILTER,
};

interface StaffFilterBarProps {
  filters: StaffFilters;
  onChange: (next: StaffFilters) => void;
  roles: Role[] | null;
  buildings: Building[] | null;
}

export function StaffFilterBar({ filters, onChange, roles, buildings }: StaffFilterBarProps) {
  const update = <K extends keyof StaffFilters>(key: K, value: StaffFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const toggleSet = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const activeChipCount =
    filters.roles.size +
    filters.years.size +
    filters.buildings.size +
    (filters.status !== DEFAULT_STATUS_FILTER ? 1 : 0);

  const roleLabelByRoleId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles ?? []) map.set(r.roleId, r.displayName);
    return map;
  }, [roles]);

  return (
    // Single wrapping row: search first, filter chips inline beside it. The
    // search input keeps a comfortable width and the chips flow after it,
    // wrapping to the next line only when the viewport runs out of room.
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-md sm:w-80">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
          placeholder="Search by name, email, role, or building"
          className="pl-9"
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip
            label="Role"
            count={filters.roles.size}
            activeSummary={
              filters.roles.size > 0
                ? Array.from(filters.roles)
                    .map((r) => roleLabelByRoleId.get(r) ?? r)
                    .slice(0, 2)
                    .join(', ') + (filters.roles.size > 2 ? '…' : '')
                : null
            }
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuLabel>Filter by role</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(roles ?? []).map((r) => (
            <DropdownMenuCheckboxItem
              key={r.roleId}
              checked={filters.roles.has(r.roleId)}
              onCheckedChange={() => update('roles', toggleSet(filters.roles, r.roleId))}
              onSelect={(e) => e.preventDefault()}
            >
              {r.displayName}
            </DropdownMenuCheckboxItem>
          ))}
          {(roles?.length ?? 0) === 0 ? (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">No roles configured.</div>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip
            label="Year"
            count={filters.years.size}
            activeSummary={
              filters.years.size > 0
                ? Array.from(filters.years)
                    .sort((a, b) => a - b)
                    .map((y) => yearLabel(y))
                    .join(', ')
                : null
            }
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Filter by year</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {OBSERVATION_YEARS.map((y) => (
            <DropdownMenuCheckboxItem
              key={y}
              checked={filters.years.has(y)}
              onCheckedChange={() => update('years', toggleSet(filters.years, y))}
              onSelect={(e) => e.preventDefault()}
            >
              {y < 4 ? `Year ${String(y)} (${yearLabel(y)})` : `Probationary ${String(y - 3)}`}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <FilterChip
            label="Building"
            count={filters.buildings.size}
            activeSummary={
              filters.buildings.size > 0
                ? Array.from(filters.buildings).slice(0, 2).join(', ') +
                  (filters.buildings.size > 2 ? '…' : '')
                : null
            }
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          <DropdownMenuLabel>Filter by building</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {(buildings ?? []).map((b) => (
            <DropdownMenuCheckboxItem
              key={b.buildingId}
              checked={filters.buildings.has(b.displayName)}
              onCheckedChange={() =>
                update('buildings', toggleSet(filters.buildings, b.displayName))
              }
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

      <StatusFilterChip value={filters.status} onChange={(s) => update('status', s)} />

      {activeChipCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="text-muted-foreground h-9 min-h-9 gap-1"
        >
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
