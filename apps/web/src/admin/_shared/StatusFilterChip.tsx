import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FilterChip } from './FilterChip';
import { DEFAULT_STATUS_FILTER, type StatusFilter } from './statusFilter';

const STATUS_OPTIONS = ['active', 'archived', 'all'] as const satisfies readonly StatusFilter[];

const STATUS_LABELS: Record<StatusFilter, string> = {
  active: 'Active',
  archived: 'Archived',
  all: 'All',
};

interface StatusFilterChipProps {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}

/**
 * Active / Archived / All status filter chip. Originally built for
 * StaffFilterBar; lifted here so RolesPage and BuildingsPage render and
 * default (`DEFAULT_STATUS_FILTER`) identically instead of inventing a
 * second filter idiom.
 */
export function StatusFilterChip({ value, onChange }: StatusFilterChipProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterChip
          label="Status"
          count={value !== DEFAULT_STATUS_FILTER ? 1 : 0}
          activeSummary={value === DEFAULT_STATUS_FILTER ? null : STATUS_LABELS[value]}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_OPTIONS.map((s) => (
          <DropdownMenuCheckboxItem
            key={s}
            checked={value === s}
            onCheckedChange={() => onChange(s)}
            onSelect={(e) => e.preventDefault()}
          >
            {STATUS_LABELS[s]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
