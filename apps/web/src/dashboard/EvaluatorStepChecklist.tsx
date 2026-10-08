import { useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  OBSERVATION_TYPES,
  COLLECTIONS,
  canCreateObservations,
  canObserve,
  creatableObservationTypes,
  type SetStepCheckInput,
  type Staff,
} from '@ops/shared';
import { useEffectiveClaims, useEffectiveEmail, useIsViewingAs } from '@/dev/DevModeContext';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useObserverScope } from '@/hooks/useObserverScope';
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
import { assertWritable } from '@/dev/viewAsGuard';
import { useObservationOversight } from '@/auth/observationOversight';
import { useQuestionSetResolution } from '@/observations/useQuestionSetResolution';

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
  const viewerEmail = useEffectiveEmail();
  const { allowed: oversight, loading: oversightLoading } = useObservationOversight();
  // An observer's checklist reflects only their own observations of this
  // teacher; Full Access (oversight) sees every observer's.
  const { tasks } = useStaffCheckpoints(
    oversightLoading ? '' : staff.email,
    { includeHidden: true },
    oversight ? null : viewerEmail,
  );
  const observerEmail = viewerEmail;
  const { data: observerStaff } = useFirestoreDoc<Staff>(
    observerEmail ? `${COLLECTIONS.staff}/${observerEmail}` : '',
  );
  const newObservationsDisabled = useNewObservationsDisabled();
  const effectiveRole = useEffectiveClaims().role;
  const isViewingAs = useIsViewingAs();
  const observerScope = useObserverScope();
  // A building Administrator can only start observations of summative staff
  // in their buildings; otherwise these steps wait for another observer.
  const canCreate =
    canCreateObservations(effectiveRole) &&
    !observerScope.loading &&
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
    canObserve(observerScope, { ...staff, buildings: staff.buildings ?? [] });
  const creatableTypes = creatableObservationTypes(effectiveRole);

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
    assertWritable();
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

  /** Starts a draft only. Once the draft exists the row becomes the normal
   *  "Mark complete" toggle, so the step is checked off when the work has
   *  actually happened rather than the moment the draft is created. */
  async function handleStart(task: CheckpointWithStatus, questionSetId: string) {
    setConfirming(null);
    if (!observerEmail) {
      setError(task.id, 'Missing observer context.');
      return;
    }
    setPendingId(task.id);
    setError(task.id, null);
    try {
      assertWritable();
      await addDoc(
        collection(db, COLLECTIONS.observations),
        newDraftObservationDoc({
          observerEmail,
          observerName: observerStaff?.name ?? '',
          staff,
          type: observationTypeForWatchedKind(task.watchedKind),
          questionSetId,
        }),
      );
    } catch (err) {
      setError(task.id, errorMessage(err, 'Could not start the observation.'));
    } finally {
      setPendingId(null);
    }
  }

  // Steps for observation types this viewer never runs are someone else's
  // workflow: a building Administrator doesn't see the Work Product /
  // Instructional Round steps, which belong to peer evaluators.
  const visibleTasks = tasks.filter(
    (t) =>
      t.key === 'module' || creatableTypes.includes(observationTypeForWatchedKind(t.watchedKind)),
  );

  const confirmType = confirming ? observationTypeForWatchedKind(confirming.watchedKind) : null;
  const [chosenBuildingId, setChosenBuildingId] = useState<string | null>(null);
  const questionSet = useQuestionSetResolution(
    confirming ? staff : null,
    confirmType ?? OBSERVATION_TYPES.standard,
    chosenBuildingId,
  );
  const confirmSetId = questionSet && 'setId' in questionSet ? questionSet.setId : null;

  return (
    <>
      <EvaluatorChecklistView
        tasks={visibleTasks}
        pendingId={pendingId}
        errors={errors}
        newObservationsDisabled={newObservationsDisabled}
        canCreateObservations={canCreate}
        creatableTypes={creatableTypes}
        readOnly={isViewingAs}
        onToggle={(task) => void handleToggle(task)}
        onStart={(task) => {
          setChosenBuildingId(null);
          setConfirming(task);
        }}
      />
      {confirming ? (
        <Dialog open onOpenChange={(open) => (open ? null : setConfirming(null))}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Start an observation of {staff.name}?</DialogTitle>
              <DialogDescription>
                This creates a draft {confirmType} observation of <strong>{staff.name}</strong> with
                you as the observer. You can mark “{confirming.title}” complete here once it&apos;s
                done.
              </DialogDescription>
            </DialogHeader>
            {questionSet && 'choose' in questionSet ? (
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Planning and Reflection questions</span>
                <select
                  value={chosenBuildingId ?? ''}
                  onChange={(e) => setChosenBuildingId(e.target.value || null)}
                  className="border-input bg-background h-11 rounded-md border px-3 text-sm"
                >
                  <option value="">Choose a building…</option>
                  {questionSet.choose.map((b) => (
                    <option key={b.buildingId} value={b.buildingId}>
                      {b.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!confirmSetId}
                onClick={() => {
                  if (confirmSetId) void handleStart(confirming, confirmSetId);
                }}
              >
                Start observation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
