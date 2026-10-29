import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Observation, TiptapDoc } from '@ops/shared';

const { mockSetDoc } = vi.hoisted(() => ({ mockSetDoc: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ kind: 'doc' })),
  serverTimestamp: vi.fn(() => 'ts'),
  setDoc: mockSetDoc,
}));

import { useWorkProductAnswers } from './useWorkProductAnswers';
import { resetPendingTeacherWrites } from './pendingTeacherWrites';

function textDoc(text: string): TiptapDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const observation = {
  id: 'obs-1',
  workProductAnswers: [{ questionId: 'q1', answer: textDoc('old'), updatedAt: new Date(0) }],
} as unknown as Observation & { id: string };

function writtenAnswers(call: number): unknown {
  const payload = mockSetDoc.mock.calls[call]?.[1] as { workProductAnswers: { answer: unknown }[] };
  return payload.workProductAnswers.map((a) => a.answer);
}

afterEach(() => {
  resetPendingTeacherWrites();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useWorkProductAnswers', () => {
  it('retries a failed save with the local text, not the stored answer', async () => {
    vi.useFakeTimers();
    mockSetDoc.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkProductAnswers(observation, true));

    act(() => {
      result.current.setAnswer('q1', textDoc('new'));
      result.current.setAnswer('q2', textDoc('brand new'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.saveState).toBe('error');

    await act(async () => {
      result.current.retry();
      await Promise.resolve();
    });

    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    expect(writtenAnswers(1)).toEqual([textDoc('new'), textDoc('brand new')]);
    expect(result.current.saveState).toBe('saved');
  });

  // On a Draft the teacher reads the teacher view, which a Cloud Function
  // rewrites a moment after each save; until then it still has the old answers.
  describe('when the copy the teacher reads trails their saves', () => {
    it('a second save keeps the first answer instead of the stale copy', async () => {
      vi.useFakeTimers();
      mockSetDoc.mockResolvedValue(undefined);
      const { result, rerender } = renderHook(({ obs }) => useWorkProductAnswers(obs, true), {
        initialProps: { obs: observation },
      });

      act(() => {
        result.current.setAnswer('q1', textDoc('new'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      // A fresh snapshot of the not-yet-updated view arrives.
      rerender({ obs: { ...observation } });
      act(() => {
        result.current.setAnswer('q2', textDoc('second'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(mockSetDoc).toHaveBeenCalledTimes(2);
      expect(writtenAnswers(1)).toEqual([textDoc('new'), textDoc('second')]);
    });

    it('reopening the observation shows the saved answer, not the stale copy', async () => {
      vi.useFakeTimers();
      mockSetDoc.mockResolvedValue(undefined);
      const first = renderHook(() => useWorkProductAnswers(observation, true));
      act(() => {
        first.result.current.setAnswer('q1', textDoc('new'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      first.unmount();

      const reopened = renderHook(() => useWorkProductAnswers({ ...observation }, true));
      expect(reopened.result.current.docs['q1']).toEqual(textDoc('new'));
    });

    it('goes back to the stored answers once the copy has caught up', async () => {
      vi.useFakeTimers();
      mockSetDoc.mockResolvedValue(undefined);
      const first = renderHook(() => useWorkProductAnswers(observation, true));
      act(() => {
        first.result.current.setAnswer('q1', textDoc('new'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      first.unmount();

      const caughtUp = {
        ...observation,
        workProductAnswers: [{ questionId: 'q1', answer: textDoc('new'), updatedAt: new Date(1) }],
      } as unknown as Observation & { id: string };
      renderHook(() => useWorkProductAnswers(caughtUp, true)).unmount();
      // Someone else (another device) has since changed it; that stored
      // value wins now that the teacher's own save has been seen.
      const later = {
        ...observation,
        workProductAnswers: [
          { questionId: 'q1', answer: textDoc('later'), updatedAt: new Date(2) },
        ],
      } as unknown as Observation & { id: string };
      const reopened = renderHook(() => useWorkProductAnswers(later, true));
      expect(reopened.result.current.docs['q1']).toEqual(textDoc('later'));
    });
  });
});
