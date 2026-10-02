import { hasObservationOversight } from '@ops/shared';
import { useDevMode } from '@/dev/DevModeContext';

/**
 * Whether the viewer oversees every observation and observation window
 * (Full Access only). Separate from useAdminConsoleAccess on purpose: the
 * hasAdminAccess flag opens the Admin Console, not other people's
 * observations. In dev view-as the viewed person's role decides. Same shape
 * as useAdminConsoleAccess; resolves from claims, so never loading.
 */
export function useObservationOversight(): { allowed: boolean; loading: boolean } {
  const { effectiveClaims } = useDevMode();
  return { allowed: hasObservationOversight(effectiveClaims.role), loading: false };
}
