import { ClipboardList } from 'lucide-react';
import type { Observation } from '@ops/shared';
import { QuestionAnswerForm } from '@/observations/QuestionAnswerForm';

interface WorkProductAnswerFormProps {
  observation: Observation & { id: string };
}

/**
 * Staff-facing form for answering Work Product observation questions.
 * Shown on MyRubricPage when the user has an active WP observation.
 * Thin wrapper around QuestionAnswerForm — see that component for the
 * shared autosave/rich-text implementation.
 */
export function WorkProductAnswerForm({ observation }: WorkProductAnswerFormProps) {
  return (
    <QuestionAnswerForm
      observation={observation}
      questionType="work-product"
      icon={<ClipboardList className="h-5 w-5 shrink-0 text-white" />}
      title="Work Product"
      emptyMessage="No questions configured yet."
    />
  );
}
