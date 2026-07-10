import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  collectionGroup,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  STAFF_SUBCOLLECTIONS,
  resolveSteps,
  staffMatchesAutoEnable,
  type AppSettings,
  type DashboardConfig,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
  type ModuleDoc,
  type ModuleItem,
  type ModuleProgress,
  type Observation,
  type ObservationWindow,
  type Role,
  type Staff,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { useActiveStandardObservation } from '@/hooks/useActiveStandardObservation';
import { useActiveWorkProductObservation } from '@/hooks/useActiveWorkProductObservation';
import { useActiveInstructionalRoundObservation } from '@/hooks/useActiveInstructionalRoundObservation';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/Skeleton';
import { DashboardView, type ModuleChip } from './DashboardView';
import {
  type CheckpointWithStatus,
  deriveCheckpoints,
  extractFirstName,
} from './deriveCheckpoints';
import { deriveModuleTasks } from './deriveModuleTasks';

const DEFAULT_SECTIONS: DashboardSectionsConfig = {
  hero: true,
  roleChip: true,
  progressSummary: true,
  statBar: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

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

export function StaffDashboardPage() {
  const { user } = useAuth();
  const emailLower = user?.email?.toLowerCase() ?? '';
  const queryClient = useQueryClient();

  const staffPath = emailLower ? `${COLLECTIONS.staff}/${emailLower}` : '';
  const { data: staff, loading: staffLoading } = useFirestoreDoc<Staff>(staffPath);

  const configPath = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
  const { data: config } = useFirestoreDoc<DashboardConfig>(configPath);

  const quickPath = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;
  const { data: quick } = useFirestoreDoc<DashboardQuickMaterialsDoc>(quickPath);

  const settingsPath = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;
  const { data: appSettings } = useFirestoreDoc<AppSettings>(settingsPath);

  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: modulesData } = useFirestoreCollection<ModuleDoc>(COLLECTIONS.modules);

  const { data: moduleProgress } = useFirestoreCollection<ModuleProgress>(
    emailLower ? `${COLLECTIONS.staff}/${emailLower}/${STAFF_SUBCOLLECTIONS.moduleProgress}` : '',
  );

  // Assigned module IDs (max 30 for the `in` query — staff never have that many).
  const assignedModuleIds = useMemo(() => {
    if (!staff) return [];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
    const ids = new Set(staff.modules ?? []);
    for (const m of modulesData ?? []) {
      if (staffMatchesAutoEnable(staff, m.autoEnable ?? null)) ids.add(m.moduleId);
    }
    return [...ids].slice(0, 30);
  }, [staff, modulesData]);

  const materialsConstraints = useMemo(
    () =>
      assignedModuleIds.length > 0
        ? [where('kind', '==', 'material'), where('moduleId', 'in', assignedModuleIds)]
        : null,
    [assignedModuleIds],
  );

  const [moduleMaterials, setModuleMaterials] = useState<ModuleItem[]>([]);
  useEffect(() => {
    if (!materialsConstraints) {
      setModuleMaterials([]);
      return;
    }
    let cancelled = false;
    void getDocs(query(collectionGroup(db, 'items'), ...materialsConstraints)).then((snap) => {
      if (cancelled) return;
      setModuleMaterials(snap.docs.map((d) => d.data() as ModuleItem));
    });
    return () => {
      cancelled = true;
    };
  }, [materialsConstraints]);

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
            where('status', 'in', ['open', 'partially-booked']),
          ]
        : [],
    [emailLower],
  );
  const { data: myWindows } = useFirestoreCollection<ObservationWindow>(
    emailLower ? COLLECTIONS.observationWindows : '',
    windowConstraints,
    [emailLower],
  );
  const openBooking = useMemo(() => {
    for (const w of myWindows ?? []) {
      const inv = w.invitees.find((i) => i.email.toLowerCase() === emailLower);
      if (inv && !inv.bookedSlotId) {
        return {
          windowId: w.windowId,
          token: inv.inviteToken,
          endDate: w.endDate ? new Date(`${w.endDate}T12:00:00`) : null,
        };
      }
    }
    return null;
  }, [myWindows, emailLower]);

  const hasBookedSlot = useMemo(() => {
    for (const w of myWindows ?? []) {
      const inv = w.invitees.find((i) => i.email.toLowerCase() === emailLower);
      if (inv?.bookedSlotId) return true;
    }
    return false;
  }, [myWindows, emailLower]);

  const { observation: standardDraft } = useActiveStandardObservation(emailLower);
  const { observation: wpDraft } = useActiveWorkProductObservation(emailLower);
  const { observation: irDraft } = useActiveInstructionalRoundObservation(emailLower);
  const wpQuestions = useFirestoreCollection(COLLECTIONS.workProductQuestions);
  const { hasWorkProduct, hasInstructionalRound } = useActiveObservationTypes();

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  const peSource = standardDraft ?? wpDraft ?? irDraft ?? finalizedStandard[0] ?? null;

  const tasks = useMemo<CheckpointWithStatus[]>(() => {
    if (!staff) return [];
    return deriveCheckpoints(resolveSteps(config), {
      finalizedStandard: finalizedStandard,
      standardDraft,
      workProductDraft: wpDraft,
      instructionalRoundDraft: irDraft,
      finalizedWorkProduct: null,
      finalizedInstructionalRound: null,
      workProductQuestionsCount: wpQuestions.data?.length ?? 0,
      instructionalRoundQuestionsCount: wpQuestions.data?.length ?? 0,
      appSettings: appSettings ?? null,
      openBooking,
      hasBookedSlot,
      hasWorkProduct,
      hasInstructionalRound,
    });
  }, [
    staff,
    config,
    finalizedStandard,
    standardDraft,
    wpDraft,
    irDraft,
    wpQuestions.data,
    appSettings,
    openBooking,
    hasBookedSlot,
    hasWorkProduct,
    hasInstructionalRound,
  ]);

  const moduleTasks = useMemo(() => {
    const done = new Set((moduleProgress ?? []).map((p) => p.itemId));
    return deriveModuleTasks({ materials: moduleMaterials, doneItemIds: done });
  }, [moduleMaterials, moduleProgress]);

  const allTasks = useMemo(() => [...tasks, ...moduleTasks], [tasks, moduleTasks]);

  const ackMutation = useMutation({
    mutationFn: async (observationId: string) => {
      await updateDoc(doc(db, COLLECTIONS.observations, observationId), {
        acknowledgedAt: serverTimestamp(),
        acknowledgedBy: emailLower,
        lastModifiedAt: serverTimestamp(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (q) => {
          if (!Array.isArray(q.queryKey)) return false;
          const second: unknown = q.queryKey[1];
          return typeof second === 'string' && second.includes(COLLECTIONS.observations);
        },
      });
    },
  });

  const roleDisplayName = useMemo(() => {
    if (!staff || !roles) return '';
    return roles.find((r) => r.roleId === staff.role)?.displayName ?? staff.role;
  }, [staff, roles]);

  const moduleChips = useMemo<ModuleChip[]>(() => {
    if (!staff || !modulesData) return [];
    return modulesData
      .filter(
        (m) =>
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
          (staff.modules ?? []).includes(m.moduleId) ||
          staffMatchesAutoEnable(staff, m.autoEnable ?? null),
      )
      .map((m) => ({ moduleId: m.moduleId, displayName: m.displayName, color: m.color }));
  }, [staff, modulesData]);

  if (staffLoading && !staff) {
    return (
      <div className="staff-dashboard">
        <div className="page">
          <Skeleton className="mb-6 h-[260px] w-full rounded-2xl" />
          <Skeleton className="mb-3 h-9 w-[420px]" />
          <Skeleton className="h-[160px] w-full" />
        </div>
      </div>
    );
  }

  if (!user || !staff) {
    return (
      <div className="staff-dashboard">
        <div className="page">
          <p className="empty-note">No staff record found for your account.</p>
        </div>
      </div>
    );
  }

  // The observer's display name is denormalized onto the observation doc
  // (observerName) — staff can't read other people's /staff docs, by design.
  // Legacy observations predate the field, so fall back to the email prefix.
  const peerEvaluator: { name: string; email: string; role: string } | null = peSource
    ? {
        name:
          peSource.observerName || (peSource.observerEmail.split('@')[0] ?? peSource.observerEmail),
        email: peSource.observerEmail,
        role: 'Peer Evaluator',
      }
    : null;

  return (
    <DashboardView
      staff={staff}
      firstName={extractFirstName(staff.name)}
      yearTierLabel={yearTierLabelFor(staff.year)}
      cycleYearLabel={currentSchoolYearLabel()}
      cycleCloseLabel={config?.cycleCloseLabel ?? 'May 15'}
      sections={{ ...DEFAULT_SECTIONS, ...config?.sections }}
      tasks={allTasks}
      quickMaterials={quick?.items ?? []}
      peerEvaluator={peerEvaluator}
      onAcknowledge={(id) => ackMutation.mutate(id)}
      acknowledging={ackMutation.isPending}
      onCompleteModuleItem={(moduleId, itemId) => {
        const ref = doc(
          db,
          COLLECTIONS.staff,
          emailLower,
          STAFF_SUBCOLLECTIONS.moduleProgress,
          itemId,
        );
        void setDoc(ref, {
          itemId,
          moduleId,
          status: 'done',
          completedAt: serverTimestamp(),
        });
      }}
      roleDisplayName={roleDisplayName}
      buildingNames={staff.buildings}
      moduleChips={moduleChips}
    />
  );
}

export type { CheckpointWithStatus };
