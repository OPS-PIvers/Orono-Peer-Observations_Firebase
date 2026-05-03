import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { orderBy, where } from 'firebase/firestore';
import { ClipboardList } from 'lucide-react';
import {
  COLLECTIONS,
  type Observation,
  type WorkProductAnswer,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';

const SAVE_DEBOUNCE_MS = 500;

interface WorkProductAnswerFormProps {
  observation: Observation & { id: string };
}

const WP_QUESTIONS_CONSTRAINTS = [
  where('type', '==', 'work-product'),
  where('isActive', '==', true),
  orderBy('order', 'asc'),
];

/**
 * Staff-facing form for answering Work Product observation questions.
 * Shown on MyRubricPage when the user has an active WP observation.
 * Answers are debounced and autosaved to Firestore.
 */
export function WorkProductAnswerForm({ observation }: WorkProductAnswerFormProps) {
  const { data: questions } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    WP_QUESTIONS_CONSTRAINTS,
  );

  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const a of observation.workProductAnswers ?? []) {
      map[a.questionId] = a.answer;
    }
    return map;
  });

  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const flushNow = useCallback(() => {
    const next: WorkProductAnswer[] = Object.entries(answersRef.current).map(
      ([questionId, answer]) => ({
        questionId,
        answer,
        updatedAt: new Date(),
      }),
    );
    void setDoc(
      doc(db, COLLECTIONS.observations, observation.id),
      { workProductAnswers: next, lastModifiedAt: serverTimestamp() },
      { merge: true },
    ).then(() => setSavingState('saved'));
  }, [observation.id]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSavingState('saving');
    timerRef.current = setTimeout(flushNow, SAVE_DEBOUNCE_MS);
  }, [flushNow]);

  // Flush any pending save when the component unmounts.
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
        <ClipboardList className="h-5 w-5 shrink-0 text-white" />
        <div>
          <h2 className="font-heading text-sm font-semibold text-white">Work Product</h2>
          <p className="mt-0.5 text-xs text-white/70">
            Respond to each question below. Your answers autosave as you type.
          </p>
        </div>
        <div className="ml-auto text-xs text-white/60">
          {savingState === 'saving' ? 'Saving…' : savingState === 'saved' ? 'Saved ✓' : null}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-5 px-5 py-4">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">No questions configured yet.</p>
        ) : (
          sorted.map((q, idx) => (
            <div key={q.id}>
              <p className="text-ops-gray-dark mb-1.5 text-sm font-semibold">
                {idx + 1}. {q.text}
              </p>
              <textarea
                value={answers[q.questionId] ?? ''}
                onChange={(e) => handleChange(q.questionId, e.target.value)}
                rows={4}
                className="focus:border-ops-blue focus:ring-ops-blue min-h-[6rem] w-full resize-y rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-1"
                placeholder="Type your response here…"
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
