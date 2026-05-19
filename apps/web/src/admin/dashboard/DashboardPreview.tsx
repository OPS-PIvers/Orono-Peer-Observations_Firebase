import { useEffect, useMemo, useRef, useState } from 'react';
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
  type ModuleDoc,
  type Observation,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';
import { DashboardView, type ModuleChip } from '@/dashboard/DashboardView';
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

  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: modulesData } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules);

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

  const roleDisplayName = useMemo(() => {
    if (!staff || !roles) return '';
    return roles.find((r) => r.roleId === staff.role)?.displayName ?? staff.role;
  }, [staff, roles]);

  const moduleChips = useMemo<ModuleChip[]>(() => {
    if (!staff || !modulesData) return [];
    return staff.modules
      .map((id) => modulesData.find((m) => m.moduleId === id))
      .filter((m): m is ModuleDoc & { id: string } => m != null)
      .map((m) => ({ moduleId: m.moduleId, displayName: m.displayName, color: m.color }));
  }, [staff, modulesData]);

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
    <PreviewFrame>
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
        roleDisplayName={roleDisplayName}
        buildingNames={staff.buildings}
        moduleChips={moduleChips}
      />
    </PreviewFrame>
  );
}

/**
 * Chrome around the live preview: header banner + zoomable viewport.
 *
 * The inner dashboard is locked to its natural 1240px design width so the
 * staff layout doesn't trigger its single-column responsive media query
 * inside this small column. CSS `zoom` (rather than `transform: scale`)
 * shrinks both the visual and the box, so the wrapping container reports
 * the correct height to the scroll container and no horizontal ghost
 * area lingers.
 *
 * Scale is computed from the wrapper's actual rendered width via
 * ResizeObserver so the preview tracks the column as the viewport resizes.
 */
const NATURAL_WIDTH = 1240;

function PreviewFrame({ children }: { children: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const target = wrapperRef.current;
    const applyWidth = (w: number) => {
      if (w <= 0) return;
      // Cap at 1 so we never enlarge on extra-wide monitors.
      setScale(Math.max(0.3, Math.min(1, w / NATURAL_WIDTH)));
    };
    // Sync initial measurement — ResizeObserver's first fire is async and
    // can lose to React Strict Mode's double-mount in dev, leaving us
    // stuck on the useState default.
    applyWidth(target.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyWidth(entry.contentRect.width);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="border-border bg-background flex h-full flex-col overflow-hidden rounded-lg border">
      <div className="bg-ops-blue-lighter/50 border-border flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold">
        <Eye className="text-ops-blue h-4 w-4" />
        <span className="text-ops-blue-dark">Preview — what staff see</span>
        <span className="text-muted-foreground ml-auto font-normal">
          Live, with your unsaved edits
        </span>
      </div>
      <div ref={wrapperRef} className="flex-1 overflow-x-hidden overflow-y-auto">
        <div style={{ zoom: scale, width: `${String(NATURAL_WIDTH)}px` }}>{children}</div>
      </div>
    </div>
  );
}
