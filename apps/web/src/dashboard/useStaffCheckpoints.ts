import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  questionPhase,
  questionType,
  resolveSteps,
  type AppSettings,
  type DashboardConfig,
  type Observation,
  type ObservationWindow,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useActiveStandardObservation } from '@/hooks/useActiveStandardObservation';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';
import {
  type ActiveQuestion,
  type CheckpointWithStatus,
  type DeriveOptions,
  deriveCheckpoints,
} from './deriveCheckpoints';
import { useStepChecks } from './useStepChecks';
import { DASHBOARD_WINDOW_STATUSES, summarizeWindowBookings } from './windowBooking';

export interface StaffCheckpointsResult {
  /** The dashboard config doc (sections, cycle-close label, steps). */
  config: DashboardConfig | null;
  /** Step checkpoints — module-material tasks are not included. */
  tasks: CheckpointWithStatus[];
  /** The observation whose observer is shown as the peer evaluator. */
  peSource: Observation | null;
}

/**
 * Everything the dashboard step interpreter needs for one staff member,
 * loaded live and derived into checkpoints. Shared by the staff dashboard
 * (the signed-in teacher) and the evaluator checklist on StaffPersonPage (a
 * special-access user viewing someone else), so every read here must be
 * permitted for both: the teacher's own observations / invited windows /
 * step checks, and the same paths via `hasSpecialAccess()` in
 * firestore.rules. Module materials are deliberately not loaded — their
 * `moduleProgress` is owner/admin-only.
 */
export function useStaffCheckpoints(
  email: string,
  options: DeriveOptions = {},
): StaffCheckpointsResult {
  const emailLower = email.toLowerCase();

  const configPath = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
  const { data: config } = useFirestoreDoc<DashboardConfig>(configPath);

  const settingsPath = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
  const { data: appSettings } = useFirestoreDoc<AppSettings>(settingsPath);

  const finalizedConstraints = useMemo(
    () =>
      emailLower
        ? [
            where('observedEmail', '==', emailLower),
            where('status', '==', OBSERVATION_STATUS.finalized),
            orderBy('finalizedAt', 'desc'),
            limit(10),
          ]
        : [],
    [emailLower],
  );
  const { data: finalizedObs } = useFirestoreCollection<Observation>(
    emailLower ? COLLECTIONS.observations : '',
    finalizedConstraints,
    [emailLower],
  );

  const windowConstraints = useMemo(
    () =>
      emailLower
        ? [
            where('invitedEmails', 'array-contains', emailLower),
            where('status', 'in', [...DASHBOARD_WINDOW_STATUSES]),
          ]
        : [],
    [emailLower],
  );
  const { data: myWindows } = useFirestoreCollection<ObservationWindow>(
    emailLower ? COLLECTIONS.observationWindows : '',
    windowConstraints,
    // The status list is part of the key: the pre-fix query (open +
    // partially-booked) must not share a cached snapshot with this one.
    [emailLower, DASHBOARD_WINDOW_STATUSES.join(',')],
  );
  const { openBooking, hasBookedSlot } = useMemo(
    () => summarizeWindowBookings(myWindows ?? [], emailLower),
    [myWindows, emailLower],
  );

  const { observation: standardDraft } = useActiveStandardObservation(emailLower);
  const { observation: wpDraft } = useActiveWorkProductObservation(emailLower);
  const { observation: irDraft } = useActiveInstructionalRoundObservation(emailLower);
  const wpQuestions = useFirestoreCollection<WorkProductQuestion>(COLLECTIONS.workProductQuestions);

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  // Only active questions count; `responseProgress` narrows them to the
  // watched observation's type and the step's panel (Planning / Reflection).
  const activeQuestions = useMemo<ActiveQuestion[]>(
    () =>
      (wpQuestions.data ?? [])
        .filter((q) => q.isActive)
        .map((q) => ({ questionId: q.questionId, type: questionType(q), phase: questionPhase(q) })),
    [wpQuestions.data],
  );

  // Every observation `resolveObservation` can return for this context —
  // the step checks for each are loaded so any watched kind finds its own.
  const candidateObservationIds = useMemo(
    () =>
      [standardDraft, wpDraft, irDraft, finalizedStandard[0]]
        .map((o) => (o as (Observation & { id?: string }) | null | undefined)?.id ?? '')
        .filter(Boolean),
    [standardDraft, wpDraft, irDraft, finalizedStandard],
  );
  const stepChecks = useStepChecks(emailLower, candidateObservationIds);

  const includeHidden = options.includeHidden ?? false;
  const tasks = useMemo<CheckpointWithStatus[]>(
    () =>
      deriveCheckpoints(
        resolveSteps(config),
        {
          finalizedStandard,
          standardDraft,
          workProductDraft: wpDraft,
          instructionalRoundDraft: irDraft,
          finalizedWorkProduct: null,
          finalizedInstructionalRound: null,
          questions: activeQuestions,
          appSettings: appSettings ?? null,
          openBooking,
          hasBookedSlot,
          // Same signal ActiveObservationTypesProvider derives, computed for
          // `email` rather than the signed-in user.
          hasWorkProduct: wpDraft != null,
          hasInstructionalRound: irDraft != null,
          stepChecks,
        },
        new Date(),
        { includeHidden },
      ),
    [
      config,
      finalizedStandard,
      standardDraft,
      wpDraft,
      irDraft,
      activeQuestions,
      appSettings,
      openBooking,
      hasBookedSlot,
      stepChecks,
      includeHidden,
    ],
  );

  const peSource = standardDraft ?? wpDraft ?? irDraft ?? finalizedStandard[0] ?? null;

  return { config: config ?? null, tasks, peSource };
}
