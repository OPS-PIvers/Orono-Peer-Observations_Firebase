import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPEN_KEY = 'ops:script-drawer:open';
const HEIGHT_KEY = 'ops:script-drawer:height';
const DEFAULT_HEIGHT = 400;
const MIN_HEIGHT = 200;
// Visible drag-handle strip above the title row. Acts as the resize border
// (Google-Slides-speaker-notes style) and stays interactive when the drawer
// is open.
const RESIZE_HANDLE_HEIGHT = 8;
const TITLE_HEIGHT = 36;
const HEADER_HEIGHT = RESIZE_HANDLE_HEIGHT + TITLE_HEIGHT;

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
 * Fixed-bottom resizable drawer that renders the script editor.
 * The rubric above it must add padding-bottom equal to the drawer's open height
 * so content isn't hidden. That padding is communicated via a CSS custom
 * property set on the drawer element and mirrored via the `paddingBottom` prop
 * to the parent through a data attribute read by the scroll container.
 */
export function ScriptDrawer({ children, sidebarWidth }: ScriptDrawerProps) {
  const [open, setOpen] = useState<boolean>(() => readSession(OPEN_KEY, 'false') === 'true');
  const [height, setHeight] = useState<number>(() => {
    const raw = parseInt(readSession(HEIGHT_KEY, String(DEFAULT_HEIGHT)), 10);
    return Number.isFinite(raw) ? Math.max(MIN_HEIGHT, raw) : DEFAULT_HEIGHT;
  });

  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      writeSession(OPEN_KEY, String(!prev));
      return !prev;
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!open) return;
      dragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [open, height],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current) return;
      const delta = dragStartY.current - e.clientY;
      const maxH = window.innerHeight * 0.75;
      const next = Math.min(maxH, Math.max(MIN_HEIGHT, dragStartHeight.current + delta));
      setHeight(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      setHeight((h) => {
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

  const drawerHeight = open ? height + HEADER_HEIGHT : HEADER_HEIGHT;

  return (
    <>
      {/* Spacer so rubric content isn't hidden behind fixed drawer */}
      <div style={{ height: drawerHeight }} aria-hidden="true" />

      {/* Fixed drawer */}
      <div
        className="fixed bottom-0 z-30 flex flex-col shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
        style={{
          left: sidebarWidth,
          right: 0,
          height: drawerHeight,
        }}
        data-drawer-height={drawerHeight}
      >
        {/* Resize border — slim grey strip above the title row, drag-only.
            Mirrors Google Slides' speaker-notes resize affordance: a thin
            top edge with a centered pill grip that's always visible.
            Pointer-only resize affordance (no keyboard equivalent), so it
            stays purely decorative for assistive tech. The Expand/Collapse
            button below provides the keyboard path for show/hide. */}
        <div
          aria-hidden="true"
          className={cn(
            'group flex shrink-0 items-center justify-center border-t border-b',
            'border-ops-gray-lighter bg-ops-gray-lightest',
            open ? 'cursor-ns-resize' : 'cursor-default',
          )}
          style={{ height: RESIZE_HANDLE_HEIGHT }}
          onPointerDown={onPointerDown}
        >
          <div
            className={cn(
              'h-1 rounded-full transition-all',
              open
                ? 'bg-ops-gray-light group-hover:bg-ops-blue w-12 group-hover:w-20'
                : 'bg-ops-gray-lighter w-10',
            )}
          />
        </div>

        {/* Title row */}
        <div
          className="bg-ops-blue-dark flex shrink-0 items-center px-4"
          style={{ height: TITLE_HEIGHT }}
        >
          <span className="font-heading text-sm font-semibold tracking-wide text-white">
            Script
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-label={open ? 'Collapse script drawer' : 'Expand script drawer'}
            className="ml-auto inline-flex items-center gap-1 rounded p-1 text-xs font-medium text-white/90 hover:bg-white/10 hover:text-white"
          >
            {open ? (
              <>
                Collapse
                <ChevronDown className="h-4 w-4" />
              </>
            ) : (
              <>
                Expand
                <ChevronUp className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        {/* Body */}
        {open && (
          <div className="bg-background flex-1 overflow-y-auto p-4" style={{ height: height }}>
            {children}
          </div>
        )}
      </div>
    </>
  );
}
