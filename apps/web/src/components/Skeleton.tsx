import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Generic placeholder block. Compose multiple to mimic the page's actual
 * layout while data is loading — so the cold-cache "Loading…" state shows
 * a structural shimmer instead of a centered text blob.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('bg-ops-gray-lighter animate-pulse rounded-md', className)}
      {...props}
    />
  );
}
