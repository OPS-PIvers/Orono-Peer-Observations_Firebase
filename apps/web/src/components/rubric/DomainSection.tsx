import type { ReactNode } from 'react';
import type { RubricDomain } from '@ops/shared';
import { PROFICIENCY_LABELS } from './RubricGrid';

export interface DomainSectionProps {
  domain: RubricDomain;
  children: ReactNode;
}

/**
 * One domain's worth of rubric rows. Includes a sticky descriptor-column
 * header so users can scroll down a long domain and still know which
 * column is which. The outer wrapper carries `id="domain-{domainId}"` so
 * the sibling `<DomainNav>` scroll-spy can target it.
 */
export function DomainSection({ domain, children }: DomainSectionProps) {
  return (
    <section
      id={`domain-${domain.id}`}
      aria-labelledby={`domain-title-${domain.id}`}
      className="border-border bg-background overflow-hidden rounded-lg border"
    >
      <header className="border-border bg-ops-blue-lighter border-b px-4 py-3">
        <h2
          id={`domain-title-${domain.id}`}
          className="font-heading text-ops-blue-dark text-base font-semibold"
        >
          Domain {domain.id}: {domain.name}
        </h2>
      </header>

      {/* Horizontal scroll for narrow viewports — sticky first column inside
          preserves context as the descriptor cells slide horizontally. */}
      <div className="overflow-x-auto">
        <div className="min-w-[920px]">
          <div
            className="bg-muted text-muted-foreground sticky top-0 z-10 grid grid-cols-[220px_repeat(4,minmax(0,1fr))] border-b text-xs font-semibold tracking-wide uppercase"
            role="row"
          >
            <div className="bg-muted px-3 py-2" role="columnheader">
              Component
            </div>
            {(['developing', 'basic', 'proficient', 'distinguished'] as const).map((level) => (
              <div key={level} className="border-border border-l px-3 py-2" role="columnheader">
                {PROFICIENCY_LABELS[level]}
              </div>
            ))}
          </div>
          <div role="rowgroup">{children}</div>
        </div>
      </div>
    </section>
  );
}
