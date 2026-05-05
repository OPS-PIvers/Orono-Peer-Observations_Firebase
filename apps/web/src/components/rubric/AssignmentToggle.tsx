import { cn } from '@/lib/utils';

export type AssignmentMode = 'assigned' | 'full';

export interface AssignmentToggleProps {
  value: AssignmentMode;
  onChange: (next: AssignmentMode) => void;
  disabled?: boolean;
  className?: string;
  /**
   * `'light'` (default) renders a filled segmented control on a light
   * background. `'dark'` is an outline-only variant for use on a
   * dark/blue page header — no fill, white text.
   */
  variant?: 'light' | 'dark';
  /**
   * When true, the toggle stretches to fill its container with two
   * equal-width segments. Defaults to false (inline auto-width).
   */
  /**
   * When true, the toggle stretches to fill its container with two
   * equal-width segments below `md`, then collapses back to inline
   * auto-width at `md+`. Defaults to false (always inline auto-width).
   */
  fullWidth?: boolean;
}

/**
 * Segmented control toggle between "Assigned only" and "Full Rubric" used
 * in the teacher view. Persisting the choice across reloads is the
 * caller's responsibility (typically `sessionStorage`).
 */
export function AssignmentToggle({
  value,
  onChange,
  disabled = false,
  className,
  variant = 'light',
  fullWidth = false,
}: AssignmentToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Rubric scope"
      aria-disabled={disabled || undefined}
      className={cn(
        fullWidth ? 'flex w-full md:inline-flex md:w-auto' : 'inline-flex',
        'rounded-md border p-0.5 text-sm',
        variant === 'dark' ? 'border-white/30' : 'border-border bg-muted',
        disabled && 'opacity-60',
        className,
      )}
    >
      <Segment
        active={value === 'assigned'}
        disabled={disabled}
        onClick={() => onChange('assigned')}
        label="Assigned only"
        variant={variant}
        fullWidth={fullWidth}
      />
      <Segment
        active={value === 'full'}
        disabled={disabled}
        onClick={() => onChange('full')}
        label="Full Rubric"
        variant={variant}
        fullWidth={fullWidth}
      />
    </div>
  );
}

function Segment({
  active,
  disabled,
  onClick,
  label,
  variant,
  fullWidth,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  variant: 'light' | 'dark';
  fullWidth: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 font-medium transition-colors',
        fullWidth && 'flex-1 md:flex-none',
        disabled && 'cursor-not-allowed',
        variant === 'dark'
          ? active
            ? 'bg-white/15 text-white'
            : 'text-white/70 hover:text-white'
          : active
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
