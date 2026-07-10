import { Eye } from 'lucide-react';
import type { Observation } from '@ops/shared';
import { QuestionAnswerForm } from '@/observations/QuestionAnswerForm';

interface InstructionalRoundAnswerFormProps {
  observation: Observation & { id: string };
}

/**
 * Staff-facing form for answering Instructional Round observation questions.
 * Shown on MyRubricPage when the user has an active IR observation.
 * Thin wrapper around QuestionAnswerForm — see that component for the
 * shared autosave/rich-text implementation.
 */
export function InstructionalRoundAnswerForm({ observation }: InstructionalRoundAnswerFormProps) {
  return (
    <QuestionAnswerForm
      observation={observation}
      questionType="instructional-round"
      icon={<Eye className="h-5 w-5 shrink-0 text-white" />}
      title="Instructional Round"
      emptyMessage="No instructional round questions configured. Ask your administrator."
    />
  );
}
