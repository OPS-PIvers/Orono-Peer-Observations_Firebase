import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

/**
 * Context for in-app navigation guards.
 *
 * When a page has unsaved changes, it registers a guard via registerGuard.
 * AppSidebar and other navigation components check if a guard is registered
 * and show a confirmation dialog before allowing navigation. Once the user
 * confirms, the navigation can proceed.
 */
export const UnsavedChangesGuardContext = createContext<{
  isGuarded: boolean;
  registerGuard: (guard: { onConfirm?: () => void }) => void;
  unregisterGuard: (guard: { onConfirm?: () => void }) => void;
} | null>(null);

/**
 * Register a beforeunload handler and integrate with in-app navigation.
 *
 * While `isDirty` is true:
 *   - A beforeunload handler prompts the browser to confirm before
 *     closing/refreshing the tab.
 *   - A guard is registered in the UnsavedChangesGuardContext so
 *     sidebar/nav links can show an in-app confirmation dialog.
 *
 * Usage:
 *   const { isDirty } = useDashboardDraft();
 *   useUnsavedChangesGuard(isDirty);
 *
 * @param isDirty - Whether there are unsaved changes
 */
export function useUnsavedChangesGuard(isDirty: boolean): void {
  const context = useContext(UnsavedChangesGuardContext);
  const guardRef = useRef<{ onConfirm?: () => void }>({});

  const handleBeforeUnload = useCallback((e: BeforeUnloadEvent) => {
    // Calling preventDefault() is the standardized way to trigger the browser's
    // "leave site?" confirmation; the legacy `returnValue` assignment is
    // deprecated and no longer required by modern browsers.
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!isDirty) {
      // Clean up guard when no longer dirty.
      if (context) {
        context.unregisterGuard(guardRef.current);
        guardRef.current = {};
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
      return;
    }

    // Install beforeunload handler.
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Register guard with context if available.
    if (context) {
      guardRef.current = {};
      context.registerGuard(guardRef.current);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (context) {
        context.unregisterGuard(guardRef.current);
      }
    };
  }, [isDirty, context, handleBeforeUnload]);
}
