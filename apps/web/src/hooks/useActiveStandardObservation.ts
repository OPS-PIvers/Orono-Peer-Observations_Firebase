import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation } from '@ops/shared';
import { useFirestoreCollection } from './useFirestoreCollection';
import { asViewedObservation, useHidesOwnDrafts, useReadsTeacherViews } from './useTeacherView';

/**
 * Returns the most recent Draft Standard observation where the current
 * user is the observed staff member, or null if none exists.
 *
 * Used by the staff dashboard to surface pre-/observation/post- cards
 * the moment the peer evaluator creates the observation, even before
 * dates are picked.
 */
export function useActiveStandardObservation(
  observedEmail: string,
  /** Scope to one observer's drafts (an observer viewing someone else; see
   *  useStaffCheckpoints). Null for the observed teacher themselves. */
  observerEmail: string | null = null,
) {
  const constraints = useMemo(
    () => [
      ...(observerEmail ? [where('observerEmail', '==', observerEmail)] : []),
      where('observedEmail', '==', observedEmail),
      where('type', '==', OBSERVATION_TYPES.standard),
      where('status', '==', OBSERVATION_STATUS.draft),
      orderBy('createdAt', 'desc'),
      limit(1),
    ],
    [observedEmail, observerEmail],
  );

  // The teacher's own dashboard reads Drafts through their teacher views
  // (Draft privacy); an observer or admin looking at someone reads the
  // observations their access covers.
  const ownDrafts = useReadsTeacherViews(observedEmail) && !observerEmail;
  // Viewing as someone, the reader's own Drafts stay out of reach.
  const hidden = useHidesOwnDrafts(observedEmail);
  const { data, loading, error } = useFirestoreCollection<Observation>(
    observedEmail && !hidden
      ? ownDrafts
        ? COLLECTIONS.teacherViews
        : COLLECTIONS.observations
      : '',
    constraints,
    // Disambiguate by email and type: the hook keys on constraint types only,
    // so the three active-observation hooks would otherwise share one cache
    // entry and hand each other's drafts back.
    [observedEmail, observerEmail ?? '', OBSERVATION_TYPES.standard],
  );

  const first = data?.[0] ?? null;
  return {
    observation: first && ownDrafts ? asViewedObservation(first) : first,
    loading,
    error,
  };
}
