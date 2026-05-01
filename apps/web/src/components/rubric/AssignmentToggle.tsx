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
      className={cn(
        'border-border bg-muted inline-flex rounded-md border p-0.5 text-sm',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <Segment
        active={value === 'assigned'}
        onClick={() => onChange('assigned')}
        label="Assigned only"
      />
      <Segment active={value === 'full'} onClick={() => onChange('full')} label="Full Rubric" />
    </div>
  );
}

function Segment({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'rounded px-3 py-1.5 font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
