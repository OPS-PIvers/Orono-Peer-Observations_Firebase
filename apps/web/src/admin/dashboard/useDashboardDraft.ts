import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
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
import {
  describeValidationFailure,
  validateDashboardDraft,
  type DraftValidationError,
} from './dashboardValidation';

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
 * Save runs the shared zod schemas first (see dashboardValidation.ts).
 * A draft that fails is never written; `validationErrors` is populated
 * so the page can jump to the offending tab and the editors can mark
 * the field inline. Errors clear as soon as the draft changes again.
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
  cycleCloseLabel: string;
}

export interface UseDashboardDraftResult {
  draft: DashboardDraft;
  savedSnapshot: DashboardDraft | null;
  setSections: (next: DashboardSectionsConfig) => void;
  setSteps: (next: DashboardStep[]) => void;
  setQuickMaterials: (next: DashboardQuickMaterial[]) => void;
  setCycleCloseLabel: (next: string) => void;
  isDirty: boolean;
  saving: boolean;
  savedAt: Date | null;
  saveError: string | null;
  /** Schema violations from the last refused save. Empty once the draft
   *  changes again or a save succeeds. */
  validationErrors: DraftValidationError[];
  /** Resolves `true` when the write happened, `false` when it was refused
   *  by validation or failed. */
  save: () => Promise<boolean>;
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

function freshDraft(): DashboardDraft {
  return {
    sections: { ...DEFAULT_SECTIONS },
    steps: [],
    quickMaterials: [],
    cycleCloseLabel: 'May 15',
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
  const [validationErrors, setValidationErrors] = useState<DraftValidationError[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const inFlightRef = useRef(false);

  // Hydrate once both docs have responded (either exists or empty).
  useEffect(() => {
    if (hydrated) return;
    if (configLoading || quickLoading) return;
    const next: DashboardDraft = {
      // Merge over defaults so older saved docs (missing newer toggles
      // like `roleChip`) still get a complete sections object.
      sections: { ...DEFAULT_SECTIONS, ...(stripIds(configDoc)?.sections ?? {}) },
      steps: resolveSteps(stripIds(configDoc)),
      quickMaterials: stripIds(quickDoc)?.items ?? [],
      cycleCloseLabel: stripIds(configDoc)?.cycleCloseLabel ?? 'May 15',
    };
    setDraft(next);
    setSavedSnapshot(next);
    setHydrated(true);
  }, [hydrated, configLoading, quickLoading, configDoc, quickDoc]);

  // Any edit re-validates on the next save; stale inline errors would
  // otherwise linger on a field the admin has already fixed.
  const setSections = useCallback((next: DashboardSectionsConfig) => {
    setValidationErrors([]);
    setDraft((d) => ({ ...d, sections: next }));
  }, []);
  const setSteps = useCallback((next: DashboardStep[]) => {
    setValidationErrors([]);
    setDraft((d) => ({ ...d, steps: next }));
  }, []);
  const setQuickMaterials = useCallback((next: DashboardQuickMaterial[]) => {
    setValidationErrors([]);
    setDraft((d) => ({ ...d, quickMaterials: next }));
  }, []);
  const setCycleCloseLabel = useCallback((next: string) => {
    setValidationErrors([]);
    setDraft((d) => ({ ...d, cycleCloseLabel: next }));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false;
    const errors = validateDashboardDraft(draft);
    if (errors.length > 0) {
      setValidationErrors(errors);
      setSaveError(describeValidationFailure(errors));
      return false;
    }
    inFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    setValidationErrors([]);
    try {
      await Promise.all([
        setDoc(
          doc(db, CONFIG_PATH),
          {
            sections: draft.sections,
            steps: draft.steps,
            cycleCloseLabel: draft.cycleCloseLabel,
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
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      return false;
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  }, [draft, user?.email]);

  const reset = useCallback(() => {
    setValidationErrors([]);
    setSaveError(null);
    if (savedSnapshot) setDraft(savedSnapshot);
  }, [savedSnapshot]);

  const isDirty = useMemo(() => !snapshotsEqual(draft, savedSnapshot), [draft, savedSnapshot]);

  return {
    draft,
    savedSnapshot,
    setSections,
    setSteps,
    setQuickMaterials,
    setCycleCloseLabel,
    isDirty,
    saving,
    savedAt,
    saveError,
    validationErrors,
    save,
    reset,
    loading: !hydrated,
  };
}
