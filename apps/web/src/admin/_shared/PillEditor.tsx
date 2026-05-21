import { type ReactNode, useId, useState } from 'react';
import { Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { PillColor } from './pillColors';

export interface PillOption {
  value: string;
  label: string;
  color?: PillColor;
  /** Forced-on by a rule (e.g. module auto-enable): rendered checked + disabled
   *  with an "Auto" tag; toggling is suppressed by the caller. */
  locked?: boolean;
}

/** A colored chip. Presentational only. */
export function PillChip({
  color,
  className,
  children,
}: {
  color?: PillColor | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        color ? `${color.bg} ${color.text}` : 'bg-accent text-accent-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

const TRIGGER =
  'focus-visible:ring-ring inline-flex max-w-full items-center gap-1 rounded-full text-left transition hover:opacity-80 focus-visible:ring-2 focus-visible:outline-hidden';

/**
 * Single-select: the trigger is the selected option's colored chip; the popover
 * lists the options as clickable chips.
 */
export function PillSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Set…',
  menuLabel,
}: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  menuLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={TRIGGER}
        >
          {selected ? (
            <PillChip color={selected.color}>{selected.label}</PillChip>
          ) : (
            <PillChip>{placeholder}</PillChip>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" onClick={(e) => e.stopPropagation()}>
        {menuLabel ? (
          <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
            {menuLabel}
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={cn(
                'hover:bg-accent flex items-center justify-between gap-3 rounded-md px-2 py-1.5',
                o.value === value && 'bg-accent',
              )}
            >
              <PillChip color={o.color}>{o.label}</PillChip>
              {o.value === value ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Multi-select: the trigger shows the selected options as colored chips; the
 * popover lists every option with a toggle switch.
 */
export function PillMultiSelect({
  options,
  selected,
  onToggle,
  ariaLabel,
  emptyLabel = 'None',
  menuLabel,
  stack = false,
}: {
  options: PillOption[];
  selected: ReadonlySet<string>;
  onToggle: (value: string) => void;
  ariaLabel: string;
  emptyLabel?: string;
  menuLabel?: string;
  /** Stack the chosen chips vertically instead of wrapping them inline. Keeps
   *  multi-select columns narrow when values rarely exceed a couple of chips. */
  stack?: boolean;
}) {
  const chosen = options.filter((o) => selected.has(o.value));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={(e) => e.stopPropagation()}
          className={cn(TRIGGER, stack ? 'flex-col items-start gap-0.5' : 'flex-wrap')}
        >
          {chosen.length > 0 ? (
            chosen.map((o) => (
              <PillChip key={o.value} color={o.color}>
                {o.label}
              </PillChip>
            ))
          ) : (
            <PillChip>{emptyLabel}</PillChip>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" onClick={(e) => e.stopPropagation()}>
        {menuLabel ? (
          <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
            {menuLabel}
          </div>
        ) : null}
        {options.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-xs">Nothing to choose.</div>
        ) : (
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {options.map((o) => (
              <ToggleRow
                key={o.value}
                option={o}
                checked={selected.has(o.value)}
                onToggle={() => onToggle(o.value)}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ToggleRow({
  option,
  checked,
  onToggle,
}: {
  option: PillOption;
  checked: boolean;
  onToggle: () => void;
}) {
  const id = useId();
  return (
    <div className="hover:bg-accent flex items-center justify-between gap-3 rounded-md px-2 py-1.5">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
        <PillChip color={option.color}>{option.label}</PillChip>
        {option.locked ? (
          <span className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
            Auto
          </span>
        ) : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onToggle} disabled={option.locked} />
    </div>
  );
}
