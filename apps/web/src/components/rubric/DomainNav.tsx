import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Rubric } from '@ops/shared';
import { cn } from '@/lib/utils';

export interface DomainNavProps {
  rubric: Rubric;
  className?: string;
  /**
   * If true, also dispatches a brief CSS pulse on the targeted domain
   * section after a click — used by the script editor to "flash" the
   * jumped-to component row when a tagged span is clicked.
   */
  pulseOnClick?: boolean;
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
export function DomainNav({ rubric, className, pulseOnClick = false }: DomainNavProps) {
  const domainIds = useMemo(() => rubric.domains.map((d) => d.id), [rubric]);
  const [activeId, setActiveId] = useState<string | null>(domainIds[0] ?? null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const observed: HTMLElement[] = [];
    for (const id of domainIds) {
      const el = document.getElementById(`domain-${id}`);
      if (el instanceof HTMLElement) observed.push(el);
    }
    if (observed.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top of the active band.
        const [first] = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (first) {
          const id = (first.target as HTMLElement).id.replace(/^domain-/, '');
          setActiveId(id);
        }
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    for (const el of observed) observer.observe(el);
    return () => {
      observer.disconnect();
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

  return (
    <nav aria-label="Rubric domains" className={cn('flex flex-wrap gap-1', className)}>
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
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
