import { orderBy, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  type Observation,
  type WorkProductAnswer,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { hasTiptapContent } from '@/utils/tiptapContent';
import { answerToTiptapDoc } from '@/observations/workProductAnswerDoc';

export interface QuestionAnswerViewerProps {
  observation: Observation & { id: string };
  questionType: WorkProductQuestion['type'];
  icon: React.ReactNode;
  title: string;
  emptyMessage: string;
}

/**
 * PE/observer read-only view of staff Work Product / Instructional Round
 * answers. Shared by WorkProductResponseViewer and
 * InstructionalRoundResponseViewer. Renders each answer through the same
 * Tiptap editor used for editing (in read-only mode) so formatting the
 * staff member applied (lists, links, bold, …) shows up here too, with
 * legacy plain-string answers wrapped in a single paragraph.
 */
export function QuestionAnswerViewer({
  observation,
  questionType,
  icon,
  title,
  emptyMessage,
}: QuestionAnswerViewerProps) {
  const { data: questions } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    [where('type', '==', questionType), where('isActive', '==', true), orderBy('order', 'asc')],
    [questionType],
  );

  const answers = new Map<string, WorkProductAnswer>();
  for (const a of observation.workProductAnswers ?? []) {
    answers.set(a.questionId, a);
  }

  const sorted = questions ?? [];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {/* Header */}
      <div className="bg-ops-blue-dark flex items-center gap-3 px-5 py-3.5">
        {icon}
        <h2 className="font-heading text-sm font-semibold text-white">{title}</h2>
      </div>

      {/* Questions + answers */}
      <div className="space-y-5 px-5 py-4">
        {sorted.length === 0 ? (
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        ) : (
          sorted.map((q, idx) => {
            const entry = answers.get(q.questionId);
            const doc = answerToTiptapDoc(entry?.answer);
            const answered = hasTiptapContent(doc);
            return (
              <div key={q.id}>
                <p className="text-ops-gray-dark mb-1 text-sm font-semibold">
                  {idx + 1}. {q.text}
                </p>
                {answered ? (
                  <TiptapEditor
                    value={doc}
                    onChange={() => undefined}
                    readOnly
                    variant="compact"
                    minHeight="4rem"
                    className="mt-1"
                  />
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
