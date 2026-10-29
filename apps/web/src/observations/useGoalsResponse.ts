import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Observation, type TiptapDoc } from '@ops/shared';
import { db } from '@/lib/firebase';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { registerForcedSignOutFlush } from '@/auth/forcedSignOutFlush';
import type { AnswerSaveState } from './useWorkProductAnswers';
import { EMPTY_ANSWER_DOC } from './workProductAnswerDoc';

const SAVE_DEBOUNCE_MS = 500;

export interface GoalsResponseState {
  /** Local draft for the teacher, the live Firestore value for everyone else. */
  value: TiptapDoc | undefined;
  setValue: (value: TiptapDoc) => void;
  saveState: AnswerSaveState;
  saveError: string | null;
  retry: () => void;
}

/**
 * The observed teacher's Goals & Next Steps response, autosaved to the
 * observation's `goalsResponse` field. Same split as useWorkProductAnswers:
 * the teacher edits a draft hydrated once per observation (later snapshots,
 * including the echo of our own write, must not clobber keystrokes); every
 * other viewer reads the live value.
 */
export function useGoalsResponse(
  observation: (Observation & { id: string }) | null | undefined,
  canWrite: boolean,
): GoalsResponseState {
  const [local, setLocal] = useState<TiptapDoc | undefined>(undefined);
  const localRef = useRef<TiptapDoc | undefined>(undefined);
  const hydratedRef = useRef(false);
  const [saveState, setSaveState] = useState<AnswerSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last write failed and nothing has been saved since. */
  const failedRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useHydratedDraft(observation?.id ?? null, observation, (src) => {
    localRef.current = src.goalsResponse;
    hydratedRef.current = true;
    setLocal(src.goalsResponse);
  });

  const observationId = observation?.id ?? null;

  const flushNow = useCallback((): Promise<void> => {
    if (!observationId) return Promise.resolve();
    timerRef.current = null;
    setSaveState('saving');
    return setDoc(
      doc(db, COLLECTIONS.observations, observationId),
      { goalsResponse: localRef.current ?? null, lastModifiedAt: serverTimestamp() },
      { merge: true },
    )
      .then(() => {
        failedRef.current = false;
        if (!mountedRef.current) return;
        setSaveState('saved');
        setSaveError(null);
      })
      .catch((err: unknown) => {
        console.error('useGoalsResponse: autosave failed', err);
        failedRef.current = true;
        if (!mountedRef.current) return;
        setSaveState('error');
        setSaveError(err instanceof Error ? err.message : 'Unknown error');
      });
  }, [observationId]);

  // Flush a pending debounce on unmount so navigating away mid-typing does
  // not drop the last edit.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void flushNow();
      }
    };
  }, [flushNow]);

  // A session-timeout sign-out unmounts this page after auth is gone, too
  // late for the unmount flush above; land a pending or failed save first.
  useEffect(
    () =>
      registerForcedSignOutFlush(() => {
        if (!timerRef.current && !failedRef.current) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        return flushNow();
      }),
    [flushNow],
  );

  const setValue = useCallback(
    (value: TiptapDoc) => {
      if (!canWrite || !hydratedRef.current) return;
      // Ignore no-op updates (editor normalisation on mount).
      const current = localRef.current ?? EMPTY_ANSWER_DOC;
      if (JSON.stringify(current) === JSON.stringify(value)) return;
      localRef.current = value;
      setLocal(value);
      if (timerRef.current) clearTimeout(timerRef.current);
      setSaveState('saving');
      timerRef.current = setTimeout(() => void flushNow(), SAVE_DEBOUNCE_MS);
    },
    [canWrite, flushNow],
  );

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void flushNow();
  }, [flushNow]);

  return {
    value: canWrite ? local : observation?.goalsResponse,
    setValue,
    saveState,
    saveError,
    retry,
  };
}
