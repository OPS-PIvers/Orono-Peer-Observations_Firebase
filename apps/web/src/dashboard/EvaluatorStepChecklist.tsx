import { useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type SetStepCheckInput, type Staff } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useNewObservationsDisabled } from '@/hooks/useNewObservationsDisabled';
import { db, functions } from '@/lib/firebase';
import { newDraftObservationDoc } from '@/observations/newObservationDoc';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CheckpointWithStatus } from './deriveCheckpoints';
import { EvaluatorChecklistView, observationTypeForWatchedKind } from './EvaluatorChecklistView';
import { useStaffCheckpoints } from './useStaffCheckpoints';

const setStepCheckFn = httpsCallable<SetStepCheckInput, { ok: true; path: string }>(
  functions,
  'setStepCheck',
);

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * The evaluator's "Year at a glance" checklist for one teacher on
 * StaffPersonPage. Loads the same checkpoints the teacher's dashboard shows
 * (plus steps not yet visible to them), and checks steps off through the
 * `setStepCheck` callable — the only write path; rules deny client writes.
 * The live `stepChecks` listeners pick up the result, so there is no local
 * optimistic state to reconcile.
 */
export function EvaluatorStepChecklist({ staff }: { staff: Staff }) {
  const { tasks } = useStaffCheckpoints(staff.email, { includeHidden: true });
  const { user } = useAuth();
  const observerEmail = user?.email?.toLowerCase() ?? '';
  const { data: observerStaff } = useFirestoreDoc<Staff>(
    observerEmail ? `${COLLECTIONS.staff}/${observerEmail}` : '',
  );
  const newObservationsDisabled = useNewObservationsDisabled();

  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<CheckpointWithStatus | null>(null);

  function setError(stepId: string, message: string | null) {
    setErrors((prev) => {
      const rest = Object.fromEntries(Object.entries(prev).filter(([id]) => id !== stepId));
      return message ? { ...rest, [stepId]: message } : rest;
    });
  }

  async function writeCheck(task: CheckpointWithStatus, observationId: string | null) {
    await setStepCheckFn({
      staffEmail: staff.email.toLowerCase(),
      stepId: task.key,
      checked: !task.checkedBy,
      ...(observationId ? { observationId } : {}),
    });
  }

  async function handleToggle(task: CheckpointWithStatus) {
    setPendingId(task.id);
    setError(task.id, null);
    try {
      await writeCheck(
        task,
        task.checkScope === 'observation' ? (task.observationId ?? null) : null,
      );
    } catch (err) {
      setError(task.id, errorMessage(err, 'Could not save the check-off. Try again.'));
    } finally {
      setPendingId(null);
    }
  }

  async function handleStartAndCheck(task: CheckpointWithStatus) {
    setConfirming(null);
    if (!observerEmail) {
      setError(task.id, 'Missing observer context.');
      return;
    }
    setPendingId(task.id);
    setError(task.id, null);
    let observationId: string;
    try {
      const ref = await addDoc(
        collection(db, COLLECTIONS.observations),
        newDraftObservationDoc({
          observerEmail,
          observerName: observerStaff?.name ?? '',
          staff,
          type: observationTypeForWatchedKind(task.watchedKind),
        }),
      );
      observationId = ref.id;
    } catch (err) {
      setError(task.id, errorMessage(err, 'Could not start the observation.'));
      setPendingId(null);
      return;
    }
    try {
      await writeCheck(task, observationId);
    } catch (err) {
      setError(
        task.id,
        `The observation was started, but the check-off failed: ${errorMessage(err, 'unknown error')}`,
      );
    } finally {
      setPendingId(null);
    }
  }

  const confirmType = confirming ? observationTypeForWatchedKind(confirming.watchedKind) : null;

  return (
    <>
      <EvaluatorChecklistView
        tasks={tasks}
        pendingId={pendingId}
        errors={errors}
        newObservationsDisabled={newObservationsDisabled}
        onToggle={(task) => void handleToggle(task)}
        onStart={(task) => setConfirming(task)}
      />
      {confirming ? (
        <Dialog open onOpenChange={(open) => (open ? null : setConfirming(null))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start observation &amp; mark {confirming.title} done?</DialogTitle>
              <DialogDescription>
                This creates a draft {confirmType} observation of <strong>{staff.name}</strong> with
                you as the observer, then marks “{confirming.title}” complete on their dashboard.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleStartAndCheck(confirming)}>
                Start observation &amp; mark done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
