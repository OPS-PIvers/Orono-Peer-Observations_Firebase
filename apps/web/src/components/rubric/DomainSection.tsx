import type { ReactNode } from 'react';
import { PROFICIENCY_LEVELS, type RubricDomain } from '@ops/shared';
import { cn } from '@/lib/utils';
import { PROFICIENCY_LABELS, RUBRIC_GRID_COLS, RUBRIC_GRID_MIN_W } from './RubricGrid';

/* Tailwind safelist — dynamic domain accent classes used in DomainSection.tsx */
/* border-l-ops-blue border-l-ops-red border-l-ops-blue-light border-l-ops-red-light */

const DOMAIN_ACCENTS: Record<string, string> = {
  '1': 'border-l-ops-blue',
  '2': 'border-l-ops-red',
  '3': 'border-l-ops-blue-light',
  '4': 'border-l-ops-red-light',
};

export interface DomainSectionProps {
  domain: RubricDomain;
  children: ReactNode;
}

/**
 * One domain's worth of rubric rows. Includes a sticky dark-blue domain
 * header and a blue column-header row. The outer wrapper carries
 * `id="domain-{domainId}"` so the sibling `<DomainNav>` scroll-spy can
 * target it.
 */
export function DomainSection({ domain, children }: DomainSectionProps) {
  const accentClass = DOMAIN_ACCENTS[domain.id] ?? 'border-l-ops-blue';
  const headingId = `domain-title-${domain.id}`;

  return (
    <section
      id={`domain-${domain.id}`}
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-gray-200 shadow-sm"
    >
      {/* Sticky domain title bar — OPS Blue Dark with left accent stripe.
          top-[52px] matches MobileTopBar height so the bar sticks just below it
          on mobile; xl:top-0 takes over once the top bar is hidden. */}
      <div
        className={cn(
          'sticky top-[52px] z-10 border-l-4 bg-ops-blue-dark xl:top-0',
          accentClass,
        )}
      >
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

      {/* Horizontal scroll container — column headers + rows share one
          scroll viewport so they stay aligned. */}
      <div className="overflow-x-auto" role="grid" aria-labelledby={headingId}>
        {/* Column header rowgroup */}
        <div role="rowgroup">
          <div
            role="row"
            className={cn('grid bg-ops-blue', RUBRIC_GRID_MIN_W, RUBRIC_GRID_COLS)}
          >
            <div
              role="columnheader"
              className="border-r border-white/20 px-3 py-2 font-heading text-[11px] font-semibold tracking-widest uppercase text-white/80"
            >
              Component
            </div>
            {PROFICIENCY_LEVELS.map((level) => (
              <div
                key={level}
                role="columnheader"
                className={cn(
                  'border-r border-white/20 px-3 py-2 last:border-r-0',
                  'font-heading text-[11px] font-semibold tracking-widest uppercase',
                  level === 'proficient' || level === 'distinguished'
                    ? 'text-white'
                    : 'text-white/80',
                )}
              >
                {PROFICIENCY_LABELS[level]}
              </div>
            ))}
          </div>
        </div>

        {/* Data rowgroup */}
        <div role="rowgroup" className={cn(RUBRIC_GRID_MIN_W, 'divide-y divide-gray-100 bg-white')}>
          {children}
        </div>
      </div>
    </section>
  );
}
