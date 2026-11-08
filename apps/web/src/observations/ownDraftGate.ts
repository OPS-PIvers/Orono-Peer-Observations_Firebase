import {
  and,
  or,
  where,
  type QueryFieldFilterConstraint,
  type QueryFilterConstraint,
} from 'firebase/firestore';
import { OBSERVATION_STATUS } from '@ops/shared';

/**
 * What an observation list query is already narrowed to, for
 * {@link ownDraftGate}.
 */
export interface ObservationListScope {
  /** The query's `status ==` filter, if any. */
  status?: string | null;
  /** The query's `observedEmail ==` filter, if any. */
  observedEmail?: string | null;
}

/**
 * The extra filter an observation list query needs when the reader gets in
 * through `canReadAllObservations()` (Full Access oversight, or View As):
 * the rules let those readers list everything except their own Draft
 * observations, and rules aren't filters, so the query itself has to leave
 * them out. Returns no filter when the scope already does.
 *
 * `readerEmail` is the signed-in account's own email (the token the rules
 * see), never the View As email.
 */
export function ownDraftGate(
  readerEmail: string | null | undefined,
  scope: ObservationListScope = {},
): QueryFilterConstraint[] {
  if (!readerEmail) return [];
  const finalized = OBSERVATION_STATUS.finalized;
  if (scope.status === finalized) return [];
  if (scope.observedEmail) {
    // Someone else's observations can't be the reader's own; the reader's
    // own are readable once Finalized.
    const own = scope.observedEmail.toLowerCase() === readerEmail.toLowerCase();
    return own ? [where('status', '==', finalized)] : [];
  }
  // Any other status filter is a non-Finalized one, so the reader's own
  // observations can't match it at all.
  if (scope.status) return [where('observedEmail', '!=', readerEmail)];
  return [or(where('observedEmail', '!=', readerEmail), where('status', '==', finalized))];
}

/**
 * A query's filters with its gate added. Ungated filters pass through as
 * they are, so those queries are exactly the ones served before; an or()
 * gate needs every filter wrapped in one and().
 */
export function withGate(
  filters: readonly QueryFieldFilterConstraint[],
  gate: readonly QueryFilterConstraint[],
): QueryFilterConstraint[] {
  const all = [...filters, ...gate];
  return gate.some((f) => f.type === 'or' || f.type === 'and') ? [and(...all)] : all;
}
