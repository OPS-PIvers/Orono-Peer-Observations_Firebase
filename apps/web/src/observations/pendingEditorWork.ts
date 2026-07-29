/**
 * "Does the observation editor still owe Firestore a write?" — extracted from
 * ObservationEditorPage so the answer lives in exactly ONE place, and so it can
 * be tested without standing up the whole editor page.
 *
 * There are two, and only two, states in which an edit exists in the browser
 * but not yet in Firestore:
 *
 *   1. A debounced edit is sitting in the AUTOSAVE_DEBOUNCE_MS timer
 *      (`flushTimer.current !== null`) and hasn't been written yet.
 *   2. A write already ran and FAILED (`savingState === 'error'`). The retry
 *      lives in the auto-retry backoff effect's own local timer — by then
 *      `flushTimer.current` is back to `null`, so a timer-only check reports
 *      "nothing pending" while an edit is very much still unsaved.
 *
 * Missing case 2 is how the forced-sign-out flush silently dropped work: a
 * transient blip on school WiFi fails the setDoc, the deadline lands before the
 * backoff retry fires, sign-out unmounts the page, and the backoff timer is
 * cancelled with the edit still only in memory.
 *
 * NOTE: the `beforeunload` guard in ObservationEditorPage deliberately uses a
 * BROADER condition — it also counts an in-flight `'saving'` write, because
 * discarding the tab kills a request that is still on the wire. That is a
 * different question from this one, which asks whether *we* still have to
 * initiate a write. Don't merge them.
 */

export type EditorSavingState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The two mutable refs the predicate reads, narrowed to what it actually
 * needs so tests can pass plain objects instead of React refs.
 */
export interface PendingEditorWorkRefs {
  /** ObservationEditorPage's `flushTimer` — the autosave debounce handle. */
  flushTimer: { current: ReturnType<typeof setTimeout> | null };
  /** ObservationEditorPage's `savingStateRef` — mirror of `savingState`. */
  savingState: { current: EditorSavingState };
}

/** True when an edit exists locally that Firestore has not accepted yet. */
export function hasPendingEditorWork(refs: PendingEditorWorkRefs): boolean {
  return refs.flushTimer.current !== null || refs.savingState.current === 'error';
}

/**
 * Builds the callback ObservationEditorPage registers with
 * `registerForcedSignOutFlush`: land whatever is outstanding while the token is
 * still valid, and do nothing at all when the editor is genuinely idle.
 *
 * Clearing the debounce timer here is load-bearing — it stops the unmount
 * cleanup (which runs *after* auth has been invalidated) from firing a second,
 * doomed write.
 */
export function createForcedSignOutFlushCallback(
  refs: PendingEditorWorkRefs,
  flush: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (!hasPendingEditorWork(refs)) return;
    if (refs.flushTimer.current !== null) {
      clearTimeout(refs.flushTimer.current);
      refs.flushTimer.current = null;
    }
    // In the error/backoff case there is no debounce timer to clear; calling
    // flush() moves savingState to 'saving', which tears down the backoff
    // effect and clears its pending retry — so this never double-writes.
    await flush();
  };
}
