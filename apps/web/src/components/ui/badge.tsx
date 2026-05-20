import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone = 'neutral' | 'active' | 'inactive' | 'info' | 'warning';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  active: 'bg-green-50 text-green-700',
  inactive: 'bg-muted text-muted-foreground',
  info: 'bg-ops-blue-lighter text-ops-blue-dark',
  warning: 'bg-ops-red-lighter text-ops-red-dark',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small status pill used for Active/Inactive/System and similar chips. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
