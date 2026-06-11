import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation } from '@ops/shared';
import { useFirestoreCollection } from './useFirestoreCollection';

/**
 * Returns all Draft Instructional Round observations where the current user
 * is the observed staff member, capped at 5 (a teacher realistically never
 * has more active IR drafts than that). The first item is also exposed as the
 * `observation` convenience field for callers that only need one.
 */
export function useActiveInstructionalRoundObservation(observedEmail: string) {
  const constraints = useMemo(
    () => [
      where('observedEmail', '==', observedEmail),
      where('type', '==', OBSERVATION_TYPES.instructionalRound),
      where('status', '==', OBSERVATION_STATUS.draft),
      orderBy('createdAt', 'desc'),
      limit(5),
    ],
    [observedEmail],
  );

  const { data, loading, error } = useFirestoreCollection<Observation>(
    COLLECTIONS.observations,
    constraints,
    // Disambiguate by email: the hook keys on constraint types only, so a
    // different observedEmail would otherwise collide on the same cache key.
    [observedEmail],
  );

  const observations = data ?? [];
  return { observations, observation: observations[0] ?? null, loading, error };
}
