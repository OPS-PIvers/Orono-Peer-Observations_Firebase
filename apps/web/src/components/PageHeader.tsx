import { useRef, type ReactNode } from 'react';
import { usePublishChromeHeight } from '@/hooks/usePublishChromeHeight';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /**
   * Optional second strip rendered below the title row, inside the same
   * sticky wrapper so it stays anchored at the top alongside the title.
   * Renders edge-to-edge — the child component supplies its own background.
   */
  belowBar?: ReactNode;
  /** Optional wayfinding breadcrumb, e.g. ["Admin", "Staff"]. Rendered above
   *  the title in the light variant. */
  breadcrumb?: string[];
  /** `light` (new admin default) — white chrome, brand-blue title, hairline.
   *  `dark` — legacy dark-blue strip. `plain` — centered brand-blue title. */
  variant?: 'light' | 'dark' | 'plain';
  /**
   * Page body. Wrapped in `mx-auto max-w-7xl px-4 md:px-6 py-6` so its
   * content stays aligned with the inner content of the title strip.
   */
  children?: ReactNode;
}

/**
 * Page chrome: a full-width dark-blue title strip (always anchored at
 * the top of the scroll container) with an optional `belowBar` (e.g.
 * domain tabs) stacked beneath it inside the same sticky wrapper. The
 * page body follows below.
 *
 * Width: this component assumes `<main>` is the natural full-width
 * container — Layout no longer wraps children in a `max-w-7xl` div.
 * The dark strip therefore fills `<main>` exactly (between the fixed
 * sidebar and the viewport's right edge — no horizontal overflow).
 *
 * Sticky-offset for downstream content: while mounted, the height of
 * the sticky chrome is exposed on `document.documentElement` as the CSS
 * variable `--page-chrome-h`, so internal sticky elements (e.g. the
 * rubric domain headers) can offset themselves cleanly.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  belowBar,
  breadcrumb,
  // Default stays 'dark' so non-admin pages (observations, profile, scheduling)
  // are unchanged; admin pages opt into 'light' explicitly.
  variant = 'dark',
  children,
}: PageHeaderProps) {
  const chromeRef = useRef<HTMLDivElement>(null);
  usePublishChromeHeight(chromeRef);

  if (variant === 'light') {
    return (
      <>
        <div ref={chromeRef} className="bg-background sticky top-0 z-20 w-full border-b">
          <div
            className={cn(
              'mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 md:px-6',
              subtitle ? 'py-4' : 'py-3',
            )}
          >
            <div className="min-w-0">
              {breadcrumb && breadcrumb.length > 0 ? (
                <nav className="text-muted-foreground mb-1 text-xs" aria-label="Breadcrumb">
                  {breadcrumb.join(' › ')}
                </nav>
              ) : null}
              <h1 className="font-heading text-ops-blue-dark text-xl font-semibold sm:text-2xl">
                {title}
              </h1>
              {subtitle ? <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          {belowBar ? <div className="w-full">{belowBar}</div> : null}
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</div>
      </>
    );
  }

  if (variant === 'plain') {
    return (
      <>
        <div ref={chromeRef} className="bg-ops-gray-lightest sticky top-0 z-20 w-full">
          <div
            className={cn(
              'mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 md:px-6',
              subtitle ? 'py-4' : 'py-3',
            )}
          >
            <div aria-hidden="true" />
            <div className="min-w-0 text-center">
              <h1 className="font-heading text-ops-blue-dark text-xl font-semibold sm:text-2xl">
                {title}
              </h1>
              {subtitle ? <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p> : null}
            </div>
            <div className="flex justify-end">{actions ?? null}</div>
          </div>
          {belowBar ? <div className="w-full">{belowBar}</div> : null}
        </div>
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</div>
      </>
    );
  }

  return (
    <>
      <div ref={chromeRef} className="sticky top-0 z-20 w-full">
        <div className="bg-ops-blue-dark text-white">
          <div
            className={cn(
              'mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 md:px-6',
              subtitle ? 'py-4' : 'py-3',
            )}
          >
            <div className="min-w-0">
              <h1 className="font-heading text-xl font-semibold text-white sm:text-2xl">{title}</h1>
              {subtitle ? <p className="mt-1 text-sm text-white/70">{subtitle}</p> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </div>
        {belowBar ? <div className="w-full">{belowBar}</div> : null}
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">{children}</div>
    </>
  );
}
