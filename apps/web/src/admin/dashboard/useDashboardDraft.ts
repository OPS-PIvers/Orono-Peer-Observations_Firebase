import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  DEFAULT_CYCLE_CLOSE_MONTH_DAY,
  dashboardQuickMaterial,
  dashboardStep,
  type CycleCloseMonthDay,
  type DashboardConfig,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
  type DashboardStep,
  resolveSteps,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db } from '@/lib/firebase';

/**
 * Manages the local draft of the dashboard config + quick materials.
 *
 * The page binds form inputs to the draft. The Save action writes both
 * Firestore docs in a single setDoc batch. `isDirty` is true exactly when
 * the local draft diverges from the last-known saved snapshot, driving
 * the Save button's enabled state and the unsaved-changes pill.
 *
 * Initial hydration happens once per doc landing (via a ref guard) so
 * later snapshots don't clobber in-progress edits. Mirrors the
 * `useHydratedDraft` idiom but local to this hook.
 *
 * Validation: Before saving, steps and quickMaterials are validated against
 * their schemas. Step and quick material validation errors are tracked
 * per-item and exposed via stepErrors, quickMaterialErrors. The save is
 * blocked if any errors exist. Errors are surfaced in the editor UI.
 */

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

export interface DashboardDraft {
  sections: DashboardSectionsConfig;
  steps: DashboardStep[];
  quickMaterials: DashboardQuickMaterial[];
  /** MM-DD month-day for the cycle close date shown in the hero stat bar. */
  cycleCloseDate: CycleCloseMonthDay;
}

/** Validation error for a single step or quick material item. */
export interface ValidationError {
  /** Zero-indexed item position. */
  itemIndex: number;
  /** Human-readable message, e.g. "Label is required". */
  message: string;
}

export interface UseDashboardDraftResult {
  draft: DashboardDraft;
  savedSnapshot: DashboardDraft | null;
  setSections: (next: DashboardSectionsConfig) => void;
  setSteps: (next: DashboardStep[]) => void;
  setQuickMaterials: (next: DashboardQuickMaterial[]) => void;
  setCycleCloseDate: (next: CycleCloseMonthDay) => void;
  isDirty: boolean;
  saving: boolean;
  savedAt: Date | null;
  saveError: string | null;
  /** Per-item validation errors for steps. */
  stepErrors: ValidationError[];
  /** Per-item validation errors for quick materials. */
  quickMaterialErrors: ValidationError[];
  /** True if there are any validation errors blocking save. */
  hasValidationErrors: boolean;
  save: () => Promise<void>;
  /** Discards local edits, snaps draft back to the last saved state. */
  reset: () => void;
  loading: boolean;
}

const CONFIG_PATH = `${COLLECTIONS.appSettings}/${DASHBOARD_CONFIG_DOC_ID}`;
const QUICK_PATH = `${COLLECTIONS.dashboardQuickMaterials}/${DASHBOARD_QUICK_MATERIALS_DOC_ID}`;

function stripIds<T extends { id?: string } | null>(d: T): T {
  if (!d) return d;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, ...rest } = d as { id?: string } & Record<string, unknown>;
  return rest as T;
}

/** Validate steps and return per-item error messages. */
function validateSteps(steps: DashboardStep[]): ValidationError[] {
  const errors: ValidationError[] = [];
  steps.forEach((step, idx) => {
    const result = dashboardStep.safeParse(step);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join('; ');
      errors.push({
        itemIndex: idx,
        message: messages,
      });
    }
  });
  return errors;
}

/** Validate quick materials and return per-item error messages. */
function validateQuickMaterials(items: DashboardQuickMaterial[]): ValidationError[] {
  const errors: ValidationError[] = [];
  items.forEach((item, idx) => {
    const result = dashboardQuickMaterial.safeParse(item);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join('; ');
      errors.push({
        itemIndex: idx,
        message: messages,
      });
    }
  });
  return errors;
}

function freshDraft(): DashboardDraft {
  return {
    sections: { ...DEFAULT_SECTIONS },
    steps: [],
    quickMaterials: [],
    cycleCloseDate: DEFAULT_CYCLE_CLOSE_MONTH_DAY,
  };
}

