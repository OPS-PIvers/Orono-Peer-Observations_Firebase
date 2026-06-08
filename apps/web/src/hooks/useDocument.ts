import type { DocumentReference } from 'firebase/firestore';
import { useFirestoreDoc, type UseFirestoreDocResult } from './useFirestoreDoc';

/**
 * Subscribe to a single Firestore document by reference. A thin wrapper over
 * `useFirestoreDoc` that accepts a `DocumentReference` (or `null`) and keys
 * the subscription on the ref's path, so the two hooks share one
 * implementation and one snapshot cache. Kept as a separate entry point for
 * callers that already hold a typed ref rather than a path string.
 */
export function useDocument<T>(ref: DocumentReference | null): UseFirestoreDocResult<T> {
  return useFirestoreDoc<T>(ref?.path ?? '');
}
