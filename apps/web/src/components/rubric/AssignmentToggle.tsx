import { cn } from '@/lib/utils';

export type AssignmentMode = 'assigned' | 'full';

export interface AssignmentToggleProps {
  value: AssignmentMode;
  onChange: (next: AssignmentMode) => void;
  disabled?: boolean;
  className?: string;
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
}: AssignmentToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Rubric scope"
      aria-disabled={disabled || undefined}
      className={cn(
        'border-border bg-muted inline-flex rounded-md border p-0.5 text-sm',
        disabled && 'opacity-60',
        className,
      )}
    >
      <Segment
        active={value === 'assigned'}
        disabled={disabled}
        onClick={() => onChange('assigned')}
        label="Assigned only"
      />
      <Segment
        active={value === 'full'}
        disabled={disabled}
        onClick={() => onChange('full')}
        label="Full Rubric"
      />
    </div>
  );
}

function Segment({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
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
        disabled && 'cursor-not-allowed',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
