import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, type AppSettings } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db, functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MigrateRolesResult {
  staffMigrated: number;
  staffAlreadySlug: number;
  staffUnmatched: { email: string; rawRole: string }[];
  observationsMigrated: number;
  observationsAlreadySlug: number;
  observationsUnmatched: { observationId: string; rawRole: string }[];
}

interface MigrateBestPracticesResult {
  rubricsScanned: number;
  rubricsTouched: number;
  componentsConverted: number;
  lookForsCreated: number;
  componentsSkippedHasLookFors: number;
  sample: { rubricId: string; componentId: string; from: string; to: string[] }[];
}

const migrateRolesToSlugsFn = httpsCallable<Record<string, never>, MigrateRolesResult>(
  functions,
  'migrateRolesToSlugs',
);

const migrateBestPracticesFn = httpsCallable<Record<string, never>, MigrateBestPracticesResult>(
  functions,
  'migrateBestPracticesToLookFors',
);

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

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
    setSaving(true);
    setSaveError(null);
    try {
      await setDoc(
        doc(db, SETTINGS_PATH),
        {
          ...form,
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
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-bold">App Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          System-wide tunables. Changes apply on next page load for users.
        </p>
      </header>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load settings: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background max-w-2xl space-y-6 rounded-lg border p-6">
        <Field
          label="Session duration (hours)"
          help="How long a sign-in session is honored before the user is asked to re-authenticate."
        >
          <Input
            type="number"
            min={1}
            max={168}
            value={form.sessionDurationHours ?? 24}
            onChange={(e) =>
              setForm((f) => ({ ...f, sessionDurationHours: Number(e.target.value) }))
            }
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
            onChange={(e) =>
              setForm((f) => ({ ...f, auditLogRetentionDays: Number(e.target.value) }))
            }
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
          help="Notifications send-as this address via the Trigger Email extension."
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
          <legend className="px-2 text-sm font-medium">Rate limits</legend>
          <Field label="Observation saves per minute (per user)">
            <Input
              type="number"
              min={1}
              value={form.rateLimits?.observationSavesPerMinute ?? 60}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  rateLimits: {
                    ...(f.rateLimits ?? {
                      observationSavesPerMinute: 60,
                      audioUploadsPerHour: 20,
                      transcriptionRequestsPerDay: 50,
                    }),
                    observationSavesPerMinute: Number(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field label="Audio uploads per hour (per user)">
            <Input
              type="number"
              min={1}
              value={form.rateLimits?.audioUploadsPerHour ?? 20}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  rateLimits: {
                    ...(f.rateLimits ?? {
                      observationSavesPerMinute: 60,
                      audioUploadsPerHour: 20,
                      transcriptionRequestsPerDay: 50,
                    }),
                    audioUploadsPerHour: Number(e.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field label="Transcription requests per day (per user)">
            <Input
              type="number"
              min={1}
              value={form.rateLimits?.transcriptionRequestsPerDay ?? 50}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  rateLimits: {
                    ...(f.rateLimits ?? {
                      observationSavesPerMinute: 60,
                      audioUploadsPerHour: 20,
                      transcriptionRequestsPerDay: 50,
                    }),
                    transcriptionRequestsPerDay: Number(e.target.value),
                  },
                }))
              }
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
      </div>

      <MaintenanceSection />
    </div>
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
    <div className="border-border bg-background mt-6 max-w-2xl space-y-4 rounded-lg border p-6">
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

      <BestPracticesMigrationCard />
    </div>
  );
}

function BestPracticesMigrationCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MigrateBestPracticesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await migrateBestPracticesFn({});
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setRunning(false);
      setConfirming(false);
    }
  }

  return (
    <div className="border-border space-y-3 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-semibold">Convert best practices to look-fors</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          For every rubric component, splits the multi-line{' '}
          <code className="font-mono text-xs">bestPractices</code> text into individual checklist
          items in <code className="font-mono text-xs">lookFors</code> (one per line, bullets
          stripped) and clears the original field. Only touches components whose{' '}
          <code className="font-mono text-xs">lookFors</code> is currently empty — won&apos;t
          clobber items you&apos;ve added by hand. Idempotent — safe to re-run. Existing
          observations are unaffected.
        </p>
      </div>

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="bg-ops-blue-lighter text-ops-blue-dark rounded-md border-l-4 border-l-blue-500 px-3 py-2 text-sm">
          <p className="font-medium">Conversion complete.</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            <li>
              Rubrics scanned: {result.rubricsScanned}; updated: {result.rubricsTouched}
            </li>
            <li>
              Components converted: {result.componentsConverted}; skipped (already had look-fors):{' '}
              {result.componentsSkippedHasLookFors}
            </li>
            <li>Look-fors created: {result.lookForsCreated}</li>
          </ul>
          {result.sample.length > 0 ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer">Sample ({result.sample.length})</summary>
              <ul className="mt-1 space-y-2 pl-5">
                {result.sample.map((s) => (
                  <li key={`${s.rubricId}-${s.componentId}`}>
                    <p className="font-mono">
                      {s.rubricId} / {s.componentId}
                    </p>
                    <p className="text-[10px] whitespace-pre-wrap opacity-70">{s.from}</p>
                    <p className="mt-1 text-[10px] font-medium">→ {s.to.length} look-for(s):</p>
                    <ul className="list-disc pl-5 text-[10px]">
                      {s.to.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
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
            {running ? 'Running…' : 'Yes, run conversion'}
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
          Run best-practices → look-fors conversion
        </Button>
      )}
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
