import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteDoc,
  doc,
  limit,
  orderBy,
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
  DEFAULT_CYCLE_CLOSE_MONTH_DAY,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  STAFF_SUBCOLLECTIONS,
  resolveSteps,
  schoolYearStart,
  staffHasModule,
  type AppSettings,
  type DashboardConfig,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
  type ModuleDoc,
  type ModuleProgress,
  type Observation,
  type ObservationWindow,
  type Role,
  type Staff,
  type WorkProductQuestion,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useActiveObservationTypes } from '@/observations/ActiveObservationTypesContext';
import { db } from '@/lib/firebase';
import { Skeleton } from '@/components/Skeleton';
import { DashboardView, type ModuleChip } from './DashboardView';
import {
  type CheckpointWithStatus,
  deriveCheckpoints,
  extractFirstName,
} from './deriveCheckpoints';
import { deriveModuleTasks } from './deriveModuleTasks';
import { fetchModuleMaterials } from './moduleMaterials';

// Mirrors the staff answer forms (WorkProductAnswerForm / InstructionalRoundAnswerForm),
// which only show active questions — the progress denominator must match.
const ACTIVE_QUESTION_CONSTRAINTS = [where('isActive', '==', true)];

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
  const startYear = schoolYearStart(now).getFullYear();
  return `${String(startYear)} — ${String(startYear + 1)}`;
}

/**
 * Format a stored MM-DD value (e.g. '05-15') into a short human label
 * ('May 15') for display in the hero stat bar. Falls back to 'May 15' if
 * the value is missing or unparseable.
 */
