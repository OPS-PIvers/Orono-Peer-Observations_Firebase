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
  const { data: questions } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    WP_QUESTIONS_CONSTRAINTS,
  );

  const answerMap = new Map<string, string>();
  for (const a of (observation.workProductAnswers ?? [])) {
    answerMap.set(a.questionId, a.answer);
  }

  const sorted = questions ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Header */}
      <div className="bg-ops-blue-dark flex items-center gap-3 px-5 py-3.5">
        <ClipboardList className="h-5 w-5 shrink-0 text-white" />
        <h2 className="font-heading text-sm font-semibold text-white">Staff Responses</h2>
      </div>

      {/* Questions + answers */}
      <div className="space-y-5 px-5 py-4">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">No questions configured.</p>
        ) : (
          sorted.map((q, idx) => {
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
          })
        )}
      </div>
    </div>
  );
}
