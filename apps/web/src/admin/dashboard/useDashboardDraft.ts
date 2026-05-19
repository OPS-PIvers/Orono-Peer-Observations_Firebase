import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  DASHBOARD_CONFIG_DOC_ID,
  DASHBOARD_QUICK_MATERIALS_DOC_ID,
  type DashboardCheckpointsConfig,
  type DashboardConfig,
  type DashboardQuickMaterial,
  type DashboardQuickMaterialsDoc,
  type DashboardSectionsConfig,
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
 */

const DEFAULT_SECTIONS: DashboardSectionsConfig = {
  hero: true,
  timeline: true,
  filterBar: true,
  quickMaterials: true,
  peerEvaluatorCard: true,
};

export interface DashboardDraft {
  sections: DashboardSectionsConfig;
  checkpoints: DashboardCheckpointsConfig;
  quickMaterials: DashboardQuickMaterial[];
}

export interface UseDashboardDraftResult {
  draft: DashboardDraft;
  savedSnapshot: DashboardDraft | null;
  setSections: (next: DashboardSectionsConfig) => void;
  setCheckpoints: (next: DashboardCheckpointsConfig) => void;
  setQuickMaterials: (next: DashboardQuickMaterial[]) => void;
  isDirty: boolean;
  saving: boolean;
  savedAt: Date | null;
  saveError: string | null;
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

function freshDraft(): DashboardDraft {
  return { sections: { ...DEFAULT_SECTIONS }, checkpoints: {}, quickMaterials: [] };
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

  // Hydrate once both docs have responded (either exists or empty).
  useEffect(() => {
    if (hydrated) return;
    if (configLoading || quickLoading) return;
    const next: DashboardDraft = {
      sections: stripIds(configDoc)?.sections ?? { ...DEFAULT_SECTIONS },
      checkpoints: stripIds(configDoc)?.checkpoints ?? {},
      quickMaterials: stripIds(quickDoc)?.items ?? [],
    };
    setDraft(next);
    setSavedSnapshot(next);
    setHydrated(true);
  }, [hydrated, configLoading, quickLoading, configDoc, quickDoc]);

  const setSections = useCallback((next: DashboardSectionsConfig) => {
    setDraft((d) => ({ ...d, sections: next }));
  }, []);
  const setCheckpoints = useCallback((next: DashboardCheckpointsConfig) => {
    setDraft((d) => ({ ...d, checkpoints: next }));
  }, []);
  const setQuickMaterials = useCallback((next: DashboardQuickMaterial[]) => {
    setDraft((d) => ({ ...d, quickMaterials: next }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all([
        setDoc(
          doc(db, CONFIG_PATH),
          {
            sections: draft.sections,
            checkpoints: draft.checkpoints,
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
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, user?.email]);

  const reset = useCallback(() => {
    if (savedSnapshot) setDraft(savedSnapshot);
  }, [savedSnapshot]);

  const isDirty = useMemo(() => !snapshotsEqual(draft, savedSnapshot), [draft, savedSnapshot]);

  return {
    draft,
    savedSnapshot,
    setSections,
    setCheckpoints,
    setQuickMaterials,
    isDirty,
    saving,
    savedAt,
    saveError,
    save,
    reset,
    loading: !hydrated,
  };
}
