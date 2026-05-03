import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { APP_SETTINGS_DOC_ID, COLLECTIONS, type AppSettings } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
