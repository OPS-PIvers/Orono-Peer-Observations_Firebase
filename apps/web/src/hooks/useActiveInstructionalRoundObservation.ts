import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation } from '@ops/shared';
import { useFirestoreCollection } from './useFirestoreCollection';

/**
 * Returns the first Draft Instructional Round observation where the current
 * user is the observed staff member, or null if none exists.
 */
export function useActiveInstructionalRoundObservation(observedEmail: string) {
  const constraints = useMemo(
    () => [
      where('observedEmail', '==', observedEmail),
      where('type', '==', OBSERVATION_TYPES.instructionalRound),
      where('status', '==', OBSERVATION_STATUS.draft),
      orderBy('createdAt', 'desc'),
      limit(1),
    ],
    [observedEmail],
  );

  const { data, loading, error } = useFirestoreCollection<Observation>(
    COLLECTIONS.observations,
    constraints,
  );

  return { observation: data?.[0] ?? null, loading, error };
}
