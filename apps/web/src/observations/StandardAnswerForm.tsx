import { NotebookPen } from 'lucide-react';
import type { Observation } from '@ops/shared';
import { QuestionAnswerForm } from '@/observations/QuestionAnswerForm';

interface StandardAnswerFormProps {
  observation: Observation & { id: string };
}

/**
 * Staff-facing form for answering Standard observation questions.
 * Shown on MyRubricPage when the user has an active Standard observation.
 * Thin wrapper around QuestionAnswerForm — see that component for the
 * shared autosave/rich-text implementation.
 */
export function StandardAnswerForm({ observation }: StandardAnswerFormProps) {
  return (
    <QuestionAnswerForm
      observation={observation}
      questionType="standard"
      icon={<NotebookPen className="h-5 w-5 shrink-0 text-white" />}
      title="Observation Reflection"
      emptyMessage="No questions configured yet."
    />
  );
}
