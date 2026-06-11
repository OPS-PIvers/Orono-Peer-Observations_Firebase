import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_OPTIONS,
  appSettings,
  type AppSettings,
  type GeminiFeature,
  type GeminiFeatures,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db, functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';

interface MigrateRolesResult {
  staffMigrated: number;
  staffAlreadySlug: number;
  staffUnmatched: { email: string; rawRole: string }[];
  observationsMigrated: number;
  observationsAlreadySlug: number;
  observationsUnmatched: { observationId: string; rawRole: string }[];
}

interface BackfillResult {
  observationsScanned: number;
  observationsUpdated: number;
  spansUpdated: number;
  observationsSkipped: number;
}

const migrateRolesToSlugsFn = httpsCallable<Record<string, never>, MigrateRolesResult>(
  functions,
  'migrateRolesToSlugs',
);

const backfillScriptTagColorsFn = httpsCallable<Record<string, never>, BackfillResult>(
  functions,
  'backfillScriptTagColors',
);

const DEFAULT_GEMINI_FEATURES: GeminiFeatures = {
  audioTranscription: { enabled: true, model: DEFAULT_GEMINI_MODEL },
  scriptAutoTag: { enabled: true, model: DEFAULT_GEMINI_MODEL },
};

const GEMINI_FEATURE_META: {
  key: keyof GeminiFeatures;
  title: string;
  description: string;
  hiddenWhenDisabled: string;
}[] = [
  {
    key: 'audioTranscription',
    title: 'Audio transcription',
    description:
      'After a recording is saved, send the audio to Gemini and store the verbatim transcript on the observation.',
    hiddenWhenDisabled: 'Hides the Transcribe button on the audio recorder.',
  },
  {
    key: 'scriptAutoTag',
    title: 'Script auto-tag',
    description:
      'One-click button in the script editor that asks Gemini to tag verbatim spans with rubric components.',
    hiddenWhenDisabled: 'Hides the Auto-tag button in the script editor toolbar.',
  },
];

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

/**
 * Validate a partial app-settings draft before persisting.
 *
 * Empty strings for email/url fields are treated as absent (the field will not
 * be written). Number inputs with invalid values are caught by the schema.
 *
 * Returns an array of human-readable error messages, or an empty array when
 * the draft is valid.
 */
export function validateAppSettingsDraft(draft: Partial<AppSettings>): string[] {
  // Build a candidate with empty strings coerced to absent so the schema
  // validators for email and url fields behave correctly (empty = not provided).
  const candidate: Record<string, unknown> = { ...draft };
  if (candidate['securityAdminEmail'] === '') delete candidate['securityAdminEmail'];
  if (candidate['outboundEmailAddress'] === '') delete candidate['outboundEmailAddress'];
  if (candidate['signupLink'] === '') delete candidate['signupLink'];

  const result = appSettings.partial().safeParse(candidate);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  });
}

