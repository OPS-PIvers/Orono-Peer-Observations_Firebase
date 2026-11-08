import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { oversight, results, viewingAs, seen } = vi.hoisted(() => {
  const results: { current: Record<string, unknown[] | null> } = { current: {} };
  const seen: { current: Partial<Record<string, unknown[]>> } = { current: {} };
  return {
    oversight: { current: false },
    viewingAs: { current: false },
    results,
    seen,
  };
});

vi.mock('firebase/firestore', () => ({
  limit: (n: number) => ({ type: 'limit', n }),
  where: (...args: unknown[]) => ({ type: 'where', args }),
  orderBy: (...args: unknown[]) => ({ type: 'orderBy', args }),
  and: (...filters: unknown[]) => ({ type: 'and', filters }),
  or: (...filters: unknown[]) => ({ type: 'or', filters }),
}));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'reader@orono.k12.mn.us' } }),
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/auth/observationOversight', () => ({
  useObservationOversight: () => ({ allowed: oversight.current, loading: false }),
}));
vi.mock('@/dev/DevModeContext', () => ({
  useEffectiveEmail: () => 'me@orono.k12.mn.us',
  useIsViewingAs: () => viewingAs.current,
}));
// Keyed on the first keyPart ('all' | 'own' | 'shared'); '' path = not subscribed.
vi.mock('@/hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: (path: string, constraints: unknown[], keyParts: string[]) => {
    if (path) seen.current[keyParts[0] ?? ''] = constraints;
    return {
      data: path ? (results.current[keyParts[0] ?? ''] ?? null) : null,
      loading: false,
      error: null,
    };
  },
}));

import { useObserverObservations } from './useObserverObservations';

const obs = (id: string, ms: number) => ({ id, lastModifiedAt: new Date(ms) });
const args = { enabled: true, orderBy: {} as never, pageSize: 3, keyParts: [] };

beforeEach(() => {
  oversight.current = false;
  viewingAs.current = false;
  results.current = {};
  seen.current = {};
});

const READER_NOT_OWN_DRAFT = {
  type: 'or',
  filters: [
    { type: 'where', args: ['observedEmail', '!=', 'reader@orono.k12.mn.us'] },
    { type: 'where', args: ['status', '==', 'Finalized'] },
  ],
};

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

  it("leaves the reader's own Drafts out of the oversight query", () => {
    oversight.current = true;
    renderHook(() => useObserverObservations(args));
    expect(seen.current['all']?.[0]).toEqual({ type: 'and', filters: [READER_NOT_OWN_DRAFT] });
  });

  it('a non-Finalized status filter excludes the reader with !=', () => {
    oversight.current = true;
    renderHook(() => useObserverObservations({ ...args, status: 'Draft' }));
    expect(seen.current['all']?.slice(0, 2)).toEqual([
      { type: 'where', args: ['status', '==', 'Draft'] },
      { type: 'where', args: ['observedEmail', '!=', 'reader@orono.k12.mn.us'] },
    ]);
  });

  it("an observer's own queries stay ungated, except while viewing as someone", () => {
    renderHook(() => useObserverObservations(args));
    expect(seen.current['own']?.[0]).toEqual({
      type: 'where',
      args: ['observerEmail', '==', 'me@orono.k12.mn.us'],
    });
    viewingAs.current = true;
    renderHook(() => useObserverObservations(args));
    expect(seen.current['own']?.[0]).toEqual({
      type: 'and',
      filters: [
        { type: 'where', args: ['observerEmail', '==', 'me@orono.k12.mn.us'] },
        READER_NOT_OWN_DRAFT,
      ],
    });
  });
});
