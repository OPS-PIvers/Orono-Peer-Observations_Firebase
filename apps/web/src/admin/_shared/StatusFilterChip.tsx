import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FilterChip } from './FilterChip';
import { type StatusFilter } from './statusFilter';

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
        {/* The chip always names the status it is showing, and reads as
            filtering whenever it hides rows — including at its 'active'
            default. A blank-looking chip that silently suppresses every
            archived person is the same bug as no chip at all. */}
        <FilterChip
          label="Status"
          count={0}
          active={value !== 'all'}
          activeSummary={STATUS_LABELS[value]}
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
