import { forwardRef, useMemo, type ButtonHTMLAttributes } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';

export type StatusFilter = 'all' | 'active' | 'archived';

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
  status: 'active',
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
    (filters.status !== 'active' ? 1 : 0);

  const roleLabelByRoleId = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles ?? []) map.set(r.roleId, r.displayName);
    return map;
  }, [roles]);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="relative max-w-md">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
          placeholder="Search by name, email, role, or building"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterChip
              label="Status"
              count={filters.status !== 'active' ? 1 : 0}
              activeSummary={
                filters.status === 'all' ? 'All' : filters.status === 'archived' ? 'Archived' : null
              }
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(['active', 'archived', 'all'] as const).map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                checked={filters.status === s}
                onCheckedChange={() => update('status', s)}
                onSelect={(e) => e.preventDefault()}
              >
                {s === 'active' ? 'Active' : s === 'archived' ? 'Archived' : 'All'}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
    </div>
  );
}

interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  count: number;
  activeSummary: string | null;
}

const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
  { label, count, activeSummary, ...rest },
  ref,
) {
  const isActive = count > 0;
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        'inline-flex h-9 min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
        isActive
          ? 'border-ops-blue bg-ops-blue text-primary-foreground hover:bg-ops-blue-dark'
          : 'border-input bg-background hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <span>{label}</span>
      {activeSummary ? (
        <span className="max-w-[140px] truncate text-xs opacity-90">{activeSummary}</span>
      ) : null}
      {count > 0 ? (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold',
            'bg-white/20',
          )}
        >
          {count}
        </span>
      ) : null}
      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
    </button>
  );
});
