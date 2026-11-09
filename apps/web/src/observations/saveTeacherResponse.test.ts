import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockCall, MockFunctionsError } = vi.hoisted(() => {
  class MockFunctionsError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { mockCall: vi.fn(), MockFunctionsError };
});
vi.mock('@/lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
  FunctionsError: MockFunctionsError,
  httpsCallable: () => mockCall,
}));

import { saveTeacherResponse } from './saveTeacherResponse';

const doc = (text: string) => ({ type: 'doc' as const, content: [{ type: 'text', text }] });

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('saveTeacherResponse', () => {
  it('runs saves of the same field one at a time, in order', async () => {
    const settle: (() => void)[] = [];
    mockCall.mockImplementation(() => new Promise<void>((resolve) => settle.push(resolve)));
    const first = saveTeacherResponse('obs-1', { goalsResponse: doc('a') });
    const second = saveTeacherResponse('obs-1', { goalsResponse: doc('b') });
    await Promise.resolve();
    expect(mockCall).toHaveBeenCalledTimes(1);
    settle[0]?.();
    await first;
    await vi.waitFor(() => expect(mockCall).toHaveBeenCalledTimes(2));
    expect(
      mockCall.mock.calls.map(([d]) => (d as { goalsResponse: unknown }).goalsResponse),
    ).toEqual([doc('a'), doc('b')]);
    settle[1]?.();
    await second;
  });

  it('sends stored Timestamps as Dates', async () => {
    mockCall.mockResolvedValue(undefined);
    const updatedAt = { toDate: () => new Date(5) };
    await saveTeacherResponse('obs-2', {
      workProductAnswers: [{ questionId: 'q1', answer: 'x', updatedAt } as never],
    });
    expect(mockCall).toHaveBeenCalledWith({
      observationId: 'obs-2',
      workProductAnswers: [{ questionId: 'q1', answer: 'x', updatedAt: new Date(5) }],
    });
  });

  it('retries a transient failure, but not a refusal', async () => {
    vi.useFakeTimers();
    mockCall
      .mockRejectedValueOnce(new MockFunctionsError('functions/unavailable'))
      .mockResolvedValueOnce(undefined);
    const saved = saveTeacherResponse('obs-3', { goalsResponse: null });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(saved).resolves.toBeUndefined();
    expect(mockCall).toHaveBeenCalledTimes(2);

    mockCall.mockReset();
    mockCall.mockRejectedValue(new MockFunctionsError('functions/permission-denied'));
    await expect(saveTeacherResponse('obs-3', { goalsResponse: null })).rejects.toThrow(
      'functions/permission-denied',
    );
    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});
