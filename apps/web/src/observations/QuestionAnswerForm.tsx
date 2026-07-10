import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { orderBy, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  type Observation,
  type TiptapDoc,
  type WorkProductAnswer,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { answerToTiptapDoc } from '@/observations/workProductAnswerDoc';

const SAVE_DEBOUNCE_MS = 500;

export interface QuestionAnswerFormProps {
  observation: Observation & { id: string };
  /** Work product question bank type these questions belong to. */
  questionType: WorkProductQuestion['type'];
  icon: React.ReactNode;
  title: string;
  /** Shown when the question bank has no active questions of this type. */
  emptyMessage: string;
}

/**
 * Staff-facing form for answering Work Product / Instructional Round
 * observation questions. Shared by WorkProductAnswerForm and
 * InstructionalRoundAnswerForm, which differ only in which question type
 * they query and their header copy. Answers are rich-text (Tiptap), debounced
 * and autosaved to Firestore, matching the ScriptEditor/NotesPanel idiom used
 * everywhere else in the app.
 */
export function QuestionAnswerForm({
  observation,
  questionType,
  icon,
  title,
  emptyMessage,
}: QuestionAnswerFormProps) {
  const constraints = useMemo(
    () => [
      where('type', '==', questionType),
      where('isActive', '==', true),
      orderBy('order', 'asc'),
    ],
    [questionType],
  );
  const { data: questions } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    constraints,
    // Disambiguate the query-cache key from other question types: both
    // constraint lists are shaped where|where|orderBy, so without this the
    // WP and IR forms (mounted together when a staff member has both an
    // active WP and IR observation) would collide on the same cache entry.
    [questionType],
  );

  const [answers, setAnswers] = useState<Record<string, TiptapDoc>>(() => {
    const map: Record<string, TiptapDoc> = {};
    for (const a of observation.workProductAnswers ?? []) {
      map[a.questionId] = answerToTiptapDoc(a.answer);
    }
    return map;
  });

  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef(answers);
  const mountedRef = useRef(true);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const flushNow = useCallback(() => {
    const next: WorkProductAnswer[] = Object.entries(answersRef.current).map(
      ([questionId, answer]) => ({
        questionId,
        answer,
        updatedAt: new Date(),
      }),
    );
    setDoc(
      doc(db, COLLECTIONS.observations, observation.id),
      { workProductAnswers: next, lastModifiedAt: serverTimestamp() },
      { merge: true },
    )
      .then(() => {
        if (mountedRef.current) setSavingState('saved');
      })
      .catch((err: unknown) => {
        console.error('QuestionAnswerForm: autosave failed', err);
        if (mountedRef.current) setSavingState('error');
      });
  }, [observation.id]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSavingState('saving');
    timerRef.current = setTimeout(flushNow, SAVE_DEBOUNCE_MS);
  }, [flushNow]);

  // Flush any pending save when the component unmounts. The flush
  // itself guards setState calls behind `mountedRef`, so the post-
  // unmount resolution path won't touch React state.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        flushNow();
      }
    };
  }, [flushNow]);

  function handleChange(questionId: string, value: TiptapDoc) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    scheduleSave();
  }

  const sorted = questions ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Header */}
      <div className="bg-ops-blue-dark flex items-center gap-3 px-5 py-3.5">
        {icon}
        <div>
          <h2 className="font-heading text-sm font-semibold text-white">{title}</h2>
          <p className="mt-0.5 text-xs text-white/70">
            Respond to each question below. Your answers autosave as you type.
          </p>
        </div>
        <div className="ml-auto text-xs">
          {savingState === 'saving' ? (
            <span className="text-white/60">Saving…</span>
          ) : savingState === 'saved' ? (
            <span className="text-white/60">Saved ✓</span>
          ) : savingState === 'error' ? (
            <span className="text-ops-red-light">Save failed — try again</span>
          ) : null}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-5 px-5 py-4">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          sorted.map((q, idx) => (
            <div key={q.id}>
              <p className="text-ops-gray-dark mb-1.5 text-sm font-semibold">
                {idx + 1}. {q.text}
              </p>
              <TiptapEditor
                value={answers[q.questionId]}
                onChange={(value) => handleChange(q.questionId, value)}
                placeholder="Type your response here…"
                minHeight="6rem"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
