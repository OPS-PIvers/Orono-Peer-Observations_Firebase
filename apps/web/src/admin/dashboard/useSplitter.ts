import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Draggable editor/preview splitter for /admin/dashboard.
 *
 * Returns the editor's share of the row width as a fraction, plus pointer
 * handlers for the drag handle. The fraction is persisted per browser in
 * localStorage and clamped so neither pane can be dragged to uselessness.
 *
 * Kept local to the dashboard page on purpose: it is the only admin page
 * with a real editor + preview split (Branding uses a fixed aside, Email
 * Templates puts its preview below). Extract to `admin/_shared/` when a
 * second consumer shows up and the API is no longer a guess.
 */

export const SPLITTER_STORAGE_KEY = 'ops:admin-dashboard:editor-fraction';
export const SPLITTER_DEFAULT = 0.6;
export const SPLITTER_MIN = 0.35;
export const SPLITTER_MAX = 0.75;

export function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return SPLITTER_DEFAULT;
  return Math.min(SPLITTER_MAX, Math.max(SPLITTER_MIN, f));
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(SPLITTER_STORAGE_KEY);
    if (raw === null) return SPLITTER_DEFAULT;
    return clampFraction(Number.parseFloat(raw));
  } catch {
    return SPLITTER_DEFAULT;
  }
}

export interface SplitterHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  role: 'separator';
  'aria-orientation': 'vertical';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  tabIndex: 0;
}

export interface UseSplitterResult {
  /** Editor share of the row, in [SPLITTER_MIN, SPLITTER_MAX]. */
  fraction: number;
  dragging: boolean;
  /** Attach to the row that contains editor + handle + preview. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleProps: SplitterHandleProps;
  reset: () => void;
}

const KEY_STEP = 0.05;

export function useSplitter(): UseSplitterResult {
  const [fraction, setFraction] = useState<number>(readStored);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SPLITTER_STORAGE_KEY, String(fraction));
    } catch {
      // Private mode / quota — the split simply won't persist.
    }
  }, [fraction]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      if (rect.width <= 0) return;
      setFraction(clampFraction((ev.clientX - rect.left) / rect.width));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
    };
    // Suppress text selection + keep the resize cursor even when the pointer
    // leaves the handle mid-drag.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFraction((f) => clampFraction(f - KEY_STEP));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFraction((f) => clampFraction(f + KEY_STEP));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFraction(SPLITTER_MIN);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFraction(SPLITTER_MAX);
    }
  }, []);

  const reset = useCallback(() => setFraction(SPLITTER_DEFAULT), []);

  return {
    fraction,
    dragging,
    containerRef,
    reset,
    handleProps: {
      onPointerDown,
      onKeyDown,
      onDoubleClick: reset,
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': Math.round(fraction * 100),
      'aria-valuemin': Math.round(SPLITTER_MIN * 100),
      'aria-valuemax': Math.round(SPLITTER_MAX * 100),
      tabIndex: 0,
    },
  };
}
