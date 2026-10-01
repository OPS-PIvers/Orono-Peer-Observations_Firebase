import { useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  ADMIN_DEFAULT_QUESTION_SET,
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  GLOBAL_QUESTION_SET,
  buildingQuestionSetId,
  resolveReflectionUnlock,
  type AppSettings,
  type Building,
  type ReflectionUnlockMode,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db } from '@/lib/firebase';
import { PageHeader } from '@/components/PageHeader';
import { QuestionSetEditor } from './QuestionSetEditor';

const ACTIVE_BUILDINGS = [where('isActive', '==', true)];
const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

const REFLECTION_UNLOCK_OPTIONS: { value: ReflectionUnlockMode; label: string; hint: string }[] = [
  {
    value: 'always',
    label: 'Always available',
    hint: 'Staff can answer Reflection questions as soon as the observation exists.',
  },
  {
    value: 'after-observation',
    label: 'After the observation',
    hint: 'Reflection questions open the day after the observation date.',
  },
];

/** District-wide switch for when staff can answer Reflection questions. Saves on change. */
function ReflectionUnlockSetting() {
  const { user } = useAuth();
  const { data, loading } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  const current = resolveReflectionUnlock(data?.reflectionUnlock);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function choose(mode: ReflectionUnlockMode) {
    if (mode === current) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setDoc(
        doc(db, SETTINGS_PATH),
        { reflectionUnlock: mode, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
        { merge: true },
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="border-border bg-background mb-6 rounded-lg border p-4">
      <legend className="px-2 text-sm font-medium">When Reflection questions open</legend>
      <div className="flex flex-col gap-2">
        {REFLECTION_UNLOCK_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="reflectionUnlock"
              checked={current === opt.value}
              disabled={saving || (loading && !data)}
              onChange={() => void choose(opt.value)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              {opt.label}
              <span className="text-muted-foreground block text-xs">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {saving ? <p className="text-muted-foreground mt-2 text-xs">Saving…</p> : null}
      {saveError ? <p className="text-destructive mt-2 text-sm">{saveError}</p> : null}
    </fieldset>
  );
}

const SET_LABELS: Record<string, string> = {
  [GLOBAL_QUESTION_SET]: 'District (Peer Evaluators, every type)',
  [ADMIN_DEFAULT_QUESTION_SET]: 'Administrator default',
};

/** Who uses a building's set. Only console admins change it. */
function AppliesToSetting({ building }: { building: Building & { id: string } }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs lack this field
  const current = building.questionsAppliesTo ?? 'admin';

  async function choose(next: 'admin' | 'all') {
    if (next === current) return;
    setSaving(true);
    setSaveError(null);
    try {
      await setDoc(
        doc(db, COLLECTIONS.buildings, building.id),
        { questionsAppliesTo: next, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="border-border bg-background mb-6 rounded-lg border p-4">
      <legend className="px-2 text-sm font-medium">Applies to</legend>
      <div className="flex flex-col gap-2">
        {(
          [
            [
              'admin',
              'Administrator observations only',
              'Peer Evaluators keep the district questions.',
            ],
            [
              'all',
              'All observations in this building',
              "Peer Evaluators' Standard observations use these too.",
            ],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="questionsAppliesTo"
              checked={current === value}
              disabled={saving}
              onChange={() => void choose(value)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              {label}
              <span className="text-muted-foreground block text-xs">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      {saveError ? <p className="text-destructive mt-2 text-sm">{saveError}</p> : null}
    </fieldset>
  );
}

export function WorkProductPage() {
  const { data: buildingsRaw } = useFirestoreCollection<Building>(
    COLLECTIONS.buildings,
    ACTIVE_BUILDINGS,
  );
  const buildings = useMemo(
    () => (buildingsRaw ?? []).slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [buildingsRaw],
  );
  const [setId, setSetId] = useState<string>(GLOBAL_QUESTION_SET);
  const building = buildings.find((b) => buildingQuestionSetId(b.buildingId) === setId) ?? null;

  return (
    <PageHeader
      title="Observation Question Bank"
      subtitle="Planning and Reflection questions. The district set serves every observation type. Building Administrators' Standard observations use their building's set, or the Administrator default when their building has none; a building can also apply its set to Peer Evaluators' observations."
      variant="light"
      breadcrumb={['Admin', 'Observation Questions']}
    >
      <ReflectionUnlockSetting />

      <label className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Question set</span>
        <select
          value={setId}
          onChange={(e) => setSetId(e.target.value)}
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
        >
          <option value={GLOBAL_QUESTION_SET}>{SET_LABELS[GLOBAL_QUESTION_SET]}</option>
          <option value={ADMIN_DEFAULT_QUESTION_SET}>
            {SET_LABELS[ADMIN_DEFAULT_QUESTION_SET]}
          </option>
          {buildings.map((b) => (
            <option key={b.buildingId} value={buildingQuestionSetId(b.buildingId)}>
              {b.displayName}
            </option>
          ))}
        </select>
      </label>

      {building ? <AppliesToSetting building={building} /> : null}

      <QuestionSetEditor
        key={setId}
        setId={setId}
        {...(building ? { buildingId: building.buildingId } : {})}
      />
    </PageHeader>
  );
}
