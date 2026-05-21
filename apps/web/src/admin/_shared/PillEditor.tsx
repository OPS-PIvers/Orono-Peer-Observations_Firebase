import type { ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface PillOption {
  value: string;
  label: string;
}

const PILL_TRIGGER =
  'inline-flex max-w-full items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-accent focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden';

/** A single-select pill: shows the selected label, opens a checkmarked menu. */
export function SinglePillEditor({
  value,
  options,
  onChange,
  ariaLabel,
  menuLabel,
  pill,
}: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  menuLabel?: string;
  /** Custom pill content; defaults to the selected option's label. */
  pill?: ReactNode;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={PILL_TRIGGER}
        >
          <span className="truncate">{pill ?? selected?.label ?? value}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {menuLabel ? <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel> : null}
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)}>
            <Check
              className={cn('mr-2 h-4 w-4', o.value === value ? 'opacity-100' : 'opacity-0')}
            />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A multi-select pill row: renders `pills`, opens a checkbox menu that stays open. */
export function MultiPillEditor({
  selectedValues,
  options,
  onToggle,
  ariaLabel,
  menuLabel,
  pills,
  emptyLabel = 'None',
}: {
  selectedValues: ReadonlySet<string>;
  options: PillOption[];
  onToggle: (value: string) => void;
  ariaLabel: string;
  menuLabel?: string;
  /** Pill content (chips); when empty, `emptyLabel` shows instead. */
  pills?: ReactNode;
  emptyLabel?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={cn(PILL_TRIGGER, 'flex-wrap')}
        >
          <span className="flex flex-wrap items-center gap-1">
            {selectedValues.size > 0 ? (
              pills
            ) : (
              <span className="text-muted-foreground">{emptyLabel}</span>
            )}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {menuLabel ? <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel> : null}
        {options.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">Nothing to choose.</div>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selectedValues.has(o.value)}
              onCheckedChange={() => onToggle(o.value)}
              onSelect={(e) => e.preventDefault()}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
