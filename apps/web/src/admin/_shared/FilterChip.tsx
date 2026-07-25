import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  count: number;
  activeSummary: string | null;
}

/**
 * Pill-shaped dropdown trigger shared by every admin filter bar chip
 * (role, year, building, status, ...). Lifted out of StaffFilterBar so
 * other admin pages' filter chips (e.g. RolesPage/BuildingsPage's status
 * filter) render identically without re-deriving the markup.
 */
export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(function FilterChip(
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
