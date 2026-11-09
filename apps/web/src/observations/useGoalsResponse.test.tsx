import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Observation, TiptapDoc } from '@ops/shared';

const { mockSave } = vi.hoisted(() => ({ mockSave: vi.fn() }));
vi.mock('./saveTeacherResponse', () => ({ saveTeacherResponse: mockSave }));

import { useGoalsResponse } from './useGoalsResponse';
import { resetPendingTeacherWrites } from './pendingTeacherWrites';

function textDoc(text: string): TiptapDoc {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

// The teacher view the teacher reads on a Draft, still holding the old text.
const observation = {
  id: 'obs-1',
  goalsResponse: textDoc('old'),
} as unknown as Observation & { id: string };

afterEach(() => {
  resetPendingTeacherWrites();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useGoalsResponse', () => {
  it('reopening before the save lands shows the saved text, not the stale copy', () => {
    vi.useFakeTimers();
    // The write is still in flight when the editor is reopened.
    mockSave.mockReturnValue(new Promise(() => undefined));
    const first = renderHook(() => useGoalsResponse(observation, true));
    act(() => {
      first.result.current.setValue(textDoc('new'));
    });
    // Leaving the editor flushes the pending debounce.
    first.unmount();
    expect(mockSave).toHaveBeenCalledTimes(1);

    const reopened = renderHook(() => useGoalsResponse(observation, true));
    expect(reopened.result.current.value).toEqual(textDoc('new'));
  });

  it('forgets a save that failed', async () => {
    vi.useFakeTimers();
    mockSave.mockRejectedValue(new Error('offline'));
    const first = renderHook(() => useGoalsResponse(observation, true));
    act(() => {
      first.result.current.setValue(textDoc('new'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(first.result.current.saveState).toBe('error');
    first.unmount();

    const reopened = renderHook(() => useGoalsResponse(observation, true));
    expect(reopened.result.current.value).toEqual(textDoc('old'));
  });
});
