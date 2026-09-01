import { useEffect, useRef } from 'react';
import {
  Building2,
  CalendarDays,
  CheckCheck,
  CircleSlash,
  Layers,
  Mail,
  MoreHorizontal,
  Power,
  ShieldCheck,
  Star,
  X,
} from 'lucide-react';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { BulkEditField } from './BulkEditDialog';

interface BulkEditBarProps {
  count: number;
  onAction: (field: BulkEditField) => void;
  onMessageGroup: () => void;
  onClear: () => void;
}

interface BulkAction {
  field: BulkEditField;
  label: string;
  /** Terse label for the mobile bar, which shares one row with the count and
   *  the overflow trigger at 375px. */
  short?: string;
  icon: React.ElementType;
}

const ALL_ACTIONS: BulkAction[] = [
  { field: 'year', label: 'Set year', short: 'Year', icon: CalendarDays },
  { field: 'role', label: 'Set role', short: 'Role', icon: Star },
  { field: 'addBuilding', label: 'Add building', icon: Building2 },
  { field: 'removeBuilding', label: 'Remove building', icon: CircleSlash },
  { field: 'addModule', label: 'Add module', icon: Layers },
  { field: 'removeModule', label: 'Remove module', icon: CircleSlash },
  { field: 'hasAdminAccess', label: 'Set admin access', icon: ShieldCheck },
  { field: 'isActive', label: 'Set active status', icon: Power },
  { field: 'summativeYear', label: 'Set summative year', icon: CheckCheck },
];

/**
 * The two fields worth a permanent button on both branches: together they say
 * where a person sits in the evaluation cycle, which is what an admin is
 * correcting after filtering the roster. Everything else is a building/module
 * fix or a guarded write, and lives behind "More".
 *
 * Holding the inline set to two (plus Message group and Clear) is also what
 * keeps the desktop bar on one row at 1280px and up. The bar sticks under the
 * page chrome, so a second row eats the scrollport at exactly the moment a
 * large selection is staged for a write.
 */
const INLINE_FIELDS: BulkEditField[] = ['year', 'role'];

/**
 * Fields BulkEditDialog gates behind a confirm step (see describeBulkEditRisk):
 * archiving, admin access, and the summative flag. They sit at the end of the
 * overflow, past a separator, so a write that can take down the roster is never
 * an identical-looking button away from a routine correction.
 */
const GUARDED_FIELDS: BulkEditField[] = ['hasAdminAccess', 'isActive', 'summativeYear'];

// Overflow is the complement of the inline set rather than its own list, so a
// field added to ALL_ACTIONS cannot end up unreachable from either branch.
const INLINE_ACTIONS = ALL_ACTIONS.filter((a) => INLINE_FIELDS.includes(a.field));
const OVERFLOW_ACTIONS = ALL_ACTIONS.filter(
  (a) => !INLINE_FIELDS.includes(a.field) && !GUARDED_FIELDS.includes(a.field),
);
const GUARDED_ACTIONS = ALL_ACTIONS.filter((a) => GUARDED_FIELDS.includes(a.field));

export function BulkEditBar({ count, onAction, onMessageGroup, onClear }: BulkEditBarProps) {
  const isDesktop = useIsDesktop();
  const barRef = useRef<HTMLDivElement>(null);
  const active = isDesktop && count > 0;

  // While the desktop bar is shown it sticks below the page chrome, so the
  // table header (AdminDataView) must stick below the bar in turn. Publish
  // the bar's height as `--bulk-bar-h` (same pattern as `--page-chrome-h`),
  // keyed on `active` because this component renders null — not unmounts —
  // when the selection clears, and a stale height would leave a gap. The
  // observer still earns its keep below xl, where the bar may still wrap.
  useEffect(() => {
    if (!active) return;
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      document.documentElement.style.setProperty('--bulk-bar-h', `${String(el.offsetHeight)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--bulk-bar-h');
    };
  }, [active]);

  if (count === 0) return null;
  const countLabel = `${String(count)} staff member${count === 1 ? '' : 's'} selected`;
  const toolbarLabel = `Bulk actions for ${String(count)} selected staff`;

  return isDesktop ? (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={toolbarLabel}
      className="bg-ops-blue-dark sticky top-[var(--page-chrome-h,0px)] z-20 mb-4 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-white shadow-md xl:flex-nowrap"
    >
      <span className="font-medium">{countLabel}</span>
      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
      {/* Message group is the one action in the row that writes nothing, so it
          is filled rather than ghosted to break up the run of equal weights. */}
      <ActionButton onClick={onMessageGroup} icon={Mail} label="Message group" emphasis />
      {INLINE_ACTIONS.map(({ field, label, icon }) => (
        <ActionButton key={field} onClick={() => onAction(field)} icon={icon} label={label} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-white hover:bg-white/15 hover:text-white"
            aria-label="More bulk actions"
          >
            <MoreHorizontal className="h-4 w-4" />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <ActionMenuItems actions={OVERFLOW_ACTIONS} onAction={onAction} />
          <DropdownMenuSeparator />
          <ActionMenuItems actions={GUARDED_ACTIONS} onAction={onAction} />
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="ml-auto text-white hover:bg-white/15 hover:text-white"
      >
        <X className="h-4 w-4" />
        Clear
      </Button>
    </div>
  ) : (
    <div
      className={cn(
        'bg-ops-blue-dark fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 px-3 py-2 text-white shadow-[0_-2px_10px_rgba(0,0,0,0.18)]',
        // Pad for iOS home indicator.
        'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
      )}
      role="toolbar"
      aria-label={toolbarLabel}
    >
      <span className="text-sm font-medium">{count} selected</span>
      <div className="ml-auto flex items-center gap-1">
        {INLINE_ACTIONS.map(({ field, label, short, icon: Icon }) => (
          <Button
            key={field}
            size="sm"
            variant="ghost"
            onClick={() => onAction(field)}
            className="h-9 text-white hover:bg-white/15 hover:text-white"
          >
            <Icon className="h-4 w-4" />
            {short ?? label}
          </Button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-white hover:bg-white/15 hover:text-white"
              aria-label="More bulk actions"
            >
              <MoreHorizontal className="h-4 w-4" />
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end">
            <DropdownMenuItem onSelect={onMessageGroup}>
              <Mail className="h-4 w-4" />
              Message group
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <ActionMenuItems actions={OVERFLOW_ACTIONS} onAction={onAction} />
            <DropdownMenuSeparator />
            <ActionMenuItems actions={GUARDED_ACTIONS} onAction={onAction} />
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>
              <X className="h-4 w-4" />
              Clear selection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ActionMenuItems({
  actions,
  onAction,
}: {
  actions: BulkAction[];
  onAction: (field: BulkEditField) => void;
}) {
  return (
    <>
      {actions.map(({ field, label, icon: Icon }) => (
        <DropdownMenuItem key={field} onSelect={() => onAction(field)}>
          <Icon className="h-4 w-4" />
          {label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
  emphasis = false,
}: {
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  /** Filled instead of ghosted — reserved for the non-destructive action so
   *  the row is not a flat run of identical buttons. */
  emphasis?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn('h-9 text-white hover:bg-white/15 hover:text-white', emphasis && 'bg-white/15')}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
}
