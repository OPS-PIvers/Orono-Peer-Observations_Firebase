import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { orderBy, where } from 'firebase/firestore';
import { Eye } from 'lucide-react';
import {
  COLLECTIONS,
  type Observation,
  type WorkProductAnswer,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';

const SAVE_DEBOUNCE_MS = 500;

interface InstructionalRoundAnswerFormProps {
  observation: Observation & { id: string };
}

const IR_QUESTIONS_CONSTRAINTS = [
  where('isActive', '==', true),
  where('type', '==', 'instructional-round'),
  orderBy('order', 'asc'),
];

/**
 * Staff-facing form for answering Instructional Round observation questions.
 * Shown on MyRubricPage when the user has an active IR observation.
 * Answers are debounced and autosaved to Firestore.
 */
export function InstructionalRoundAnswerForm({ observation }: InstructionalRoundAnswerFormProps) {
  const { data: questions, error: questionsError } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    IR_QUESTIONS_CONSTRAINTS,
  );

  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const a of observation.workProductAnswers ?? []) {
      map[a.questionId] = a.answer;
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

  // Question text snapshots, keyed by questionId. Previously-stored
  // snapshots (from answers whose question has since been deactivated,
  // retyped, or deleted) are overlaid with the live bank so each save
  // persists the text the staff member actually answered.
  const questionTextsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const a of observation.workProductAnswers ?? []) {
      if (a.questionText !== undefined) map[a.questionId] = a.questionText;
    }
    for (const q of questions ?? []) {
      map[q.questionId] = q.text;
    }
    questionTextsRef.current = map;
  }, [observation.workProductAnswers, questions]);

  const flushNow = useCallback(() => {
    const next: WorkProductAnswer[] = Object.entries(answersRef.current).map(
      ([questionId, answer]) => {
        const questionText = questionTextsRef.current[questionId];
        return {
          questionId,
          answer,
          updatedAt: new Date(),
          ...(questionText !== undefined ? { questionText } : {}),
        };
      },
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
        console.error('InstructionalRoundAnswerForm: autosave failed', err);
        if (mountedRef.current) setSavingState('error');
      });
  }, [observation.id]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSavingState('saving');
    timerRef.current = setTimeout(flushNow, SAVE_DEBOUNCE_MS);
  }, [flushNow]);

  // Flush any pending save when the component unmounts. The flush
  // itself guards setState calls behind `mountedRef`.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        flushNow();
      }
    };
  }, [flushNow]);

  function handleChange(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    scheduleSave();
  }

  const sorted = questions ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Header */}
      <div className="bg-ops-blue-dark flex items-center gap-3 px-5 py-3.5">
        <Eye className="h-5 w-5 shrink-0 text-white" />
        <div>
          <h2 className="font-heading text-sm font-semibold text-white">Instructional Round</h2>
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
        {questionsError ? (
          <div
            role="alert"
            className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
          >
            Failed to load questions: {questionsError.message}
          </div>
        ) : sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No instructional round questions configured. Ask your administrator.
          </p>
        ) : (
          sorted.map((q, idx) => {
            const labelId = `ir-question-${q.questionId}`;
            return (
              <div key={q.id}>
                <p id={labelId} className="text-ops-gray-dark mb-1.5 text-sm font-semibold">
                  {idx + 1}. {q.text}
                </p>
                <textarea
                  value={answers[q.questionId] ?? ''}
                  onChange={(e) => handleChange(q.questionId, e.target.value)}
                  rows={4}
                  aria-labelledby={labelId}
                  className="focus:border-ops-blue focus:ring-ops-blue min-h-[6rem] w-full resize-y rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-1"
                  placeholder="Type your response here…"
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
