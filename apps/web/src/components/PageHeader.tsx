import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /**
   * Optional second strip rendered below the title row. Sticks to the top
   * of the scroll container as the page scrolls. Renders edge-to-edge —
   * the child component supplies its own background.
   */
  belowBar?: ReactNode;
  /**
   * Page body. Rendered as siblings of the header strips so it inherits
   * Layout's `max-w-7xl` body wrapper (the wrapper does not extend to the
   * dark strip — the strip uses viewport-width margin bleed to escape).
   */
  children?: ReactNode;
}

/**
 * Page chrome: a full-bleed dark-blue title strip and an optional sticky
 * sub-bar (e.g. domain tabs), followed by the page body.
 *
 * Bleed strategy: Layout wraps all page content in `mx-auto max-w-7xl
 * px-4 md:px-6 py-6`. The dark strip uses negative margins computed as
 * `calc(50% - 50vw)` on the x-axis, plus `-mt-6` to absorb the wrapper's
 * top padding. The result is an element whose painted box spans the full
 * `<main>` width while its inner content stays aligned with the body
 * column.
 */
export function PageHeader({ title, subtitle, actions, belowBar, children }: PageHeaderProps) {
  return (
    <>
      <div
        className={cn(
          'bg-ops-blue-dark mx-[calc(50%-50vw)] -mt-6 w-screen text-white',
          !belowBar && 'mb-6',
        )}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-6">
          <div className="min-w-0">
            <h1 className="font-heading text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-white/70">{subtitle}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </div>
      {belowBar ? (
        <div className="sticky top-0 z-10 mx-[calc(50%-50vw)] mb-6 w-screen">{belowBar}</div>
      ) : null}
      {children}
    </>
  );
}
