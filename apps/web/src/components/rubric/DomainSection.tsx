import type { ReactNode } from 'react';
import { PROFICIENCY_LEVELS, type RubricDomain } from '@ops/shared';
import { cn } from '@/lib/utils';
import { PROFICIENCY_LABELS, RUBRIC_GRID_COLS } from './RubricGrid';

export interface DomainSectionProps {
  domain: RubricDomain;
  children: ReactNode;
}

/**
 * One domain's worth of rubric rows. The dark-blue domain title strip
 * and the red proficiency-header row are both `position: sticky` so
 * they pin to the top of the scroll container while the user scrolls
 * through that domain's components, then yield to the next domain's
 * sticky pair when its section reaches the top.
 *
 * Sticky offsets reference the `--page-chrome-h` CSS variable that
 * `PageHeader` writes onto `<html>` — the title strip + tabs sit above
 * these stickies, so domain headers must offset by that amount.
 *
 * The previous version had an `overflow-x-auto` wrapper around the
 * column-header row + data rows together, which broke vertical sticky
 * (the implicit `overflow-y: auto` made that wrapper a sticky-clipping
 * containing block). We now let the grid wrap responsively instead —
 * `RubricGrid.RUBRIC_GRID_COLS` defines minmax columns and the section
 * has no horizontal scroll container, so sticky works cleanly. The
 * outer `overflow-hidden` is dropped for the same reason.
 */
export function DomainSection({ domain, children }: DomainSectionProps) {
  const headingId = `domain-title-${domain.id}`;

  return (
    <section
      id={`domain-${domain.id}`}
      aria-labelledby={headingId}
      className="scroll-mt-[calc(var(--page-chrome-h,0px)+8px)]"
    >
      {/* Domain title bar — sticks at the top of the scroll container,
          just below PageHeader's chrome. z-[5] keeps it above row content
          but below PageHeader's z-20 so it tucks under the title strip
          when scrolling between domains. */}
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

      {/* Column-header row + data rows share one rowgroup so the
          sticky column-header has the whole domain as its containing
          block. Wrapping the header in its own (header-height) rowgroup
          collapses the sticky anchor and breaks pinning. */}
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
                'bg-ops-red',
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
