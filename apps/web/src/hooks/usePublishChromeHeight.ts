import { useEffect, type RefObject } from 'react';

/**
 * Publish a sticky chrome element's height to `document.documentElement`
 * as the `--page-chrome-h` CSS variable, so downstream sticky elements
 * (e.g. the rubric domain headers in `DomainSection.tsx`) can offset
 * themselves below it.
 *
 * Tracks size via `ResizeObserver`; clears the variable on unmount so
 * routes without a chrome don't leave a stale offset behind.
 */
export function usePublishChromeHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      document.documentElement.style.setProperty('--page-chrome-h', `${String(el.offsetHeight)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--page-chrome-h');
    };
  }, [ref]);
}
