import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

/**
 * App-wide "you're offline" strip. Rendered by `<Layout>` directly under
 * `<GlobalBanner />` so it appears on every authenticated route (dashboard,
 * directory, profile, modules) — not just the observation editor, where
 * `useOnlineStatus` was previously the only consumer (see
 * `ObservationEditorPage.tsx` / `GlobalToolsBar.tsx`).
 *
 * Deliberately has no dismiss affordance, matching `GlobalBanner`: it clears
 * itself on the next render once `useOnlineStatus` reports `online` again.
 * The outer live region stays mounted even while online so screen readers
 * pick up the strip the moment connectivity drops mid-session.
 */
export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {isOnline ? null : (
        <div className="bg-ops-red-lighter text-ops-red-dark flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-medium">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>You&rsquo;re offline — changes may not save.</span>
        </div>
      )}
    </div>
  );
}
