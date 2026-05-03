import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const OPEN_KEY = 'ops:script-drawer:open';
const HEIGHT_KEY = 'ops:script-drawer:height';
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 180;
const HEADER_HEIGHT = 40;

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
        className="fixed bottom-0 z-30 flex flex-col shadow-[0_-2px_12px_rgba(0,0,0,0.15)]"
        style={{
          left: sidebarWidth,
          right: 0,
          height: drawerHeight,
        }}
        data-drawer-height={drawerHeight}
      >
        {/* Drag handle strip — only interactive when open */}
        <div
          className={cn(
            'bg-ops-blue-dark flex h-10 shrink-0 flex-col items-center justify-center gap-0.5',
            open && 'cursor-ns-resize',
          )}
          onPointerDown={onPointerDown}
          aria-hidden="true"
        >
          {/* Visual groove */}
          {open && <div className="h-1 w-16 rounded-full bg-white/20" />}

          {/* Title row */}
          <div className="flex w-full items-center px-4">
            <span className="font-heading text-sm font-semibold text-white">Script</span>
            <button
              type="button"
              onClick={toggle}
              aria-label={open ? 'Collapse script drawer' : 'Expand script drawer'}
              className="ml-auto inline-flex items-center justify-center rounded p-1 text-white hover:bg-white/10"
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Body */}
        {open && (
          <div
            className="bg-background flex-1 overflow-y-auto border-t border-white/10 p-3"
            style={{ height: height }}
          >
            {children}
          </div>
        )}
      </div>
    </>
  );
}