function formatCycleCloseLabel(monthDay: string | undefined): string {
  const value = monthDay ?? DEFAULT_CYCLE_CLOSE_MONTH_DAY;
  // Anchor to a fixed leap-year so Feb 29 is valid if ever configured.
  const dt = new Date(`2000-${value}T00:00:00`);
  if (isNaN(dt.getTime())) return 'May 15';
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
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
  // Only include modules that are active (isActive=true); inactive/draft modules
  // must not surface their materials on the staff dashboard.
  const assignedModuleIds = useMemo(() => {
    if (!staff) return [];
    const activeModules = new Map<string, ModuleDoc>();
    for (const m of modulesData ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
      if (m.isActive ?? true) activeModules.set(m.moduleId, m);
    }
    const ids = new Set<string>();
    for (const m of activeModules.values()) {
      if (staffHasModule(staff, m)) ids.add(m.moduleId);
    }
    return [...ids].slice(0, 30);
  }, [staff, modulesData]);

  // Module materials are a one-shot read (collection-group getDocs), shared
  // and cached via TanStack Query keyed on the assigned module ids — no
  // manual effect + local state, and no live listener for what is
  // effectively static reference content.
  const { data: moduleMaterials } = useQuery({
    queryKey: ['dashboard-module-materials', assignedModuleIds],
    queryFn: () => fetchModuleMaterials(assignedModuleIds),
  });

  // Scope finalized observations to the current school-year cycle (Aug 1
  // boundary, matching the hero's "2025 — 2026" label) — a prior year's
  // finalized observation must not mark this year's checkpoints done.
  const cycleStart = useMemo(() => schoolYearStart(), []);
  const finalizedConstraints = useMemo(
    () =>
      emailLower
        ? [
            where('observedEmail', '==', emailLower),
            where('status', '==', OBSERVATION_STATUS.finalized),
            where('finalizedAt', '>=', cycleStart),
            orderBy('finalizedAt', 'desc'),
            limit(10),
          ]
        : [],
    [emailLower, cycleStart],
  );
  const { data: finalizedObs, error: finalizedObsError } = useFirestoreCollection<Observation>(
    emailLower ? COLLECTIONS.observations : '',
    finalizedConstraints,
    [emailLower, cycleStart.getTime()],
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
  const { data: myWindows, error: myWindowsError } = useFirestoreCollection<ObservationWindow>(
    emailLower ? COLLECTIONS.observationWindows : '',
    windowConstraints,
    [emailLower],
  );
  const openBooking = useMemo(() => {
    for (const w of myWindows ?? []) {
      const inv = w.invitees.find((i) => i.email.toLowerCase() === emailLower);
      if (inv && !inv.bookedSlotId) return { windowId: w.windowId, token: inv.inviteToken };
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

  // Active-observation drafts come from the shared context (mounted by
  // Layout) so the dashboard doesn't re-open the same snapshot listeners.
  const {
    standard: standardDraft,
    workProduct: wpDraft,
    instructionalRound: irDraft,
    hasWorkProduct,
    hasInstructionalRound,
  } = useActiveObservationTypes();
  const { data: activeQuestions } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    ACTIVE_QUESTION_CONSTRAINTS,
  );

  // Partition the active question bank by type so each step's "X of N answered"
  // denominator matches the question set the staff member actually sees in the
  // corresponding form. Firestore reads bypass Zod defaults, so legacy docs
  // missing `type` count as work-product (the schema default).
  const questionCounts = useMemo(() => {
    let workProduct = 0;
    let instructionalRound = 0;
    for (const q of activeQuestions ?? []) {
      if (q.type === 'instructional-round') instructionalRound += 1;
      else workProduct += 1;
    }
    return { workProduct, instructionalRound };
  }, [activeQuestions]);

  const finalizedStandard = useMemo(
    () => (finalizedObs ?? []).filter((o) => o.type === OBSERVATION_TYPES.standard),
    [finalizedObs],
  );

  const finalizedWorkProduct = useMemo(
    () => (finalizedObs ?? []).find((o) => o.type === OBSERVATION_TYPES.workProduct) ?? null,
    [finalizedObs],
  );

  const finalizedInstructionalRound = useMemo(
    () => (finalizedObs ?? []).find((o) => o.type === OBSERVATION_TYPES.instructionalRound) ?? null,
    [finalizedObs],
  );

  const tasks = useMemo<CheckpointWithStatus[]>(() => {
    if (!staff) return [];
    return deriveCheckpoints(resolveSteps(config), {
      finalizedStandard: finalizedStandard,
      standardDraft,
      workProductDraft: wpDraft,
      instructionalRoundDraft: irDraft,
      finalizedWorkProduct,
      finalizedInstructionalRound,
      workProductQuestionsCount: questionCounts.workProduct,
      instructionalRoundQuestionsCount: questionCounts.instructionalRound,
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
    finalizedWorkProduct,
    finalizedInstructionalRound,
    questionCounts,
    appSettings,
    openBooking,
    hasBookedSlot,
    hasWorkProduct,
    hasInstructionalRound,
  ]);

  const moduleTasks = useMemo(() => {
    // Defense in depth: filter materials to only include items whose owning
    // module is active and whose sectionId still exists on that module. This
    // prevents displaying items from inactive/draft modules or deleted sections
    // as ghost tasks.
    const validMaterials = (moduleMaterials ?? []).filter((item) => {
      const module = modulesData?.find((m) => m.moduleId === item.moduleId);
      if (!module) return false;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
      if (!(module.isActive ?? true)) return false;
      return module.sections.some((s) => s.id === item.sectionId);
    });
    return deriveModuleTasks({ materials: validMaterials, progress: moduleProgress ?? [] });
  }, [moduleMaterials, moduleProgress, modulesData]);

  const allTasks = useMemo(() => [...tasks, ...moduleTasks], [tasks, moduleTasks]);

  // If any critical listener fails, collect the error to display an alert.
  // finalizedObs and myWindows are critical — both feed into checkpoint derivation.
  const loadError = useMemo(() => {
    return finalizedObsError ?? myWindowsError ?? null;
  }, [finalizedObsError, myWindowsError]);

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
    onError: (err: unknown) => {
      toast.error('Failed to acknowledge observation', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const ref = doc(
        db,
        COLLECTIONS.staff,
        emailLower,
        STAFF_SUBCOLLECTIONS.moduleProgress,
        itemId,
      );
      await deleteDoc(ref);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (q) => {
          if (!Array.isArray(q.queryKey)) return false;
          const first: unknown = q.queryKey[0];
          return typeof first === 'string' && first.includes(STAFF_SUBCOLLECTIONS.moduleProgress);
        },
      });
    },
    onError: (err: unknown) => {
      toast.error('Failed to undo item completion', {
        description: err instanceof Error ? err.message : 'Please try again.',
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
          (m.isActive ?? true) && staffHasModule(staff, m),
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
    const adminEmail = appSettings?.securityAdminEmail;
    const mailtoHref = adminEmail
      ? `mailto:${adminEmail}?subject=Account%20provisioning%20request&body=Please%20provision%20my%20account%3A%20${encodeURIComponent(user?.email ?? '')}`
      : null;
    return (
      <div className="staff-dashboard">
        <div className="page">
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-ops-gray font-medium">
              No staff record found for your account ({user?.email ?? ''}).
            </p>
            <p className="text-ops-gray max-w-sm text-sm">
              Your account exists but hasn&apos;t been provisioned yet. Contact your site
              administrator to request access.
            </p>
            {mailtoHref ? (
              <a
                href={mailtoHref}
                className="bg-ops-blue hover:bg-ops-blue-dark inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
              >
                <Mail className="h-4 w-4" />
                Request access
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const peSource = standardDraft ?? wpDraft ?? irDraft ?? finalizedStandard[0] ?? null;
  const peerEvaluator: { name: string; email: string; role: string } | null = peSource
    ? {
        // observerName is denormalized at creation time. Fall back to the
        // email localpart for observations created before the field was added.
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
      cycleCloseLabel={formatCycleCloseLabel(config?.cycleCloseDate)}
      sections={{ ...DEFAULT_SECTIONS, ...config?.sections }}
      tasks={allTasks}
      quickMaterials={quick?.items ?? []}
      peerEvaluator={peerEvaluator}
      loadError={loadError}
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
        }).catch((err: unknown) => {
          toast.error('Failed to mark item complete', {
            description: err instanceof Error ? err.message : 'Please try again.',
          });
        });
      }}
      onUndoModuleItem={(_, itemId) => {
        undoMutation.mutate(itemId);
      }}
      roleDisplayName={roleDisplayName}
      buildingNames={staff.buildings}
      moduleChips={moduleChips}
    />
  );
}

export type { CheckpointWithStatus };
