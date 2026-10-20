/**
 * PLAT-09 × work that only exists in this tab: a registry of "don't sign me
 * out yet" checks that AuthProvider asks before a session-timeout sign-out.
 *
 * Why this exists: the forced-sign-out flush (forcedSignOutFlush.ts) can land
 * a pending Firestore write in a few hundred milliseconds, but an audio
 * recording can't be landed that way. While it's recording, uploading, or
 * finished but not yet in Drive, the audio lives only in the tab, and the
 * sign-out's navigation to /sign-in would unmount the recorder and drop it.
 * The deadline is counted from the last real sign-in, so it can land in the
 * middle of a class period.
 *
 * So: a recorder holding unsaved audio registers here, and AuthProvider holds
 * the sign-out (showing an "expired" banner instead) until the hold is
 * released. The hold is capped at SIGN_OUT_HOLD_MAX_MS past the deadline, so
 * a forgotten tab can't keep an expired session alive indefinitely.
 */

/** Returns true while the caller still holds work the sign-out would lose. */
export type SignOutHold = () => boolean;

/** Longest a sign-out can be held past the session deadline. Covers a full
 *  class period plus an upload on slow Wi-Fi. */
export const SIGN_OUT_HOLD_MAX_MS = 2 * 60 * 60 * 1000;

const holds = new Set<SignOutHold>();

/** Registers `hold`; returns the unregister function (effect cleanup). */
export function registerSignOutHold(hold: SignOutHold): () => void {
  holds.add(hold);
  return () => {
    holds.delete(hold);
  };
}

/** True if any registered hold is active. A throwing hold counts as not
 *  holding: a broken check must never keep an expired session alive. */
export function isSignOutHeld(): boolean {
  for (const hold of holds) {
    try {
      if (hold()) return true;
    } catch (err) {
      console.warn('Sign-out hold check failed', err);
    }
  }
  return false;
}