export function SettingsPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);

  const [form, setForm] = useState<Partial<AppSettings>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Hydrate once; later snapshots would clobber in-progress edits.
  // Key off the loaded doc's own id rather than a constant so the
  // hook's source-id guard always matches. Issue #3.
  useHydratedDraft(data?.id ?? null, data, setForm);

  if (loading && !data) return <p className="text-muted-foreground">Loading settings…</p>;

  async function save() {
    const validationErrors = validateAppSettingsDraft(form);
    if (validationErrors.length > 0) {
      setSaveError(validationErrors.join(' · '));
      return;
    }
    setSaving(true);
    setSaveError(null);
    // Omit empty strings for optional string fields so they are not written
    // as empty strings into Firestore. Build a clean payload object.
    const payloadBase: Record<string, unknown> = { ...form };
    if (payloadBase['securityAdminEmail'] === '') delete payloadBase['securityAdminEmail'];
    if (payloadBase['outboundEmailAddress'] === '') delete payloadBase['outboundEmailAddress'];
    if (payloadBase['signupLink'] === '') delete payloadBase['signupLink'];
    try {
      await setDoc(
        doc(db, SETTINGS_PATH),
        {
          ...payloadBase,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
        },
        { merge: true },
      );
      setSavedAt(new Date());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageHeader
      title="App Settings"
      subtitle="System-wide tunables. Changes apply on next page load for users."
      variant="light"
      breadcrumb={['Admin', 'Settings']}
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load settings: {error.message}
        </div>
      ) : null}

      <Card className="max-w-2xl space-y-6 p-6">
        <Field
          label="Session duration (hours)"
          help="How long a sign-in session is honored before the user is asked to re-authenticate."
        >
          <Input
            type="number"
            min={1}
            max={168}
            value={form.sessionDurationHours ?? 24}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              if (val === undefined) return; // keep previous value when cleared
              setForm((f) => ({ ...f, sessionDurationHours: val }));
            }}
          />
        </Field>

        <Field
          label="Audit log retention (days)"
          help="Older log entries are pruned daily by a scheduled function."
        >
          <Input
            type="number"
            min={1}
            max={3650}
            value={form.auditLogRetentionDays ?? 365}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : undefined;
              if (val === undefined) return; // keep previous value when cleared
              setForm((f) => ({ ...f, auditLogRetentionDays: val }));
            }}
          />
        </Field>

        <Field
          label="Security admin email"
          help="Receives security alerts (rate-limit trips, sign-in rejections, etc.)."
        >
          <Input
            type="email"
            value={form.securityAdminEmail ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, securityAdminEmail: e.target.value }))}
            placeholder="paul.ivers@orono.k12.mn.us"
          />
        </Field>

        <Field
          label="Outbound email address"
          help="All notifications send-as this address. It must be authorized in the Trigger Email extension's SMTP configuration or sends will fail. Leave blank to use observations@orono.k12.mn.us."
        >
          <Input
            type="email"
            value={form.outboundEmailAddress ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, outboundEmailAddress: e.target.value }))}
            placeholder="observations@orono.k12.mn.us"
          />
        </Field>

        <Field
          label="Observation signup link"
          help="URL included in the 'Signup Request' email template — a Calendly link, Google Form, or any scheduling URL."
        >
          <Input
            type="url"
            value={form.signupLink ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, signupLink: e.target.value || null }))}
            placeholder="https://calendly.com/..."
          />
        </Field>

        <Field
          label="Global banner text"
          help="If set, displays a banner across all pages. Leave empty to hide."
        >
          <Input
            value={form.globalBannerText ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, globalBannerText: e.target.value }))}
            placeholder="(no banner)"
          />
        </Field>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.newObservationsDisabled ?? false}
              onChange={(e) =>
                setForm((f) => ({ ...f, newObservationsDisabled: e.target.checked }))
              }
              className="h-4 w-4"
            />
            <span>
              Disable new observation creation
              <span className="text-muted-foreground block text-xs">
                Use during the GAS-cutover window to prevent drafts from accumulating.
              </span>
            </span>
          </label>
        </div>

        <fieldset className="border-border space-y-4 rounded-md border p-4">
          <legend className="px-2 text-sm font-medium">Gemini features</legend>
          <p className="text-muted-foreground text-xs">
            Toggle individual Gemini-powered features and pick the model each one uses. Default is{' '}
            <code className="font-mono">{DEFAULT_GEMINI_MODEL}</code>. Disabled features are hidden
            from the UI for everyone.
          </p>
          {GEMINI_FEATURE_META.map((meta) => {
            const current: GeminiFeature =
              form.gemini?.[meta.key] ?? DEFAULT_GEMINI_FEATURES[meta.key];
            return (
              <GeminiFeatureRow
                key={meta.key}
                title={meta.title}
                description={meta.description}
                hiddenWhenDisabled={meta.hiddenWhenDisabled}
                value={current}
                onChange={(next) =>
                  setForm((f) => ({
                    ...f,
                    gemini: {
                      ...DEFAULT_GEMINI_FEATURES,
                      ...(f.gemini ?? {}),
                      [meta.key]: next,
                    },
                  }))
                }
              />
            );
          })}
        </fieldset>

        <fieldset className="border-border space-y-4 rounded-md border p-4">
          <legend className="px-2 text-sm font-medium">Rate limits</legend>
          <Field
            label="Observation saves per minute (per user)"
            help="Throttles how often the observation editor autosaves to Firestore for each evaluator."
          >
            <Input
              type="number"
              min={1}
              value={form.rateLimits?.observationSavesPerMinute ?? 60}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                if (val === undefined) return; // keep previous value when cleared
                setForm((f) => ({
                  ...f,
                  rateLimits: {
                    ...(f.rateLimits ?? {
                      observationSavesPerMinute: 60,
                      audioUploadsPerHour: 20,
                      transcriptionRequestsPerDay: 50,
                    }),
                    observationSavesPerMinute: val,
                  },
                }));
              }}
            />
          </Field>
          <Field
            label="Audio uploads per hour (per user)"
            help="Audio recordings beyond this many in a rolling hour are rejected (HTTP 429) per evaluator."
          >
            <Input
              type="number"
              min={1}
              value={form.rateLimits?.audioUploadsPerHour ?? 20}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                if (val === undefined) return; // keep previous value when cleared
                setForm((f) => ({
                  ...f,
                  rateLimits: {
                    ...(f.rateLimits ?? {
                      observationSavesPerMinute: 60,
                      audioUploadsPerHour: 20,
                      transcriptionRequestsPerDay: 50,
                    }),
                    audioUploadsPerHour: val,
                  },
                }));
              }}
            />
          </Field>
          <Field
            label="Transcription requests per day (per user)"
            help="New transcription jobs beyond this many in a rolling day are rejected per evaluator (re-using an in-flight job doesn't count)."
          >
            <Input
              type="number"
              min={1}
              value={form.rateLimits?.transcriptionRequestsPerDay ?? 50}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                if (val === undefined) return; // keep previous value when cleared
                setForm((f) => ({
                  ...f,
                  rateLimits: {
                    ...(f.rateLimits ?? {
                      observationSavesPerMinute: 60,
                      audioUploadsPerHour: 20,
                      transcriptionRequestsPerDay: 50,
                    }),
                    transcriptionRequestsPerDay: val,
                  },
                }));
              }}
            />
          </Field>
        </fieldset>

        {saveError ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
            {saveError}
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          {savedAt ? (
            <p className="text-muted-foreground text-xs">Saved at {savedAt.toLocaleTimeString()}</p>
          ) : (
            <span />
          )}
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </Card>

      <MaintenanceSection />
    </PageHeader>
  );
}

