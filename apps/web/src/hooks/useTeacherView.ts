import { COLLECTIONS, OBSERVATION_STATUS, type Observation } from '@ops/shared';
import { useDevMode } from '@/dev/DevModeContext';
import { useFirestoreDoc } from './useFirestoreDoc';

/**
 * Draft privacy. The observed teacher may not read a Draft observation
 * document (firestore.rules); they read `/teacherViews/{id}` instead, a
 * server-written copy holding only what the observer has shared
 * (packages/shared/src/schema/teacherView.ts). Finalized observations are
 * read from `/observations` as before.
 *
 * Only the observed teacher can read their views, so this is true only when
 * `observedEmail` is the signed-in user. Viewing as someone else keeps
 * reading `/observations` under the viewer's own access, as it always has.
 */
export function useReadsTeacherViews(observedEmail: string): boolean {
  const { viewAsEmail, effectiveEmail } = useDevMode();
  return viewAsEmail === null && !!observedEmail && observedEmail.toLowerCase() === effectiveEmail;
}

export interface ViewerObservationResult {
  data: (Observation & { id: string }) | null;
  loading: boolean;
  error: Error | null;
  /** Which document `data` came from; null until one has loaded. */
  source: 'teacherView' | 'observation' | null;
}

/**
 * One observation, from wherever the signed-in user may read it.
 *
 * The teacher view is tried first: rules let only the observed teacher read
 * it, so a readable view means the viewer is that teacher. While it says
 * Draft, the view is the answer. Once it says Finalized, or when it can't be
 * read (anyone else, a View As session, or a view not written yet), the
 * observation document is read as before.
 *
 * Neither read comes from the cache: the editor hydrates its draft once from
 * the first snapshot (see useFirestoreDoc's `cached` option).
 */
export function useViewerObservation(observationId: string | undefined): ViewerObservationResult {
  const { viewAsEmail } = useDevMode();
  const id = observationId ?? '';
  // A View As session reads under the viewer's own access, which never
  // includes someone else's teacher view.
  const viewPath = id && viewAsEmail === null ? `${COLLECTIONS.teacherViews}/${id}` : '';
  const view = useFirestoreDoc<Observation>(viewPath, { cached: false });

  // For the one render after the id changes, the hooks still hold the
  // previous observation's snapshot; never let it stand in for this one.
  const viewData = view.data?.id === id ? view.data : null;
  const viewSettled =
    !viewPath || (!view.loading && (view.error !== null || view.data === viewData));
  const viewIsDraft =
    viewSettled && view.error === null && viewData?.status === OBSERVATION_STATUS.draft;
  const obsPath = id && viewSettled && !viewIsDraft ? `${COLLECTIONS.observations}/${id}` : '';
  const obs = useFirestoreDoc<Observation>(obsPath, { cached: false });
  const obsData = obs.data?.id === id ? obs.data : null;

  if (viewIsDraft) return { data: viewData, loading: false, error: null, source: 'teacherView' };
  if (!obsPath || obs.loading || (obs.data !== null && obsData === null)) {
    return { data: null, loading: true, error: null, source: null };
  }
  return {
    data: obsData,
    loading: false,
    error: obs.error,
    source: obsData ? 'observation' : null,
  };
}
