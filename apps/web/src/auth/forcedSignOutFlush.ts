/**
 * PLAT-09 × the observation editor: a registry of "land your pending write
 * NOW" callbacks that AuthProvider runs *before* it invalidates auth on a
 * session-timeout sign-out.
 *
 * Why this exists: ObservationEditorPage debounces every edit — a rubric
 * proficiency toggle, a scratch-note keystroke, the scriptDoc write that
 * applying reviewed auto-tags pushes through — by AUTOSAVE_DEBOUNCE_MS (800ms)
 * before writing to Firestore. A forced sign-out signs the user out and then
 * navigates to /sign-in; the SPA route change unmounts the editor, whose
 * unmount cleanup flushes — but by then `auth.currentUser` is null and the
 * write fails silently. Any edit made inside that sub-second window is lost
 * with nothing shown to anyone.
 *
 * So: mounted editors register here, AuthProvider awaits the flushes while the
 * token is still valid, and only then signs out. The wait is bounded — a hung
 * flush must never be able to keep an expired session alive, so the deadline
 * is still enforced even in the worst case.
 */

/** Runs while auth is still valid. Rejections are logged, never rethrown. */
export type ForcedSignOutFlush = () => void | Promise<void>;

/**
 * Upper bound on how long a forced sign-out waits for pending flushes. Long
 * enough for a single Firestore `setDoc` round-trip on a school iPad, short
 * enough that a wedged callback can't measurably delay enforcing the deadline.
 */
export const FORCED_SIGN_OUT_FLUSH_TIMEOUT_MS = 3000;

const callbacks = new Set<ForcedSignOutFlush>();

/** Registers `callback`; returns the unregister function (effect cleanup). */
export function registerForcedSignOutFlush(callback: ForcedSignOutFlush): () => void {
  callbacks.add(callback);
  return () => {
    callbacks.delete(callback);
  };
}

/**
 * Runs every registered flush concurrently and resolves once they've all
 * settled — or once `timeoutMs` elapses, whichever comes first. Never rejects:
 * the caller's next step is signing the user out, and that must happen whether
 * or not the last write made it.
 */
export async function runForcedSignOutFlush(
  timeoutMs: number = FORCED_SIGN_OUT_FLUSH_TIMEOUT_MS,
): Promise<void> {
  if (callbacks.size === 0) return;
  const flushes = [...callbacks].map(async (callback) => {
    try {
      await callback();
    } catch (err) {
      console.warn('Pending-work flush failed before forced sign-out', err);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.all(flushes), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
