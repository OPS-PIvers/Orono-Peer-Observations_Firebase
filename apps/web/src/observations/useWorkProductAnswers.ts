import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Observation, type TiptapDoc, type WorkProductAnswer } from '@ops/shared';
import { db } from '@/lib/firebase';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { EMPTY_ANSWER_DOC, answerToTiptapDoc } from '@/observations/workProductAnswerDoc';

const SAVE_DEBOUNCE_MS = 500;

export type AnswerSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface WorkProductAnswersState {
  /** Current answer document per questionId — local draft for the answerer,
   *  the live Firestore value for everyone else. */
  docs: Record<string, TiptapDoc>;
  /** Raw stored answers by questionId (for `updatedAt`). Always live. */
  stored: Map<string, WorkProductAnswer>;
  setAnswer: (questionId: string, value: TiptapDoc) => void;
  saveState: AnswerSaveState;
  saveError: string | null;
  retry: () => void;
}

/**
 * The observed staff member's answers to the observation's Planning /
 * Reflection questions, with debounced autosave to the observation's
 * `workProductAnswers` array.
 *
 * `canAnswer` decides which side of the fence the caller is on:
 *   - answerer (the observed teacher): local state is hydrated once per
 *     observation (same idiom as the editor's own draft — later snapshots,
 *     including the echo of our own write, must not clobber keystrokes),
 *     and edits schedule a save.
 *   - everyone else: `docs` is derived from the live document on every
 *     snapshot, so the evaluator watches answers arrive in real time.
 *
 * The write replaces the whole array (rules cannot diff array entries), so
 * this must be the only live surface editing a given observation's answers.
 */
export function useWorkProductAnswers(
  observation: (Observation & { id: string }) | null | undefined,
  canAnswer: boolean,
): WorkProductAnswersState {
  const stored = useMemo(() => {
    const map = new Map<string, WorkProductAnswer>();
    for (const a of observation?.workProductAnswers ?? []) map.set(a.questionId, a);
    return map;
  }, [observation?.workProductAnswers]);

  const liveDocs = useMemo(() => {
    const out: Record<string, TiptapDoc> = {};
    for (const [id, a] of stored) out[id] = answerToTiptapDoc(a.answer);
    return out;
  }, [stored]);

  const [localDocs, setLocalDocs] = useState<Record<string, TiptapDoc>>({});
  const localRef = useRef(localDocs);
  const [saveState, setSaveState] = useState<AnswerSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Nothing may be edited before the stored answers are in local state:
  // an editor mounted against the empty pre-hydration value must not be
  // able to write that emptiness back over the real answers.
  const hydratedRef = useRef(false);
  useHydratedDraft(observation?.id ?? null, observation, (src) => {
    const next: Record<string, TiptapDoc> = {};
    for (const a of src.workProductAnswers ?? []) next[a.questionId] = answerToTiptapDoc(a.answer);
    localRef.current = next;
    hydratedRef.current = true;
    setLocalDocs(next);
  });

  const observationId = observation?.id ?? null;

  // Questions edited since the last flush. Only these get a fresh
  // `updatedAt` — the whole array is rewritten on every save, and stamping
  // untouched answers would make them look edited after finalize.
  const dirtyRef = useRef(new Set<string>());
  const storedRef = useRef(stored);
  useEffect(() => {
    storedRef.current = stored;
  }, [stored]);

  const flushNow = useCallback(() => {
    if (!observationId) return;
    timerRef.current = null;
    const now = new Date();
    const dirty = dirtyRef.current;
    dirtyRef.current = new Set();
    const next: WorkProductAnswer[] = [];
    for (const [questionId, answer] of Object.entries(localRef.current)) {
      const previous = storedRef.current.get(questionId);
      if (dirty.has(questionId)) {
        next.push({ questionId, answer, updatedAt: now });
      } else if (previous) {
        next.push({ questionId, answer: previous.answer, updatedAt: previous.updatedAt });
      }
      // Never stored and never edited (an empty editor that only ever
      // mounted): nothing to persist.
    }
    setSaveState('saving');
    setDoc(
      doc(db, COLLECTIONS.observations, observationId),
      { workProductAnswers: next, lastModifiedAt: serverTimestamp() },
      { merge: true },
    )
      .then(() => {
        if (!mountedRef.current) return;
        setSaveState('saved');
        setSaveError(null);
      })
      .catch((err: unknown) => {
        console.error('useWorkProductAnswers: autosave failed', err);
        if (!mountedRef.current) return;
        setSaveState('error');
        setSaveError(err instanceof Error ? err.message : 'Unknown error');
      });
  }, [observationId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(flushNow, SAVE_DEBOUNCE_MS);
  }, [flushNow]);

  // Flush a pending debounce on unmount so navigating away mid-typing does
  // not drop the last edit. State updates after unmount are guarded above.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        flushNow();
      }
    };
  }, [flushNow]);

  const setAnswer = useCallback(
    (questionId: string, value: TiptapDoc) => {
      if (!canAnswer || !hydratedRef.current) return;
      // Ignore no-op updates (editor normalisation on mount, a click that
      // changes nothing): a write would stamp a fresh `updatedAt` on every
      // answer and falsely flag them as edited after finalize.
      const current = localRef.current[questionId] ?? EMPTY_ANSWER_DOC;
      if (JSON.stringify(current) === JSON.stringify(value)) return;
      const next = { ...localRef.current, [questionId]: value };
      dirtyRef.current.add(questionId);
      localRef.current = next;
      setLocalDocs(next);
      scheduleSave();
    },
    [canAnswer, scheduleSave],
  );

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    flushNow();
  }, [flushNow]);

  const docs = canAnswer ? localDocs : liveDocs;
  return useMemo(
    () => ({ docs, stored, setAnswer, saveState, saveError, retry }),
    [docs, stored, setAnswer, saveState, saveError, retry],
  );
}