function snapshotsEqual(a: DashboardDraft, b: DashboardDraft | null): boolean {
  if (!b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useDashboardDraft(): UseDashboardDraftResult {
  const { user } = useAuth();
  const { data: configDoc, loading: configLoading } = useFirestoreDoc<DashboardConfig>(CONFIG_PATH);
  const { data: quickDoc, loading: quickLoading } =
    useFirestoreDoc<DashboardQuickMaterialsDoc>(QUICK_PATH);

  const [draft, setDraft] = useState<DashboardDraft>(freshDraft);
  const [savedSnapshot, setSavedSnapshot] = useState<DashboardDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [stepErrors, setStepErrors] = useState<ValidationError[]>([]);
  const [quickMaterialErrors, setQuickMaterialErrors] = useState<ValidationError[]>([]);

  const inFlightRef = useRef(false);

  // Hydrate once both docs have responded (either exists or empty).
  useEffect(() => {
    if (hydrated) return;
    if (configLoading || quickLoading) return;
    const cfg = stripIds(configDoc);
    const next: DashboardDraft = {
      // Merge over defaults so older saved docs (missing newer toggles
      // like `roleChip`) still get a complete sections object.
      sections: { ...DEFAULT_SECTIONS, ...(cfg?.sections ?? {}) },
      steps: resolveSteps(cfg),
      quickMaterials: stripIds(quickDoc)?.items ?? [],
      // Fall back to the built-in default for older docs that pre-date this field.
      cycleCloseDate: cfg?.cycleCloseDate ?? DEFAULT_CYCLE_CLOSE_MONTH_DAY,
    };
    setDraft(next);
    setSavedSnapshot(next);
    setHydrated(true);
  }, [hydrated, configLoading, quickLoading, configDoc, quickDoc]);

  const setSections = useCallback((next: DashboardSectionsConfig) => {
    setDraft((d) => ({ ...d, sections: next }));
  }, []);
  const setSteps = useCallback((next: DashboardStep[]) => {
    setDraft((d) => ({ ...d, steps: next }));
  }, []);
  const setQuickMaterials = useCallback((next: DashboardQuickMaterial[]) => {
    setDraft((d) => ({ ...d, quickMaterials: next }));
  }, []);
  const setCycleCloseDate = useCallback((next: CycleCloseMonthDay) => {
    setDraft((d) => ({ ...d, cycleCloseDate: next }));
  }, []);

  const save = useCallback(async () => {
    if (inFlightRef.current) return;

    // Validate before attempting to save
    const stepsValidationErrors = validateSteps(draft.steps);
    const quickMatValidationErrors = validateQuickMaterials(draft.quickMaterials);

    setStepErrors(stepsValidationErrors);
    setQuickMaterialErrors(quickMatValidationErrors);

    if (stepsValidationErrors.length > 0 || quickMatValidationErrors.length > 0) {
      setSaveError('Please fix validation errors before saving');
      return;
    }

    inFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        setDoc(
          doc(db, CONFIG_PATH),
          {
            sections: draft.sections,
            steps: draft.steps,
            cycleCloseDate: draft.cycleCloseDate,
            updatedAt: serverTimestamp(),
            ...(user?.email ? { updatedBy: user.email } : {}),
          },
          { merge: true },
        ),
        setDoc(
          doc(db, QUICK_PATH),
          {
            items: draft.quickMaterials,
            updatedAt: serverTimestamp(),
            ...(user?.email ? { updatedBy: user.email } : {}),
          },
          { merge: true },
        ),
      ]);
      setSavedSnapshot(draft);
      setSavedAt(new Date());
      setStepErrors([]);
      setQuickMaterialErrors([]);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  }, [draft, user?.email]);

  const reset = useCallback(() => {
    if (savedSnapshot) setDraft(savedSnapshot);
  }, [savedSnapshot]);

  const isDirty = useMemo(() => !snapshotsEqual(draft, savedSnapshot), [draft, savedSnapshot]);
  const hasValidationErrors = useMemo(
    () => stepErrors.length > 0 || quickMaterialErrors.length > 0,
    [stepErrors, quickMaterialErrors],
  );

  return {
    draft,
    savedSnapshot,
    setSections,
    setSteps,
    setQuickMaterials,
    setCycleCloseDate,
    isDirty,
    saving,
    savedAt,
    saveError,
    stepErrors,
    quickMaterialErrors,
    hasValidationErrors,
    save,
    reset,
    loading: !hydrated,
  };
}