function MaintenanceSection() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MigrateRolesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await migrateRolesToSlugsFn({});
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  return (
    <Card className="mt-6 max-w-2xl space-y-4 p-6">
      <header>
        <h2 className="text-lg font-semibold">Maintenance</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          One-shot tools that don&apos;t belong in the regular settings flow.
        </p>
      </header>

      <div className="border-border space-y-3 rounded-md border p-4">
        <div>
          <h3 className="text-sm font-semibold">Migrate roles to slugs</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Converts <code className="font-mono text-xs">staff.role</code> and{' '}
            <code className="font-mono text-xs">observation.observedRole</code> from the role&apos;s
            display name (e.g. &quot;Instructional Specialist&quot;) to its{' '}
            <code className="font-mono text-xs">roleId</code> slug (e.g.{' '}
            &quot;instructional-specialist&quot;). Idempotent — safe to re-run. Required once after
            this release; values that don&apos;t match a configured role are left in place and
            reported below so you can fix them via the staff editor.
          </p>
        </div>

        {error ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="bg-ops-blue-lighter text-ops-blue-dark rounded-md border-l-4 border-l-blue-500 px-3 py-2 text-sm">
            <p className="font-medium">Migration complete.</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
              <li>
                Staff: {result.staffMigrated} migrated, {result.staffAlreadySlug} already slug,{' '}
                {result.staffUnmatched.length} unmatched
              </li>
              <li>
                Observations: {result.observationsMigrated} migrated,{' '}
                {result.observationsAlreadySlug} already slug, {result.observationsUnmatched.length}{' '}
                unmatched
              </li>
            </ul>
            {result.staffUnmatched.length > 0 ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">
                  Unmatched staff ({result.staffUnmatched.length})
                </summary>
                <ul className="mt-1 list-disc pl-5 font-mono">
                  {result.staffUnmatched.map((u) => (
                    <li key={u.email}>
                      {u.email} → &quot;{u.rawRole}&quot;
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {result.observationsUnmatched.length > 0 ? (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">
                  Unmatched observations ({result.observationsUnmatched.length})
                </summary>
                <ul className="mt-1 list-disc pl-5 font-mono">
                  {result.observationsUnmatched.map((u) => (
                    <li key={u.observationId}>
                      {u.observationId} → &quot;{u.rawRole}&quot;
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        {confirming ? (
          <div className="flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={() => void run()} disabled={running}>
              {running ? 'Running…' : 'Yes, run migration'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={running}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Run role-slug migration
          </Button>
        )}
      </div>

      <BackfillScriptTagColorsCard />
    </Card>
  );
}

function BackfillScriptTagColorsCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await backfillScriptTagColorsFn({});
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  return (
    <div className="border-border space-y-3 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-semibold">Backfill script-tag colors</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Walks every observation&apos;s <code className="font-mono text-xs">scriptDoc</code> and
          back-fills <code className="font-mono text-xs">bg</code>/
          <code className="font-mono text-xs">fg</code> attributes on{' '}
          <code className="font-mono text-xs">componentTag</code> marks that were saved before
          per-component colors were stored on the mark. After running, every tagged span renders in
          its component&apos;s actual color (in the editor and in finalized PDFs). Idempotent — safe
          to re-run.
        </p>
      </div>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="bg-ops-blue-lighter text-ops-blue-dark rounded-md border-l-4 border-l-blue-500 px-3 py-2 text-sm">
          <p className="font-medium">Backfill complete.</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            <li>Observations scanned: {result.observationsScanned}</li>
            <li>Observations updated: {result.observationsUpdated}</li>
            <li>Spans coloured: {result.spansUpdated}</li>
            <li>
              Skipped (no rubric match): {result.observationsSkipped}
              {result.observationsSkipped > 0
                ? ' — fix the role on those observations and re-run.'
                : ''}
            </li>
          </ul>
        </div>
      ) : null}

      {confirming ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={() => void run()} disabled={running}>
            {running ? 'Running…' : 'Yes, run backfill'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming(false)}
            disabled={running}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Run script-tag color backfill
        </Button>
      )}
    </div>
  );
}

function GeminiFeatureRow({
  title,
  description,
  hiddenWhenDisabled,
  value,
  onChange,
}: {
  title: string;
  description: string;
  hiddenWhenDisabled: string;
  value: GeminiFeature;
  onChange: (next: GeminiFeature) => void;
}) {
  const knownIds = new Set(GEMINI_MODEL_OPTIONS.map((m) => m.id));
  const isCustomModel = !knownIds.has(value.model as (typeof GEMINI_MODEL_OPTIONS)[number]['id']);
  return (
    <div className="border-border bg-muted/20 space-y-2 rounded-md border p-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex-1">
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground block text-xs">{description}</span>
          {!value.enabled ? (
            <span className="text-ops-red-dark mt-1 block text-xs italic">
              Disabled · {hiddenWhenDisabled}
            </span>
          ) : null}
        </span>
      </label>

      <div className="grid gap-1 pl-6">
        <Label className="text-xs">Gemini model</Label>
        <select
          value={value.model}
          onChange={(e) => onChange({ ...value, model: e.target.value })}
          disabled={!value.enabled}
          className="border-input focus:border-ops-blue focus:ring-ops-blue h-9 rounded-md border bg-white px-2 text-sm outline-none focus:ring-1 disabled:opacity-50"
        >
          {GEMINI_MODEL_OPTIONS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.note}
            </option>
          ))}
          {isCustomModel ? <option value={value.model}>{value.model} (custom)</option> : null}
        </select>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {help ? <p className="text-muted-foreground text-xs">{help}</p> : null}
    </div>
  );
}
