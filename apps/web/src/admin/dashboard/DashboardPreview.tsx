import { useMemo } from 'react';
import { limit, orderBy, where } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type AppSettings,
  type DashboardCheckpointsConfig,
  type DashboardQuickMaterial,
  type DashboardSectionsConfig,
  type Observation,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';
import { DashboardView } from '@/dashboard/DashboardView';
import { deriveCheckpoints, extractFirstName } from '@/dashboard/deriveCheckpoints';
import { Eye } from 'lucide-react';

/**
 * Right-column live preview. Renders <DashboardView> with the admin's
 * *draft* sections/checkpoints/quick-materials — so every edit shows up
 * immediately, before the admin clicks Save.
 *
 * Real observation data + staff doc still come from Firestore so the
 * preview reflects the admin's own dashboard state. Read-only (no
 * Acknowledge button, no outbound email links).
 */

function yearTierLabelFor(year: number): string {
  if (year >= 4) return `Probationary Y${String(year - 3)}`;
  return `Year ${String(year)}`;
}

function currentSchoolYearLabel(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 7 ? year : year - 1;
  return `${String(startYear)} — ${String(startYear + 1)}`;
}

export interface DashboardPreviewProps {
  sections: DashboardSectionsConfig;
  checkpoints: DashboardCheckpointsConfig;
  quickMaterials: DashboardQuickMaterial[];
}

export function DashboardPreview({ sections, checkpoints, quickMaterials }: DashboardPreviewProps) {
  const { user } = useAuth();
  const emailLower = user?.email?.toLowerCase() ?? '';

  const staffPath = emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '';
  const { data: staff } = useFirestoreDoc<Staff>(staffPath);
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
  );
  const { observation: wpDraft } = useActiveWorkProductObservation(emailLower);
  const { observation: irDraft } = useActiveInstructionalRoundObservation(emailLower);
  const wpQuestions = useFirestoreCollection(COLLECTIONS.workProductQuestions);
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  const tasks = useMemo(() => {
    if (!staff) return [];
    return deriveCheckpoints(checkpoints, {
      finalizedStandard,
      workProductDraft: wpDraft,
      instructionalRoundDraft: irDraft,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      workProductQuestionsCount: wpQuestions.data?.length ?? 0,
      instructionalRoundQuestionsCount: wpQuestions.data?.length ?? 0,
      appSettings: appSettings ?? null,
      hasWorkProduct,
      hasInstructionalRound,
    });
  }, [
    staff,
    checkpoints,
    finalizedStandard,
    wpDraft,
    irDraft,
    wpQuestions.data,
    appSettings,
    hasWorkProduct,
    hasInstructionalRound,
  ]);

  if (!staff) {
    return (
      <div className="border-border bg-muted/20 flex h-full items-center justify-center rounded-lg border p-8 text-sm">
        Loading preview…
      </div>
    );
  }

  const peSource = wpDraft ?? irDraft ?? finalizedStandard[0] ?? null;
  const peerEvaluator = peSource
    ? {
        name: peSource.observerEmail.split('@')[0] ?? peSource.observerEmail,
        email: peSource.observerEmail,
        role: 'Peer Evaluator',
      }
    : null;

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="bg-ops-blue-lighter/50 border-border flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
        <Eye className="text-ops-blue h-4 w-4" />
        <span className="text-ops-blue-dark">Preview — what staff see</span>
        <span className="text-muted-foreground ml-auto font-normal">
          Live, with your unsaved edits
        </span>
      </div>
      <div className="flex-1 origin-top-left overflow-auto">
        <div style={{ transform: 'scale(0.75)', transformOrigin: 'top left', width: '133.33%' }}>
          <DashboardView
            staff={staff}
            firstName={extractFirstName(staff.name)}
            yearTierLabel={yearTierLabelFor(staff.year)}
            cycleYearLabel={currentSchoolYearLabel()}
            cycleCloseLabel="May 15"
            sections={sections}
            tasks={tasks}
            quickMaterials={quickMaterials}
            peerEvaluator={peerEvaluator}
            readOnly
          />
        </div>
      </div>
    </div>
  );
}
