import { ClipboardList } from 'lucide-react';
import type { Observation } from '@ops/shared';
import { QuestionAnswerViewer } from '@/observations/QuestionAnswerViewer';

interface WorkProductResponseViewerProps {
  observation: Observation & { id: string };
}

/**
 * PE/observer read-only view of staff Work Product answers.
 * Shown in ObservationEditorPage when observation.type === 'Work Product'.
 */
export function WorkProductResponseViewer({ observation }: WorkProductResponseViewerProps) {
  return (
    <QuestionAnswerViewer
      observation={observation}
      questionType="work-product"
      icon={<ClipboardList className="h-5 w-5 shrink-0 text-white" />}
      title="Staff Responses"
      emptyMessage="No questions configured."
    />
  );
}
