import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Rubric } from '@ops/shared';
import { cn } from '@/lib/utils';

function findScrollParent(el: HTMLElement | null): HTMLElement | Window {
  // Walk up looking for the nearest ancestor that actually scrolls
  // vertically. Just checking `overflow-y: auto` is misleading because
  // `overflow-x: auto` also promotes overflow-y to `auto` per spec — and
  // the DomainNav's own horizontally-scrolling wrapper would be picked
  // up first, breaking the at-bottom check.
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

export interface DomainNavProps {
  rubric: Rubric;
  className?: string;
  /**
   * If true, also dispatches a brief CSS pulse on the targeted domain
   * section after a click — used by the script editor to "flash" the
   * jumped-to component row when a tagged span is clicked.
   */
  pulseOnClick?: boolean;
  /**
   * 'dark' renders pills for use on a dark (ops-blue-dark) background.
   * Defaults to 'light' for use on white/background-colored bars.
   * Ignored when `display === 'tabs'`.
   */
  variant?: 'light' | 'dark';
  /**
   * Horizontal alignment of the pill row inside the nav. Defaults to
   * 'left'; use 'center' when sitting under a centered title strip.
   * Ignored when `display === 'tabs'`.
   */
  align?: 'left' | 'center';
  /**
   * 'pills' (default) renders rounded pill buttons in a row. 'tabs'
   * renders an edge-to-edge brand-red strip with equal-width tabs —
   * used as the sticky sub-bar under the page title on /my-rubric.
   */
  display?: 'pills' | 'tabs';
}

/**
 * Sticky pill nav with one chip per rubric domain. Clicking a chip
 * smoothly scrolls to the corresponding `<DomainSection>` (which renders
 * `id="domain-{domainId}"` for this exact purpose). Active state tracks
 * the currently-visible domain via a single IntersectionObserver — no
 * scroll listeners.
 *
 * The `rootMargin` shrinks the viewport to a horizontal band ~30% from
 * the top; whichever domain has its header inside that band wins. This
 * matches the behavior teachers/PEs intuit from the original GAS app.
 */
export function DomainNav({
  rubric,
  className,
  pulseOnClick = false,
  variant = 'light',
  align = 'left',
  display = 'pills',
}: DomainNavProps) {
  const domainIds = useMemo(() => rubric.domains.map((d) => d.id), [rubric]);
  const [activeId, setActiveId] = useState<string | null>(domainIds[0] ?? null);
  const navRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sections: HTMLElement[] = [];
    for (const id of domainIds) {
      const el = document.getElementById(`domain-${id}`);
      if (el instanceof HTMLElement) sections.push(el);
    }
    if (sections.length === 0) return;

    const firstId = domainIds[0] ?? null;
    const scroller = findScrollParent(navRef.current);

    let raf = 0;
    const compute = () => {
      raf = 0;
      // The active pill is the domain section that occupies the most
      // pixels of the visible content area (below page chrome, above
      // viewport bottom). This handles both the scroll-through case
      // (you're "in" whichever domain fills the screen) and the
      // scrolled-to-end case (the last domain naturally wins because
      // it occupies the bottom of the viewport). Top-crossing alone
      // either skipped D3 on short pages or never reached D4 on long
      // ones; max-visible-area covers both.
      const chromeH =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--page-chrome-h'),
        ) || 0;

      const scrollerEl = scroller instanceof HTMLElement ? scroller : null;
      const scrollerRect = scrollerEl?.getBoundingClientRect();
      const viewportTop = (scrollerRect?.top ?? 0) + chromeH;
      const viewportBottom = scrollerRect?.bottom ?? window.innerHeight;

      let bestVisible = -1;
      let active: string | null = firstId;
      for (const section of sections) {
        const rect = section.getBoundingClientRect();
        const top = Math.max(rect.top, viewportTop);
        const bottom = Math.min(rect.bottom, viewportBottom);
        const visible = Math.max(0, bottom - top);
        // Strict `>` so on ties (e.g. nothing visible yet) the FIRST
        // section in the loop wins, matching firstId default.
        if (visible > bestVisible) {
          bestVisible = visible;
          active = section.id.replace(/^domain-/, '');
        }
      }

      // When the user has actually scrolled to the page bottom AND
      // the last section is visible, prefer it. This covers small
      // assigned-only lists where the last domain occupies less area
      // than its predecessor — without this, max-area alone leaves
      // the previous domain highlighted even though the user is
      // looking at the end of the rubric.
      const atBottom = scrollerEl
        ? scrollerEl.scrollTop + scrollerEl.clientHeight >= scrollerEl.scrollHeight - 2
        : window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        const last = sections[sections.length - 1];
        if (last) {
          const lastRect = last.getBoundingClientRect();
          const lastVisible = Math.max(
            0,
            Math.min(lastRect.bottom, viewportBottom) - Math.max(lastRect.top, viewportTop),
          );
          if (lastVisible > 0) {
            active = last.id.replace(/^domain-/, '');
          }
        }
      }
      setActiveId(active);
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(compute);
    };

    compute();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [domainIds]);

  const handleJump = useCallback(
    (id: string) => {
      const target = document.getElementById(`domain-${id}`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
      if (pulseOnClick) pulseElement(target);
    },
    [pulseOnClick],
  );

  if (display === 'tabs') {
    return (
      <nav
        ref={navRef}
        aria-label="Rubric domains"
        className={cn('bg-ops-red flex w-full', className)}
      >
        {rubric.domains.map((d) => {
          const active = activeId === d.id;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => handleJump(d.id)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'relative flex-1 px-3 py-2.5 text-sm font-medium transition-colors',
                'border-r border-white/15 last:border-r-0',
                'border-b-2',
                active
                  ? 'bg-ops-red-dark border-b-white text-white'
                  : 'hover:bg-ops-red-dark/70 border-b-transparent text-white/85 hover:text-white',
              )}
            >
              <span className="opacity-80">D{d.id}</span>
              <span className="ml-1 hidden sm:inline">{d.name}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      ref={navRef}
      aria-label="Rubric domains"
      className={cn('flex flex-nowrap gap-1', align === 'center' && 'justify-center', className)}
    >
      {rubric.domains.map((d) => {
        const active = activeId === d.id;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => handleJump(d.id)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-ops-blue text-white'
                : variant === 'dark'
                  ? 'text-white/70 hover:bg-white/10 hover:text-white'
                  : 'text-ops-gray hover:bg-ops-blue-lighter hover:text-ops-blue-dark',
            )}
          >
            <span className="opacity-80">D{d.id}</span>
            <span className="ml-1 hidden sm:inline">{d.name}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Briefly attach `data-pulse=""` to an element for ~600ms — a sibling
 * CSS rule animates a soft outline ring during that window. Used when
 * jumping to a component row from a tagged script span.
 */
export function pulseElement(el: HTMLElement) {
  el.setAttribute('data-pulse', '');
  window.setTimeout(() => {
    el.removeAttribute('data-pulse');
  }, 600);
}
