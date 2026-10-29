import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { COLLECTIONS, OBSERVATION_STATUS } from '@ops/shared';

interface DocState {
  data: Record<string, unknown> | null;
  loading: boolean;
  error: Error | null;
}

const state = vi.hoisted(() => ({
  docs: new Map<string, DocState>(),
  subscribed: [] as string[],
  dev: { viewAsEmail: null as string | null, effectiveEmail: 'teacher@orono.k12.mn.us' },
}));

vi.mock('@/dev/DevModeContext', () => ({ useDevMode: () => state.dev }));
vi.mock('./useFirestoreDoc', () => ({
  useFirestoreDoc: (path: string) => {
    if (!path) return { data: null, loading: true, error: null };
    state.subscribed.push(path);
    return state.docs.get(path) ?? { data: null, loading: true, error: null };
  },
}));

import { useReadsTeacherViews, useViewerObservation } from './useTeacherView';

const VIEW = `${COLLECTIONS.teacherViews}/obs1`;
const OBS = `${COLLECTIONS.observations}/obs1`;
const denied = Object.assign(new Error('Missing or insufficient permissions.'), {
  code: 'permission-denied',
});

function loaded(data: Record<string, unknown> | null): DocState {
  return { data: data && { id: 'obs1', ...data }, loading: false, error: null };
}

afterEach(() => {
  state.docs.clear();
  state.subscribed = [];
  state.dev = { viewAsEmail: null, effectiveEmail: 'teacher@orono.k12.mn.us' };
});

describe('useViewerObservation', () => {
  it('gives the observed teacher the teacher view of a Draft and never reads the observation', () => {
    state.docs.set(VIEW, loaded({ status: OBSERVATION_STATUS.draft, observationName: 'View' }));
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.source).toBe('teacherView');
    expect(result.current.data?.observationName).toBe('View');
    expect(state.subscribed).not.toContain(OBS);
  });

  it('gives the observed teacher the observation once it is Finalized', () => {
    state.docs.set(VIEW, loaded({ status: OBSERVATION_STATUS.finalized }));
    state.docs.set(OBS, loaded({ status: OBSERVATION_STATUS.finalized, observationName: 'Full' }));
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.source).toBe('observation');
    expect(result.current.data?.observationName).toBe('Full');
  });

  it('falls back to the observation when the view is denied (an observer)', () => {
    state.docs.set(VIEW, { data: null, loading: false, error: denied });
    state.docs.set(OBS, loaded({ status: OBSERVATION_STATUS.draft, observationName: 'Full' }));
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.source).toBe('observation');
    expect(result.current.data?.observationName).toBe('Full');
    expect(result.current.error).toBeNull();
  });

  it('falls back to the observation when no view exists yet', () => {
    state.docs.set(VIEW, loaded(null));
    state.docs.set(OBS, loaded({ status: OBSERVATION_STATUS.draft }));
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.source).toBe('observation');
  });

  it('waits for the view before reading the observation', () => {
    state.docs.set(OBS, loaded({ status: OBSERVATION_STATUS.draft }));
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(state.subscribed).not.toContain(OBS);
  });

  it('reads only the observation while viewing as someone else', () => {
    state.dev = {
      viewAsEmail: 'teacher@orono.k12.mn.us',
      effectiveEmail: 'teacher@orono.k12.mn.us',
    };
    state.docs.set(OBS, loaded({ status: OBSERVATION_STATUS.draft }));
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.source).toBe('observation');
    expect(state.subscribed).not.toContain(VIEW);
  });

  it("never returns another observation's snapshot while the id changes", () => {
    state.docs.set(VIEW, {
      data: { id: 'other', status: OBSERVATION_STATUS.draft },
      loading: false,
      error: null,
    });
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('surfaces an error reading the observation', () => {
    state.docs.set(VIEW, { data: null, loading: false, error: denied });
    state.docs.set(OBS, { data: null, loading: false, error: denied });
    const { result } = renderHook(() => useViewerObservation('obs1'));
    expect(result.current.error).toBe(denied);
    expect(result.current.loading).toBe(false);
  });
});

describe('useReadsTeacherViews', () => {
  it('is true only for the signed-in user themselves', () => {
    expect(renderHook(() => useReadsTeacherViews('Teacher@orono.k12.mn.us')).result.current).toBe(
      true,
    );
    expect(renderHook(() => useReadsTeacherViews('other@orono.k12.mn.us')).result.current).toBe(
      false,
    );
    expect(renderHook(() => useReadsTeacherViews('')).result.current).toBe(false);
  });

  it('is false while viewing as someone else', () => {
    state.dev = {
      viewAsEmail: 'teacher@orono.k12.mn.us',
      effectiveEmail: 'teacher@orono.k12.mn.us',
    };
    expect(renderHook(() => useReadsTeacherViews('teacher@orono.k12.mn.us')).result.current).toBe(
      false,
    );
  });
});
