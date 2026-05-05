import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const HEIGHT_KEY = 'ops:script-drawer:height';
// Body height (px) on first visit. Zero = collapsed by default; a returning
// user gets whatever they last left it at, restored from sessionStorage.
const DEFAULT_BODY_HEIGHT = 0;
// Drag bar at the top of the drawer. Always visible, always interactive —
// the only way to expand or resize the drawer.
const HANDLE_HEIGHT = 24;
// Once the body crosses this size we surface a centered chevron-down at the
// drawer's bottom edge so the user can collapse without dragging all the way
// back. Below the threshold the chevron would overlap the handle area, so
// we keep it hidden.
const COLLAPSE_BTN_THRESHOLD = 80;
// Cap drawer at 75% viewport so the rubric above stays usable.
const MAX_HEIGHT_RATIO = 0.75;

function readSession(key: string, fallback: string): string {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export interface ScriptDrawerProps {
  children: ReactNode;
  /** px — 56 (rail) or 240 (expanded), passed from Layout context. 0 on mobile. */
  sidebarWidth: number;
}

/**
 * Fixed-bottom resizable drawer for the script editor. There is no
 * expand/collapse button — the user drags the handle bar to open it,
 * resize it, or close it (drag down to zero). When the body is tall
 * enough, a floating chevron-down at the bottom-center offers a quick
 * one-click collapse back to zero.
 */
export function ScriptDrawer({ children, sidebarWidth }: ScriptDrawerProps) {
  const [bodyHeight, setBodyHeight] = useState<number>(() => {
    const raw = parseInt(readSession(HEIGHT_KEY, String(DEFAULT_BODY_HEIGHT)), 10);
    return Number.isFinite(raw) ? Math.max(0, raw) : DEFAULT_BODY_HEIGHT;
  });

  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = bodyHeight;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [bodyHeight],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO - HANDLE_HEIGHT;
      const next = Math.min(maxH, Math.max(0, dragStartHeight.current + delta));
      setBodyHeight(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setBodyHeight((h) => {
        writeSession(HEIGHT_KEY, String(h));
        return h;
      });
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  const collapse = useCallback(() => {
    setBodyHeight(0);
    writeSession(HEIGHT_KEY, '0');
  }, []);

  const drawerHeight = bodyHeight + HANDLE_HEIGHT;
  const showCollapseBtn = bodyHeight >= COLLAPSE_BTN_THRESHOLD;

  return (
    <>
      {/* Spacer so rubric content isn't hidden behind the fixed drawer. */}
      <div style={{ height: drawerHeight }} aria-hidden="true" />

      <div
        className="fixed bottom-0 z-30 flex flex-col shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
        style={{
          left: sidebarWidth,
          right: 0,
          height: drawerHeight,
        }}
        data-drawer-height={drawerHeight}
      >
        {/* Drag handle — full-width strip with the "Script" label and a
            centered pill grip. Acts as the resize affordance and the only
            way to open the drawer. */}
        <div
          aria-hidden="true"
          className={cn(
            'group relative flex shrink-0 cursor-ns-resize items-center border-t border-b',
            'border-ops-gray-lighter bg-ops-gray-lightest px-3 select-none',
          )}
          style={{ height: HANDLE_HEIGHT }}
          onPointerDown={onPointerDown}
        >
          <span className="text-ops-gray-dark text-[11px] font-semibold tracking-wide uppercase">
            Script
          </span>
          <div
            className={cn(
              'pointer-events-none absolute top-1/2 left-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all',
              'bg-ops-gray-light group-hover:bg-ops-blue group-hover:w-20',
            )}
          />
        </div>

        {/* Body. Renders as long as bodyHeight > 0 so the script editor
            scales smoothly as the user drags. flex-1 lets the script
            editor inside fill whatever space the handle leaves. */}
        {bodyHeight > 0 ? (
          <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            {children}
          </div>
        ) : null}

        {showCollapseBtn ? (
          <button
            type="button"
            onClick={collapse}
            aria-label="Collapse script drawer"
            className="border-ops-gray-lighter text-ops-gray-dark hover:text-ops-blue absolute bottom-1.5 left-1/2 z-10 inline-flex h-6 w-14 -translate-x-1/2 items-center justify-center rounded-full border bg-white/85 shadow-sm backdrop-blur hover:bg-white"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </>
  );
}
