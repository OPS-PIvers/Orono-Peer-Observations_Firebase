import { useMemo } from 'react';
import { COLLECTIONS, type ObserverScope, type Staff } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useDevMode, useEffectiveClaims } from '@/dev/DevModeContext';
import { useFirestoreDoc } from './useFirestoreDoc';

/**
 * The signed-in observer's scope for observeBlockReason / canObserve: their
 * effective role plus their buildings (dev mode's impersonated building
 * wins, as on My Staff). `loading` is true until the buildings are known, so
 * callers don't flash every row as blocked.
 */
export function useObserverScope(): ObserverScope & { loading: boolean } {
  const { user } = useAuth();
  const { override } = useDevMode();
  const { role } = useEffectiveClaims();
  const email = user?.email?.toLowerCase() ?? '';
  const { data: me, loading } = useFirestoreDoc<Staff>(
    email ? `${COLLECTIONS.staff}/${email}` : '',
  );
  const overrideBuilding =
    override.role === 'administrator' && override.building ? override.building : null;
  return useMemo(
    () => ({
      role,
      buildings: overrideBuilding ? [overrideBuilding] : (me?.buildings ?? []),
      loading: !overrideBuilding && loading,
    }),
    [role, overrideBuilding, me, loading],
  );
}
