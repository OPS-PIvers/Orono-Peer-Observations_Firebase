import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  AI_FEATURE_KEYS,
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  resolveAiModels,
  resolveFeatureModel,
  resolveGeminiFeature,
  resolveScriptAutoTagControls,
  type AiFeatureKey,
  type AiModel,
  type AppSettings,
  type ResolvedGeminiFeature,
  type ScriptAutoTagControls,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db, functions } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { SpendingPanel } from './SpendingPanel';
import { ModelsPanel } from './ModelsPanel';
import { FeaturesPanel } from './FeaturesPanel';
import { rangeStartKey, useAiUsage, useUsageSummary } from './aiUsage';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

const TABS = [
  { value: 'spending', label: 'Spending' },
  { value: 'models', label: 'Models' },
  { value: 'features', label: 'Features' },
] as const;
type Tab = (typeof TABS)[number]['value'];

interface Draft {
  models: AiModel[];
  features: Record<AiFeatureKey, ResolvedGeminiFeature>;
  autoTagControls: ScriptAutoTagControls;
}

function draftFrom(settings: Partial<AppSettings> | null): Draft {
  return {
    models: resolveAiModels(settings?.aiModels),
    features: {
      audioTranscription: resolveGeminiFeature(settings?.gemini?.audioTranscription),
      scriptAutoTag: resolveGeminiFeature(settings?.gemini?.scriptAutoTag),
    },
    autoTagControls: resolveScriptAutoTagControls(settings?.scriptAutoTagControls),
  };
}

const getAiProviderStatusFn = httpsCallable<
  Record<string, never>,
  { claude: { configured: boolean } }
>(functions, 'getAiProviderStatus');

/** Whether the server holds a Claude API key (null while checking or unknown). */
function useClaudeConfigured(): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    getAiProviderStatusFn({})
      .then((res) => {
        if (!cancelled) setConfigured(res.data.claude.configured);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return configured;
}

export function AiModelsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.value === params.get('tab'))
    ? (params.get('tab') as Tab)
    : 'spending';

  const settings = useFirestoreDoc<AppSettings>(SETTINGS_PATH, { cached: false });
  const { daily, events } = useAiUsage();
  const claudeConfigured = useClaudeConfigured();

  const [draft, setDraft] = useState<Draft>(() => draftFrom(null));
  const [saved, setSaved] = useState<Draft>(() => draftFrom(null));
  const hydrate = useCallback((s: Partial<AppSettings>) => {
    const d = draftFrom(s);
    setDraft(d);
    setSaved(d);
  }, []);
  // Hydrate once; later snapshots would clobber in-progress edits.
  useHydratedDraft(settings.data?.id ?? null, settings.data, hydrate);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const modelsDirty = JSON.stringify(draft.models) !== JSON.stringify(saved.models);
  const featuresDirty =
    JSON.stringify(draft.features) !== JSON.stringify(saved.features) ||
    JSON.stringify(draft.autoTagControls) !== JSON.stringify(saved.autoTagControls);
  const dirty = modelsDirty || featuresDirty;

  const month = useUsageSummary(daily.data, rangeStartKey('month'));

  const routedModelByFeature = useMemo(
    () =>
      Object.fromEntries(
        AI_FEATURE_KEYS.map((k) => [
          k,
          resolveFeatureModel(draft.models, k, draft.features[k].model).id,
        ]),
      ) as Record<AiFeatureKey, string>,
    [draft],
  );

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Store what the server will actually call, so the doc never points a
      // feature at a model that was removed or disabled in this edit.
      const features = Object.fromEntries(
        AI_FEATURE_KEYS.map((k) => [k, { ...draft.features[k], model: routedModelByFeature[k] }]),
      );
      await setDoc(
        doc(db, SETTINGS_PATH),
        {
          aiModels: draft.models,
          gemini: features,
          scriptAutoTagControls: draft.autoTagControls,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
        },
        { merge: true },
      );
      const next = { ...draft, features: features as Draft['features'] };
      setDraft(next);
      setSaved(next);
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageHeader
      title="AI Models"
      subtitle="Which models each AI feature uses, who can use it, and what it costs."
      variant="light"
      breadcrumb={['Admin', 'AI Models']}
      belowBar={
        <div className="mx-auto flex max-w-7xl gap-1 px-4 md:px-6" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setParams({ tab: t.value }, { replace: true })}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm',
                tab === t.value
                  ? 'border-ops-blue text-ops-blue font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {t.label}
              {(t.value === 'models' && modelsDirty) ||
              (t.value === 'features' && featuresDirty) ? (
                <span
                  className="bg-ops-red ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                  aria-label="unsaved changes"
                />
              ) : null}
            </button>
          ))}
        </div>
      }
    >
      {settings.error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load settings: {settings.error.message}
        </div>
      ) : null}

      {tab === 'spending' ? (
        <SpendingPanel
          models={draft.models}
          daily={daily.data}
          events={events.data}
          loading={daily.loading}
          error={daily.error ?? events.error}
        />
      ) : tab === 'models' ? (
        <ModelsPanel
          models={draft.models}
          onChange={(models) => setDraft((d) => ({ ...d, models }))}
          routedModelByFeature={routedModelByFeature}
          claudeConfigured={claudeConfigured}
        />
      ) : (
        <FeaturesPanel
          models={draft.models}
          features={draft.features}
          onChange={(key, next) =>
            setDraft((d) => ({ ...d, features: { ...d.features, [key]: next } }))
          }
          autoTagControls={draft.autoTagControls}
          onAutoTagControlsChange={(autoTagControls) =>
            setDraft((d) => ({ ...d, autoTagControls }))
          }
          monthByFeature={month.byFeature}
          claudeConfigured={claudeConfigured}
        />
      )}

      {tab !== 'spending' && (dirty || saveError || savedAt) ? (
        <div className="border-border sticky bottom-0 mt-6 flex items-center justify-between gap-3 border-t bg-white/95 py-3 backdrop-blur">
          <p className="text-sm">
            {saveError ? (
              <span className="text-ops-red-dark">{saveError}</span>
            ) : dirty ? (
              'You have unsaved changes to models or features.'
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved at {savedAt.toLocaleTimeString()}</span>
            ) : null}
          </p>
          <div className="flex gap-2">
            {dirty ? (
              <Button variant="outline" onClick={() => setDraft(saved)} disabled={saving}>
                Discard
              </Button>
            ) : null}
            <Button onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}
    </PageHeader>
  );
}
