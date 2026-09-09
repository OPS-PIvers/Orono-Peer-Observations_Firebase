/**
 * Firestore query-shape helpers shared by the web app, functions, and
 * scripts.
 */

/**
 * Maximum number of values Firestore accepts in an `in` / `not-in` /
 * `array-contains-any` filter. Exceeding it makes the query throw, so any
 * caller whose value list is unbounded has to split it into batches and merge
 * the results — see `chunkForInQuery`.
 */
export const FIRESTORE_IN_LIMIT = 30;

/**
 * Split `values` into consecutive batches no larger than `size` (defaults to
 * Firestore's `in`-clause limit), so a caller can run one query per batch and
 * merge the results instead of silently truncating the list.
 *
 * Returns `[]` for an empty input — there is nothing to query for.
 */
export function chunkForInQuery<T>(values: readonly T[], size: number = FIRESTORE_IN_LIMIT): T[][] {
  if (size < 1) throw new RangeError(`chunkForInQuery: size must be >= 1, got ${String(size)}`);
  const batches: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    batches.push(values.slice(i, i + size));
  }
  return batches;
}
