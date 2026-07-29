/**
 * The predicate ObservationEditorPage uses to answer "is there still an edit
 * that Firestore hasn't accepted?" — and the forced-sign-out flush callback
 * built on top of it.
 *
 * REGRESSION: the callback used to guard with `flushTimer.current === null`
 * alone. That only sees an edit sitting in the 800ms autosave debounce. A save
 * that already ran, FAILED, and is waiting in the auto-retry backoff has
 * `savingState === 'error'` and `flushTimer.current === null` — so a
 * session-timeout sign-out returned immediately without flushing, then
 * unmounted the page and cancelled the backoff timer, losing the edit
 * silently. That is the exact data loss PLAT-09's flush hook exists to stop.
 *
 * The editor page itself can't be mounted cheaply (Firestore listeners, Tiptap,
 * the rubric grid), which is why this logic lives in its own module: these
 * cases now exercise the REAL predicate, not a stand-in lambda.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createForcedSignOutFlushCallback,
  hasPendingEditorWork,
  type EditorSavingState,
  type PendingEditorWorkRefs,
} from './pendingEditorWork';

function makeRefs(overrides?: {
  flushTimer?: ReturnType<typeof setTimeout> | null;
  savingState?: EditorSavingState;
}): PendingEditorWorkRefs {
  return {
    flushTimer: { current: overrides?.flushTimer ?? null },
    savingState: { current: overrides?.savingState ?? 'idle' },
  };
}

/** A real timer handle, so `clearTimeout` in the callback has something to do. */
function armedTimer(): ReturnType<typeof setTimeout> {
  return setTimeout(() => undefined, 60_000);
}

describe('hasPendingEditorWork', () => {
  it('is true while an edit is sitting in the autosave debounce', () => {
    const timer = armedTimer();
    try {
      expect(hasPendingEditorWork(makeRefs({ flushTimer: timer }))).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  });

  it('is true when a save already failed and is waiting in retry backoff', () => {
    // The backoff retry lives in the retry effect's OWN local timer, so
    // flushTimer is back to null here — the state a timer-only check misses.
    expect(hasPendingEditorWork(makeRefs({ savingState: 'error' }))).toBe(true);
  });

  it.each(['idle', 'saved', 'saving'] as const)(
    'is false when nothing is debounced and savingState is %s',
    (savingState) => {
      expect(hasPendingEditorWork(makeRefs({ savingState }))).toBe(false);
    },
  );
});

describe('createForcedSignOutFlushCallback', () => {
  it('flushes a debounced edit and disarms the timer so unmount cannot re-fire it', async () => {
    const timer = armedTimer();
    const refs = makeRefs({ flushTimer: timer });
    const flush = vi.fn(() => Promise.resolve());

    await createForcedSignOutFlushCallback(refs, flush)();

    expect(flush).toHaveBeenCalledTimes(1);
    // Cleared: the post-sign-out unmount cleanup keys off this same ref, and a
    // second write would run against a null auth.currentUser.
    expect(refs.flushTimer.current).toBeNull();
  });

  it('flushes a save that failed and is waiting in retry backoff', async () => {
    // THE REGRESSION. Deadline lands between the failed write and its backoff
    // retry; sign-out is about to unmount the page and cancel that retry.
    const refs = makeRefs({ savingState: 'error' });
    const flush = vi.fn(() => Promise.resolve());

    await createForcedSignOutFlushCallback(refs, flush)();

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flushes when a debounced edit and a failed save are both outstanding', async () => {
    const timer = armedTimer();
    const refs = makeRefs({ flushTimer: timer, savingState: 'error' });
    const flush = vi.fn(() => Promise.resolve());

    await createForcedSignOutFlushCallback(refs, flush)();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(refs.flushTimer.current).toBeNull();
  });

  it('does nothing when the editor is genuinely idle', async () => {
    const refs = makeRefs({ savingState: 'saved' });
    const flush = vi.fn(() => Promise.resolve());

    await createForcedSignOutFlushCallback(refs, flush)();

    // No pointless write on every timeout sign-out from a read-only page.
    expect(flush).not.toHaveBeenCalled();
  });

  it('does not step in front of a write that is already in flight', async () => {
    // 'saving' means a setDoc is on the wire; the Firestore SDK owns it, and
    // AuthProvider awaits this callback before signing out either way.
    const refs = makeRefs({ savingState: 'saving' });
    const flush = vi.fn(() => Promise.resolve());

    await createForcedSignOutFlushCallback(refs, flush)();

    expect(flush).not.toHaveBeenCalled();
  });

  it('awaits the flush, so AuthProvider does not sign out mid-write', async () => {
    const refs = makeRefs({ savingState: 'error' });
    const order: string[] = [];
    const flush = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push('flush-resolved');
    });

    await createForcedSignOutFlushCallback(refs, flush)();
    order.push('callback-returned');

    expect(order).toEqual(['flush-resolved', 'callback-returned']);
  });

  it('propagates a flush rejection so the caller can log it', async () => {
    // runForcedSignOutFlush catches and logs; the deadline is enforced
    // regardless. What must NOT happen is swallowing it here silently.
    const refs = makeRefs({ savingState: 'error' });
    const flush = vi.fn(() => Promise.reject(new Error('permission-denied')));

    await expect(createForcedSignOutFlushCallback(refs, flush)()).rejects.toThrow(
      'permission-denied',
    );
  });
});
