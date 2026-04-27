import { useEffect, useState } from 'react';
import { type DocumentData, doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface UseFirestoreDocResult<T> {
  data: (T & { id: string }) | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Subscribe to a single Firestore document. Returns null if the document
 * doesn't exist (vs. an undefined "not loaded yet" state — `loading` flag
 * tracks that separately).
 */
export function useFirestoreDoc<T = DocumentData>(docPath: string): UseFirestoreDocResult<T> {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsubscribe = onSnapshot(
      doc(db, docPath),
      (snap) => {
        if (snap.exists()) {
          setData({ ...(snap.data() as T), id: snap.id });
        } else {
          setData(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [docPath]);

  return { data, loading, error };
}
