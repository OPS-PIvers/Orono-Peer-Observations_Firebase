import type { ReactNode } from 'react';
import { PROFICIENCY_LEVELS, type RubricDomain } from '@ops/shared';
import { cn } from '@/lib/utils';
import { PROFICIENCY_LABELS, RUBRIC_GRID_COLS } from './RubricGrid';

export interface DomainSectionProps {
  domain: RubricDomain;
  children: ReactNode;
}

/**
 * One domain's worth of rubric rows, desktop layout. The dark-blue
 * domain title strip and the red proficiency-header row are both
 * `position: sticky` so they pin to the top of the scroll container
 * while the user scrolls through that domain's components, then yield
 * to the next domain's sticky pair when its section reaches the top.
 *
 * Sticky offsets reference the `--page-chrome-h` CSS variable that
 * EditorToolbar publishes onto `<html>` — the title strip + tabs sit
 * above these stickies, so domain headers must offset by that amount.
 *
 * Mobile uses `MobileDomainCard` instead (in RubricGrid.tsx); this
 * component is no longer rendered there.
 */
export function DomainSection({ domain, children }: DomainSectionProps) {
  const headingId = `domain-title-${domain.id}`;

  return (
    <section
      id={`domain-${domain.id}`}
      aria-labelledby={headingId}
      className="scroll-mt-[calc(var(--page-chrome-h,0px)+8px)]"
    >
      <div className={cn('sticky top-[var(--page-chrome-h,0px)] z-[5]', 'bg-ops-blue-dark')}>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-white"
          >
            {domain.id}
          </span>
          <h2 id={headingId} className="font-heading text-base font-semibold text-white">
            Domain {domain.id}: {domain.name}
          </h2>
        </div>
      </div>

      <div role="rowgroup" className="bg-white">
        <div
          role="row"
          className={cn(
            'sticky top-[calc(var(--page-chrome-h,0px)+48px)] z-[4]',
            'grid',
            RUBRIC_GRID_COLS,
          )}
        >
          <div
            role="columnheader"
            className={cn(
              'bg-ops-blue-dark',
              'font-heading px-3 py-2',
              'text-[11px] font-semibold tracking-widest text-white uppercase',
            )}
          >
            Component
          </div>
          {PROFICIENCY_LEVELS.map((level) => (
            <div
              key={level}
              role="columnheader"
              className={cn(
                'bg-ops-red-light',
                'border-r border-white/20 px-3 py-2 last:border-r-0',
                'font-heading text-[11px] font-semibold tracking-widest text-white uppercase',
              )}
            >
              {PROFICIENCY_LABELS[level]}
            </div>
          ))}
        </div>

        <div className="divide-y divide-gray-100">{children}</div>
      </div>
    </section>
  );
}
