import { Eye } from 'lucide-react';
import type { Observation } from '@ops/shared';
import { QuestionAnswerViewer } from '@/observations/QuestionAnswerViewer';

interface InstructionalRoundResponseViewerProps {
  observation: Observation & { id: string };
}

/**
 * PE/observer read-only view of staff Instructional Round answers.
 * Shown in ObservationEditorPage when observation.type === 'Instructional Round'.
 */
export function InstructionalRoundResponseViewer({
  observation,
}: InstructionalRoundResponseViewerProps) {
  return (
    <QuestionAnswerViewer
      observation={observation}
      questionType="instructional-round"
      icon={<Eye className="h-5 w-5 shrink-0 text-white" />}
      title="Instructional Round Responses"
      emptyMessage="No instructional round questions configured."
    />
  );
}
