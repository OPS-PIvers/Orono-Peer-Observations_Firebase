import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * A slot for app-level, must-be-seen interrupts to render INSIDE the topmost
 * open modal layer (a `DialogContent` or `SheetContent`).
 *
 * Why this exists: every modal in the app goes through `dialog.tsx` /
 * `sheet.tsx`, whose Radix content is portaled to the END of `<body>` at
 * `z-50`. Four things then conspire against anything the app renders in
 * ordinary document order:
 *
 *  1. tied z-index + later DOM position means the dialog paints on top;
 *  2. Radix locks `body { pointer-events: none }` while a modal layer is open,
 *     so an element outside the layer can't be clicked;
 *  3. Radix marks the rest of the page `aria-hidden`, so screen readers skip it;
 *  4. Radix traps focus inside the content, so it can't be tabbed to.
 *
 * Rendering the interrupt inside the topmost content sidesteps all four at
 * once. The interrupt this exists for is PLAT-09's session-timeout warning
 * (see AuthProvider): an observer scripting a live classroom must be able to
 * see and act on "Stay signed in" even while the Auto-tag review dialog — or
 * Finalize, Reopen, Regenerate — is open, or they get the silent
 * mid-observation sign-out the warn-first design exists to prevent.
 */
const DialogInterruptContext = createContext<ReactNode>(null);

export function DialogInterruptProvider({
  content,
  children,
}: {
  /** Rendered inside the topmost open modal layer, if any. */
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogInterruptContext.Provider value={content}>{children}</DialogInterruptContext.Provider>
  );
}

// ─── Open-modal-layer stack ─────────────────────────────────────────────────
// Module-level because the layers live in separate React portals with no
// common ancestor below <AuthProvider>, and because AuthProvider itself needs
// to know whether *any* layer is open (it suppresses its own page-level banner
// in favour of the in-dialog copy, so the warning is never announced twice).

let layerStack: readonly number[] = [];
let nextLayerId = 1;
const layerListeners = new Set<() => void>();

function subscribeToLayers(listener: () => void): () => void {
  layerListeners.add(listener);
  return () => {
    layerListeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore`: the id of the topmost open layer. */
function getTopLayerId(): number | null {
  return layerStack.at(-1) ?? null;
}

function notifyLayerChange(): void {
  for (const listener of layerListeners) {
    listener();
  }
}

/** True while at least one Dialog/Sheet content layer is mounted. */
export function useHasOpenDialogLayer(): boolean {
  return useSyncExternalStore(subscribeToLayers, getTopLayerId) !== null;
}

/**
 * Registers this modal layer for the lifetime of the component and reports
 * whether it is the topmost one — only the topmost renders the interrupt, so
 * stacked dialogs don't produce duplicate alerts.
 */
function useIsTopmostDialogLayer(): boolean {
  const [id] = useState(() => nextLayerId++);
  useEffect(() => {
    layerStack = [...layerStack, id];
    notifyLayerChange();
    return () => {
      layerStack = layerStack.filter((other) => other !== id);
      notifyLayerChange();
    };
  }, [id]);
  return useSyncExternalStore(subscribeToLayers, getTopLayerId) === id;
}

/**
 * Rendered as the first child of every `DialogContent` / `SheetContent`.
 * Renders nothing (and costs nothing) unless there's an active interrupt.
 */
export function DialogInterruptSlot(): ReactNode {
  const isTopmost = useIsTopmostDialogLayer();
  const content = useContext(DialogInterruptContext);
  if (!isTopmost || content == null) return null;
  return content;
}
