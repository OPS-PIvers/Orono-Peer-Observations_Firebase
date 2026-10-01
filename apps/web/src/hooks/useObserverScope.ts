import { useMemo } from 'react';
import { COLLECTIONS, type ObserverScope, type Staff } from '@ops/shared';
import { useEffectiveClaims, useEffectiveEmail } from '@/dev/DevModeContext';
import { useFirestoreDoc } from './useFirestoreDoc';

/**
 * The signed-in observer's scope for observeBlockReason / canObserve: their
 * effective role plus their buildings (as the viewed-as person in dev
 * mode). `loading` is true until the buildings are known, so callers don't
 * flash every row as blocked.
 */
export function useObserverScope(): ObserverScope & { loading: boolean } {
  const { role } = useEffectiveClaims();
  const email = useEffectiveEmail();
  const { data: me, loading } = useFirestoreDoc<Staff>(
    email ? `${COLLECTIONS.staff}/${email}` : '',
  );
  return useMemo(
    () => ({ role, buildings: me?.buildings ?? [], loading: loading && !me }),
    [role, me, loading],
  );
}
