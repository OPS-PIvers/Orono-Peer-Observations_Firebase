import { useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  APP_SETTINGS_DOC_ID,
  BOOKING_MODES,
  COLLECTIONS,
  DEFAULT_SCHEDULING_SETTINGS,
  type AppSettings,
  type BookingMode,
  type SchedulingSettings,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';

const SETTINGS_PATH = `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`;

const MODE_LABELS: Record<BookingMode, string> = {
  direct: 'Direct slot booking',
  'day-preference': 'Day preference + assignment',
};

const DOW = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function hhmmToMinutes(value: string): number {
  const parts = value.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function SchedulingSettingsPage() {
  const { user } = useAuth();
  const { data, loading, error } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);

  const [form, setForm] = useState<SchedulingSettings>(DEFAULT_SCHEDULING_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useHydratedDraft(data?.id ?? null, data, (src) => {
    setForm({ ...DEFAULT_SCHEDULING_SETTINGS, ...src.scheduling });
  });

  if (loading && !data) return <p className="text-muted-foreground">Loading settings…</p>;

  function set<K extends keyof SchedulingSettings>(key: K, value: SchedulingSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleMode(mode: BookingMode) {
    setForm((f) => {
      const has = f.allowedBookingModes.includes(mode);
      const next = has
        ? f.allowedBookingModes.filter((m) => m !== mode)
        : [...f.allowedBookingModes, mode];
      const first = next[0];
      if (!first) return f; // keep at least one
      const defaultMode = next.includes(f.defaultBookingMode) ? f.defaultBookingMode : first;
      return { ...f, allowedBookingModes: next, defaultBookingMode: defaultMode };
    });
  }

  function toggleWeekday(value: number) {
    setForm((f) => {
      const has = f.defaultWeekdays.includes(value);
      return {
        ...f,
        defaultWeekdays: (has
          ? f.defaultWeekdays.filter((d) => d !== value)
          : [...f.defaultWeekdays, value]
        ).sort((a, b) => a - b),
      };
    });
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await setDoc(
        doc(db, SETTINGS_PATH),
        { scheduling: form, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
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
      variant="light"
      breadcrumb={['Admin', 'Scheduling']}
      title="Scheduling Settings"
      subtitle="Defaults and constraints for observation windows. Peer evaluators can override mode, buffer, and caps per window within the bounds you set here."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load settings: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background max-w-2xl space-y-6 rounded-lg border p-6">
        <fieldset className="border-border space-y-3 rounded-md border p-4">
          <legend className="px-2 text-sm font-medium">Booking modes</legend>
          <p className="text-muted-foreground text-xs">
            Which modes peer evaluators may choose when creating a window. At least one must stay
            enabled.
          </p>
          {BOOKING_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.allowedBookingModes.includes(mode)}
                onChange={() => toggleMode(mode)}
                className="h-4 w-4"
              />
              {MODE_LABELS[mode]}
            </label>
          ))}
          <div className="grid gap-1.5 pt-2">
            <Label>Default mode</Label>
            <select
              value={form.defaultBookingMode}
              onChange={(e) => set('defaultBookingMode', e.target.value as BookingMode)}
              className="border-input h-9 max-w-xs rounded-md border bg-white px-2 text-sm"
            >
              {form.allowedBookingModes.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <Field
          label="Travel buffer (minutes)"
          help="Minutes the evaluator needs between observations. A booking blocks any overlapping slot in other buildings ± this buffer."
        >
          <Input
            type="number"
            min={0}
            max={240}
            value={form.travelBufferMinutes}
            onChange={(e) => set('travelBufferMinutes', Number(e.target.value))}
          />
        </Field>

        <Field
          label="Default per-day cap (day-preference mode)"
          help="Maximum staff who can pick the same day. Leave blank for uncapped."
        >
          <Input
            type="number"
            min={1}
            value={form.defaultPerDayCap ?? ''}
            onChange={(e) =>
              set('defaultPerDayCap', e.target.value ? Number(e.target.value) : null)
            }
            placeholder="Uncapped"
          />
        </Field>

        <Field
          label="Booking lead time (hours)"
          help="Staff cannot book a slot starting within this many hours from now."
        >
          <Input
            type="number"
            min={0}
            max={720}
            value={form.bookingLeadTimeHours}
            onChange={(e) => set('bookingLeadTimeHours', Number(e.target.value))}
          />
        </Field>

        <fieldset className="border-border space-y-3 rounded-md border p-4">
          <legend className="px-2 text-sm font-medium">Default window bounds</legend>
          <div>
            <Label className="text-xs">Weekdays</Label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              {DOW.map((d) => (
                <label key={d.value} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.defaultWeekdays.includes(d.value)}
                    onChange={() => toggleWeekday(d.value)}
                    className="h-4 w-4"
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Earliest time of day">
              <Input
                type="time"
                value={minutesToHHMM(form.defaultEarliestMinute)}
                onChange={(e) => set('defaultEarliestMinute', hhmmToMinutes(e.target.value))}
              />
            </Field>
            <Field label="Latest time of day">
              <Input
                type="time"
                value={minutesToHHMM(form.defaultLatestMinute)}
                onChange={(e) => set('defaultLatestMinute', hhmmToMinutes(e.target.value))}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="border-border space-y-3 rounded-md border p-4">
          <legend className="px-2 text-sm font-medium">Calendar & email</legend>
          <div className="grid gap-1.5">
            <Label>Google Calendar invites</Label>
            <select
              value={form.gcalSendUpdates}
              onChange={(e) => set('gcalSendUpdates', e.target.value as 'none' | 'all')}
              className="border-input h-9 max-w-xs rounded-md border bg-white px-2 text-sm"
            >
              <option value="none">
                Don&apos;t send Google&apos;s own invites (app emails only)
              </option>
              <option value="all">Let Google send native calendar invites</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requireCalendarConnect}
              onChange={(e) => set('requireCalendarConnect', e.target.checked)}
              className="h-4 w-4"
            />
            Require staff to connect Google Calendar before booking
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.inviteEmailEnabled}
              onChange={(e) => set('inviteEmailEnabled', e.target.checked)}
              className="h-4 w-4"
            />
            Send invite emails when a window opens
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.confirmationEmailEnabled}
              onChange={(e) => set('confirmationEmailEnabled', e.target.checked)}
              className="h-4 w-4"
            />
            Send confirmation emails on booking
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.cancellationEmailEnabled}
              onChange={(e) => set('cancellationEmailEnabled', e.target.checked)}
              className="h-4 w-4"
            />
            Send cancellation emails
          </label>
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
            {saving ? 'Saving…' : 'Save scheduling settings'}
          </Button>
        </div>
      </div>
    </PageHeader>
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
