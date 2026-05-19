import { useEffect, useRef, useState } from 'react';
import { MATERIAL_ICONS, type MaterialIcon } from '@ops/shared';
import { DashboardIcon } from '@/dashboard/DashboardIcon';
import { cn } from '@/lib/utils';

/**
 * Visual icon picker — a popover with a grid of icon buttons. Replaces
 * the bare `<select>` of icon tokens with something a non-technical user
 * can recognize at a glance.
 *
 * The trigger button shows the currently-selected icon plus a chevron.
 * Click to open a popover anchored below the trigger; click an icon to
 * select; click outside to close.
 */

export function IconPicker({
  value,
  onChange,
}: {
  value: MaterialIcon;
  onChange: (icon: MaterialIcon) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Pick an icon"
        className={cn(
          'border-input bg-background hover:bg-accent inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm',
          'transition-colors',
        )}
      >
        <span className="text-ops-blue">
          <DashboardIcon name={value} size={18} />
        </span>
        <span className="text-muted-foreground text-xs capitalize">{value}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className="border-border bg-popover absolute z-30 mt-1 w-64 rounded-md border p-2 shadow-lg">
          <div className="grid grid-cols-4 gap-1">
            {MATERIAL_ICONS.map((icn) => {
              const active = icn === value;
              return (
                <button
                  key={icn}
                  type="button"
                  aria-label={icn}
                  onClick={() => {
                    onChange(icn);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex h-12 flex-col items-center justify-center gap-0.5 rounded-md text-xs transition-colors',
                    active ? 'bg-ops-blue text-white' : 'hover:bg-accent text-foreground',
                  )}
                >
                  <DashboardIcon name={icn} size={18} />
                  <span className="text-[10px] capitalize">{icn}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
