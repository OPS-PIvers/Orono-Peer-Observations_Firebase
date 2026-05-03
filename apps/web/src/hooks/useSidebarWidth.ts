import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ops:sidebar:expanded';
// Fired in the same tab by AppSidebar.togglePc so same-tab consumers can sync.
// (The native `storage` event only fires in OTHER tabs.)
export const SIDEBAR_TOGGLE_EVENT = 'ops:sidebar:toggle';

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
    function onToggle(e: Event) {
      setExpanded((e as CustomEvent<{ expanded: boolean }>).detail.expanded);
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle);
    };
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
