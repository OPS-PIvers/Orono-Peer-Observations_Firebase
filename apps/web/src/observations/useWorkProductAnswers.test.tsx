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
});
