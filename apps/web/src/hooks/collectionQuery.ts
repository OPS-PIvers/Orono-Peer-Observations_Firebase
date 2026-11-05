import {
  type CollectionReference,
  type Query,
  type QueryCompositeFilterConstraint,
  type QueryConstraint,
  type QueryNonFilterConstraint,
  query,
} from 'firebase/firestore';

/** A where/orderBy/limit constraint, or one and()/or() filter. */
export type CollectionConstraint = QueryConstraint | QueryCompositeFilterConstraint;

function isComposite(c: CollectionConstraint): c is QueryCompositeFilterConstraint {
  return c.type === 'and' || c.type === 'or';
}

function isNonFilter(c: CollectionConstraint): c is QueryNonFilterConstraint {
  return c.type !== 'where' && !isComposite(c);
}

/** Firestore takes either plain where() filters or a single composite
 *  filter (which then has to hold every filter), plus ordering/limits. */
export function buildQuery(
  ref: CollectionReference,
  constraints: readonly CollectionConstraint[],
): Query {
  if (constraints.length === 0) return ref;
  const composites = constraints.filter(isComposite);
  const [composite] = composites;
  if (!composite) return query(ref, ...constraints.filter((c) => !isComposite(c)));
  const rest = constraints.filter(isNonFilter);
  if (composites.length > 1 || rest.length + 1 !== constraints.length) {
    throw new Error('A composite filter must hold every filter of its query.');
  }
  return query(ref, composite, ...rest);
}
