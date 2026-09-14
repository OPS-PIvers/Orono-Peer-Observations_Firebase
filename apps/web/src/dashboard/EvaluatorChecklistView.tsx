import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { OBSERVATION_TYPES, type ObservationType, type WatchedKind } from '@ops/shared';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { checkAttributionLabel, type CheckpointWithStatus } from './deriveCheckpoints';

/**
 * What the evaluator can do with one checklist row:
 *   - `auto`             — the step completes on its own; read-only.
 *   - `toggle`           — check / un-check it.
 *   - `start`            — observation-tied, but the teacher has no matching
 *                          observation: offer to start one and check it.
 *   - `needsFinalized`   — tied to a finalized observation that doesn't
 *                          exist yet; a new draft wouldn't satisfy it.
 *   - `creationDisabled` — would be `start`, but an admin has switched off
 *                          new observation creation.
 */
export type ChecklistAction = 'auto' | 'toggle' | 'start' | 'needsFinalized' | 'creationDisabled';

export function checklistAction(
  task: CheckpointWithStatus,
  opts: { newObservationsDisabled: boolean },
): ChecklistAction {
  if (!task.completionMode || task.completionMode === 'auto') return 'auto';
  if (task.checkScope !== 'observation' || task.observationId) return 'toggle';
  if (task.watchedKind === 'standardFinalized') return 'needsFinalized';
  return opts.newObservationsDisabled ? 'creationDisabled' : 'start';
}

/** The observation type to create so that `watchedKind` resolves to it. The
 *  cross-type kinds all fall through to a Standard draft when nothing else
 *  exists. */
export function observationTypeForWatchedKind(kind: WatchedKind | undefined): ObservationType {
  if (kind === 'workProduct') return OBSERVATION_TYPES.workProduct;
  if (kind === 'instructionalRound') return OBSERVATION_TYPES.instructionalRound;
  return OBSERVATION_TYPES.standard;
}

export interface EvaluatorChecklistViewProps {
  tasks: CheckpointWithStatus[];
  /** Step id whose check-off is in flight, if any. */
  pendingId: string | null;
  /** Last failure per step id. */
  errors: Record<string, string>;
  newObservationsDisabled: boolean;
  onToggle: (task: CheckpointWithStatus) => void;
  onStart: (task: CheckpointWithStatus) => void;
}

/**
 * Presentational "Year at a glance" checklist for StaffPersonPage. Every
 * enabled dashboard step for the teacher, in cycle order; steps an
 * evaluator can check off render as toggle buttons (`aria-pressed`), the
 * rest read-only. Data and writes are wired by EvaluatorStepChecklist.
 */
export function EvaluatorChecklistView({
  tasks,
  pendingId,
  errors,
  newObservationsDisabled,
  onToggle,
  onStart,
}: EvaluatorChecklistViewProps) {
  const done = tasks.filter((t) => t.status === 'done').length;
  return (
    <section
      aria-labelledby="evaluator-checklist-heading"
      className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h2
          id="evaluator-checklist-heading"
          className="font-heading text-ops-blue-dark text-base font-semibold"
        >
          Year at a glance
        </h2>
        <span className="text-ops-gray text-xs">
          {done} of {tasks.length} steps done
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-ops-gray px-4 py-3 text-sm">No dashboard steps are enabled.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {tasks.map((task) => (
            <ChecklistRow
              key={task.id}
              task={task}
              action={checklistAction(task, { newObservationsDisabled })}
              pending={pendingId === task.id}
              busy={pendingId !== null}
              error={errors[task.id]}
              onToggle={onToggle}
              onStart={onStart}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChecklistRow({
  task,
  action,
  pending,
  busy,
  error,
  onToggle,
  onStart,
}: {
  task: CheckpointWithStatus;
  action: ChecklistAction;
  pending: boolean;
  busy: boolean;
  error: string | undefined;
  onToggle: (task: CheckpointWithStatus) => void;
  onStart: (task: CheckpointWithStatus) => void;
}) {
  const isDone = task.status === 'done';
  const checked = !!task.checkedBy;
  const attribution = checkAttributionLabel(task);
  const errorId = `checklist-error-${task.id}`;

  const meta: string[] = [];
  if (attribution) meta.push(attribution);
  else if (isDone && task.autoDone) meta.push('Done automatically');
  if (!isDone && task.dateLabel) meta.push(task.dateLabel);
  if (task.visibleToStaff === false) meta.push('Not on their dashboard yet');

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {isDone ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden />
        ) : (
          <Circle className="text-ops-gray-lighter h-5 w-5 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {task.title || '(untitled step)'}
            <span className="sr-only">{isDone ? ' — done' : ' — not done'}</span>
          </p>
          {meta.length > 0 ? <p className="text-ops-gray text-xs">{meta.join(' · ')}</p> : null}
        </div>
        {action === 'toggle' ? (
          <Button
            type="button"
            size="sm"
            variant={checked ? 'default' : 'outline'}
            // A toggle keeps one name; `aria-pressed` carries the state. The
            // name starts with the visible text so voice control matches it.
            aria-pressed={checked}
            aria-label={`Mark complete: ${task.title}`}
            aria-describedby={error ? errorId : undefined}
            aria-busy={pending || undefined}
            disabled={busy}
            onClick={() => onToggle(task)}
          >
            {pending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : checked ? (
              <CheckCircle2 aria-hidden />
            ) : null}
            {pending ? 'Saving…' : 'Mark complete'}
          </Button>
        ) : action === 'start' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-describedby={error ? errorId : undefined}
            aria-busy={pending || undefined}
            disabled={busy}
            onClick={() => onStart(task)}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? 'Starting…' : `Start observation & mark ${task.title} done`}
          </Button>
        ) : (
          <span className={cn('text-ops-gray text-xs', action !== 'auto' && 'italic')}>
            {action === 'auto'
              ? 'Automatic'
              : action === 'needsFinalized'
                ? 'Available once an observation is finalized'
                : 'New observations are disabled'}
          </span>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-ops-red-dark mt-1 pl-8 text-xs">
          {error}
        </p>
      ) : null}
    </li>
  );
}
