import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ops:sidebar:expanded';

/**
 * Returns the pixel width occupied by the sidebar in the layout flow.
 * At xl+ breakpoints: 240 (expanded) or 56 (rail). Below xl the sidebar
 * is an overlay and doesn't push layout, so returns 0.
 */
export function useSidebarWidth(): number {
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  });

  const [isXl, setIsXl] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 1280px)').matches;
  });

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setExpanded(e.newValue !== 'false');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    function onChange(e: MediaQueryListEvent) {
      setIsXl(e.matches);
    }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  if (!isXl) return 0;
  return expanded ? 240 : 56;
}
