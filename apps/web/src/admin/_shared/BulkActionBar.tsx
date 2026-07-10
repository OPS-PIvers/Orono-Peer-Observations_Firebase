import { X } from 'lucide-react';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BulkAction {
  key: string;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  disabled?: boolean;
}

interface BulkActionBarProps {
  count: number;
  /** Singular noun for the selected items, e.g. "module", "building". */
  noun: string;
  actions: BulkAction[];
  onClear: () => void;
  busy?: boolean;
}

/**
 * Generic select-mode action bar for admin list pages — same
 * fixed-on-mobile / inline-on-desktop treatment as staff/BulkEditBar, but
 * driven by a plain `actions` list so ModulesPage, BuildingsPage, RolesPage,
 * etc. can each supply the handful of bulk actions that make sense for
 * that entity (bulk activate/deactivate at minimum) without forking the
 * bar itself.
 */
export function BulkActionBar({ count, noun, actions, onClear, busy = false }: BulkActionBarProps) {
  const isDesktop = useIsDesktop();
  if (count === 0) return null;
  const countLabel = `${String(count)} ${count === 1 ? noun : `${noun}s`} selected`;

  return isDesktop ? (
    <div className="bg-ops-blue-dark mb-4 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-white shadow-md">
      <span className="font-medium">{countLabel}</span>
      <span className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
      {actions.map(({ key, label, icon: Icon, onClick, disabled }) => (
        <Button
          key={key}
          variant="ghost"
          size="sm"
          onClick={onClick}
          disabled={busy || disabled}
          className="h-9 text-white hover:bg-white/15 hover:text-white"
        >
          <Icon className="h-4 w-4" />
          {label}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={busy}
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
        'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
      )}
      role="toolbar"
      aria-label={`Bulk actions for ${countLabel}`}
    >
      <span className="text-sm font-medium">{count} selected</span>
      <div className="ml-auto flex items-center gap-1">
        {actions.map(({ key, label, icon: Icon, onClick, disabled }) => (
          <Button
            key={key}
            size="sm"
            variant="ghost"
            onClick={onClick}
            disabled={busy || disabled}
            className="h-9 text-white hover:bg-white/15 hover:text-white"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          disabled={busy}
          className="h-9 text-white hover:bg-white/15 hover:text-white"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
