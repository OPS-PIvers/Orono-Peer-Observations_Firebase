import {
  Building2,
  CalendarDays,
  CheckCheck,
  CircleSlash,
  MoreHorizontal,
  Power,
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
  onClear: () => void;
}

const ALL_ACTIONS: { field: BulkEditField; label: string; icon: React.ElementType }[] = [
  { field: 'year', label: 'Set year', icon: CalendarDays },
  { field: 'role', label: 'Set role', icon: Star },
  { field: 'addBuilding', label: 'Add building', icon: Building2 },
  { field: 'removeBuilding', label: 'Remove building', icon: CircleSlash },
  { field: 'isActive', label: 'Set active status', icon: Power },
  { field: 'summativeYear', label: 'Set summative year', icon: CheckCheck },
];

export function BulkEditBar({ count, onAction, onClear }: BulkEditBarProps) {
  const isDesktop = useIsDesktop();
  if (count === 0) return null;
  return isDesktop ? (
    <div className="bg-ops-blue-dark mb-4 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-white shadow-md">
      <span className="font-medium">
        {count} {count === 1 ? 'staff' : 'staff'} selected
      </span>
      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
      <ActionButton onClick={() => onAction('year')} icon={CalendarDays} label="Set year" />
      <ActionButton onClick={() => onAction('role')} icon={Star} label="Set role" />
      <ActionButton onClick={() => onAction('addBuilding')} icon={Building2} label="Add building" />
      <ActionButton
        onClick={() => onAction('removeBuilding')}
        icon={CircleSlash}
        label="Remove building"
      />
      <ActionButton onClick={() => onAction('isActive')} icon={Power} label="Active" />
      <ActionButton onClick={() => onAction('summativeYear')} icon={CheckCheck} label="Summative" />
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
      aria-label={`Bulk actions for ${String(count)} selected staff`}
    >
      <span className="text-sm font-medium">{count} selected</span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAction('year')}
          className="h-9 text-white hover:bg-white/15 hover:text-white"
        >
          <CalendarDays className="h-4 w-4" />
          Year
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onAction('role')}
          className="h-9 text-white hover:bg-white/15 hover:text-white"
        >
          <Star className="h-4 w-4" />
          Role
        </Button>
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
            {ALL_ACTIONS.slice(2).map(({ field, label, icon: Icon }) => (
              <DropdownMenuItem key={field} onSelect={() => onAction(field)}>
                <Icon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
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

function ActionButton({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-9 text-white hover:bg-white/15 hover:text-white"
    >
      <Icon className="h-4 w-4" />
      {label}
    </Button>
  );
}
