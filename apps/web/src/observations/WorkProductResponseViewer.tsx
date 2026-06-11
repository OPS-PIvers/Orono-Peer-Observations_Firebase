import { orderBy, where } from 'firebase/firestore';
import { ClipboardList } from 'lucide-react';
import { COLLECTIONS, type Observation, type WorkProductQuestion } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';

const WP_QUESTIONS_CONSTRAINTS = [
  where('type', '==', 'work-product'),
  where('isActive', '==', true),
  orderBy('order', 'asc'),
];

interface WorkProductResponseViewerProps {
  observation: Observation & { id: string };
}

/**
 * PE/observer read-only view of staff Work Product answers.
 * Shown in ObservationEditorPage when observation.type === 'Work Product'.
 */
export function WorkProductResponseViewer({ observation }: WorkProductResponseViewerProps) {
  const { data: questions, error: questionsError } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    WP_QUESTIONS_CONSTRAINTS,
  );

  const answerMap = new Map<string, string>();
  for (const a of observation.workProductAnswers ?? []) {
    answerMap.set(a.questionId, a.answer);
  }

  const sorted = questions ?? [];

  // Answers whose question is no longer in the active bank for this type
  // (deactivated, deleted, or retyped). Rendered from the snapshotted
  // question text so historical responses never silently disappear. Only
  // computed once the bank has loaded so live answers aren't misfiled.
  const liveIds = new Set(sorted.map((q) => q.questionId));
  const orphaned = questions
    ? (observation.workProductAnswers ?? []).filter(
        (a) => !liveIds.has(a.questionId) && a.answer.trim() !== '',
      )
    : [];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Header */}
      <div className="bg-ops-blue-dark flex items-center gap-3 px-5 py-3.5">
        <ClipboardList className="h-5 w-5 shrink-0 text-white" />
        <h2 className="font-heading text-sm font-semibold text-white">Staff Responses</h2>
      </div>

      {/* Questions + answers */}
      <div className="space-y-5 px-5 py-4">
        {questionsError ? (
          <div
            role="alert"
            className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
          >
            Failed to load questions: {questionsError.message}
          </div>
        ) : sorted.length === 0 && orphaned.length === 0 ? (
          <p className="text-muted-foreground text-sm">No questions configured.</p>
        ) : (
          <>
            {sorted.map((q, idx) => {
              const answer = answerMap.get(q.questionId);
              return (
                <div key={q.id}>
                  <p className="text-ops-gray-dark mb-1 text-sm font-semibold">
                    {idx + 1}. {q.text}
                  </p>
                  {answer ? (
                    <div className="bg-ops-gray-lightest mt-1 rounded-md px-3 py-2 text-sm whitespace-pre-wrap text-gray-700">
                      {answer}
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400 italic">Not yet answered</p>
                  )}
                </div>
              );
            })}
            {orphaned.length > 0 ? (
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-ops-gray-dark text-sm font-semibold">Archived questions</h3>
                <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
                  These questions are no longer in the active question bank. The responses below are
                  preserved as they were answered.
                </p>
                <div className="space-y-5">
                  {orphaned.map((a, idx) => (
                    <div key={a.questionId}>
                      <p className="text-ops-gray-dark mb-1 text-sm font-semibold">
                        {sorted.length + idx + 1}.{' '}
                        {a.questionText ?? 'Question no longer available'}
                      </p>
                      <div className="bg-ops-gray-lightest mt-1 rounded-md px-3 py-2 text-sm whitespace-pre-wrap text-gray-700">
                        {a.answer}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
