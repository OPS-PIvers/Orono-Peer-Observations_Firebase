import { useEffect, useState } from 'react';
import { type DocumentReference, onSnapshot } from 'firebase/firestore';

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function useDocument<T>(ref: DocumentReference | null): {
  data: (T & { id: string }) | null;
  loading: boolean;
  error: Error | null;
} {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!ref) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? ({ id: snap.id, ...snap.data() } as T & { id: string }) : null);
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.path ?? '']);

  return { data, loading, error };
}
