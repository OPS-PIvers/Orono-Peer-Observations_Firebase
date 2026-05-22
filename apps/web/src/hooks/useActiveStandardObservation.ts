import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation } from '@ops/shared';
import { useFirestoreCollection } from './useFirestoreCollection';

/**
 * Returns the most recent Draft Standard observation where the current
 * user is the observed staff member, or null if none exists.
 *
 * Used by the staff dashboard to surface pre-/observation/post- cards
 * the moment the peer evaluator creates the observation, even before
 * dates are picked.
 */
export function useActiveStandardObservation(observedEmail: string) {
  const constraints = useMemo(
    () => [
      where('observedEmail', '==', observedEmail),
      where('type', '==', OBSERVATION_TYPES.standard),
      where('status', '==', OBSERVATION_STATUS.draft),
      orderBy('createdAt', 'desc'),
      limit(1),
    ],
    [observedEmail],
  );

  const { data, loading, error } = useFirestoreCollection<Observation>(
    observedEmail ? COLLECTIONS.observations : '',
    constraints,
    // Disambiguate by email: the hook keys on constraint types only, so a
    // different observedEmail would otherwise collide on the same cache key.
    [observedEmail],
  );

  return { observation: data?.[0] ?? null, loading, error };
}
