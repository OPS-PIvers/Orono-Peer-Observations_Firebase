import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { oversight, results } = vi.hoisted(() => {
  const results: { current: Record<string, unknown[] | null> } = { current: {} };
  return { oversight: { current: false }, results };
});

vi.mock('firebase/firestore', () => ({
  limit: (n: number) => ({ type: 'limit', n }),
  where: (...args: unknown[]) => ({ type: 'where', args }),
  orderBy: (...args: unknown[]) => ({ type: 'orderBy', args }),
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/auth/observationOversight', () => ({
  useObservationOversight: () => ({ allowed: oversight.current, loading: false }),
}));
vi.mock('@/dev/DevModeContext', () => ({
  useEffectiveEmail: () => 'me@orono.k12.mn.us',
}));
// Keyed on the first keyPart ('all' | 'own' | 'shared'); '' path = not subscribed.
vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string, _c: unknown, keyParts: string[]) => ({
    data: path ? (results.current[keyParts[0] ?? ''] ?? null) : null,
    loading: false,
    error: null,
  }),
}));

import { useObserverObservations } from './useObserverObservations';

const obs = (id: string, ms: number) => ({ id, lastModifiedAt: new Date(ms) });
const args = { enabled: true, filters: [], orderBy: {} as never, pageSize: 3, keyParts: [] };

beforeEach(() => {
  oversight.current = false;
  results.current = {};
});

describe('useObserverObservations', () => {
  it('merges own and co-observed observations newest first, without duplicates', () => {
    results.current = {
      own: [obs('a', 300), obs('b', 100)],
      shared: [obs('c', 200), obs('a', 300)],
    };
    const { result } = renderHook(() => useObserverObservations(args));
    expect(result.current.data?.map((o) => o.id)).toEqual(['a', 'c', 'b']);
    expect(result.current.oversight).toBe(false);
  });

  it('waits for both queries before showing anything', () => {
    results.current = { own: [obs('a', 1)], shared: null };
    const { result } = renderHook(() => useObserverObservations(args));
    expect(result.current.data).toBeNull();
  });

  it('reports more pages when either query fills its page', () => {
    results.current = { own: [obs('a', 3), obs('b', 2), obs('c', 1)], shared: [] };
    const { result } = renderHook(() => useObserverObservations(args));
    expect(result.current.hasMore).toBe(true);
  });

  it('uses one unscoped query for Full Access (oversight)', () => {
    oversight.current = true;
    results.current = { all: [obs('x', 1)], own: [obs('mine', 2)] };
    const { result } = renderHook(() => useObserverObservations(args));
    expect(result.current.data?.map((o) => o.id)).toEqual(['x']);
    expect(result.current.oversight).toBe(true);
  });
});
