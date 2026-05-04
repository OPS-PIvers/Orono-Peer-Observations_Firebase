import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /**
   * Optional second strip rendered below the title row, sharing the same
   * dark-blue background. Sticks to the top of the scroll container as the
   * page scrolls — useful for in-page navigation like a domain pill bar.
   */
  belowBar?: ReactNode;
}

/**
 * Full-bleed dark-blue page header that visually merges with the sidebar.
 *
 * Returns a fragment of two siblings (title strip + optional belowBar) so
 * that the sticky belowBar's containing block is the page wrapper, not the
 * header itself — that keeps it stuck through the whole page scroll.
 *
 * Pages that use it should NOT wrap themselves in a parent that adds
 * `space-y-*`; render `<PageHeader …>` followed by a body wrapper that
 * owns its own spacing.
 */
export function PageHeader({ title, subtitle, actions, belowBar }: PageHeaderProps) {
  return (
    <>
      <div
        className={cn(
          'bg-ops-blue-dark -mx-4 -mt-6 px-4 py-5 text-white md:-mx-6 md:px-6',
          'flex flex-wrap items-center justify-between gap-4',
          !belowBar && 'mb-6',
        )}
      >
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-white/70">{subtitle}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {belowBar ? (
        <div className="bg-ops-blue-dark sticky top-0 z-10 -mx-4 mb-6 border-t border-white/10 px-4 py-2 md:-mx-6 md:px-6">
          {belowBar}
        </div>
      ) : null}
    </>
  );
}
