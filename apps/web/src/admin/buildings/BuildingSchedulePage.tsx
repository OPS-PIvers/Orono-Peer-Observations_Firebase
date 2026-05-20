import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  type Building,
  type BuildingSchedule,
  type ScheduleDateOverride,
  type ScheduleDayType,
  type SchedulePeriod,
  type ScheduleWeeklyPattern,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';

interface ScheduleForm {
  timeZone: string;
  dayTypes: ScheduleDayType[];
  weeklyPattern: ScheduleWeeklyPattern;
  overrides: ScheduleDateOverride[];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
}

const EMPTY_FORM: ScheduleForm = {
  timeZone: 'America/Chicago',
  dayTypes: [],
  weeklyPattern: { mon: null, tue: null, wed: null, thu: null, fri: null },
  overrides: [],
  effectiveFrom: null,
  effectiveTo: null,
  isActive: true,
};

const WEEKDAYS: { key: keyof ScheduleWeeklyPattern; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
];

function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToMinutes(value: string): number {
  const parts = value.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function BuildingSchedulePage() {
  const { buildingId = '' } = useParams<{ buildingId: string }>();
  const { user } = useAuth();
  const building = useFirestoreDoc<Building>(
    buildingId ? `${COLLECTIONS.buildings}/${buildingId}` : '',
  );
  const schedulePath = buildingId ? `${COLLECTIONS.buildingSchedules}/${buildingId}` : '';
  const schedule = useFirestoreDoc<BuildingSchedule>(schedulePath);

  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useHydratedDraft(schedule.data?.id ?? null, schedule.data, (src) => {
    setForm({
      timeZone: src.timeZone,
      dayTypes: src.dayTypes,
      weeklyPattern: src.weeklyPattern,
      overrides: src.overrides,
      effectiveFrom: src.effectiveFrom,
      effectiveTo: src.effectiveTo,
      isActive: src.isActive,
    });
  });

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Validate period bounds before writing.
      for (const dt of form.dayTypes) {
        for (const p of dt.periods) {
          if (p.endMinute <= p.startMinute) {
            throw new Error(`Period "${p.name || dt.name}" must end after it starts.`);
          }
        }
      }
      await setDoc(
        doc(db, schedulePath),
        {
          buildingId,
          timeZone: form.timeZone,
          dayTypes: form.dayTypes,
          weeklyPattern: form.weeklyPattern,
          overrides: form.overrides,
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo,
          isActive: form.isActive,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
          ...(schedule.data ? {} : { createdAt: serverTimestamp() }),
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

  // --- Day type / period mutators ---
  function addDayType() {
    setForm((f) => ({
      ...f,
      dayTypes: [
        ...f.dayTypes,
        {
          dayTypeId: newId('dt'),
          name: `Day type ${String(f.dayTypes.length + 1)}`,
          isNoSchool: false,
          periods: [],
        },
      ],
    }));
  }

  function updateDayType(id: string, patch: Partial<ScheduleDayType>) {
    setForm((f) => ({
      ...f,
      dayTypes: f.dayTypes.map((dt) => (dt.dayTypeId === id ? { ...dt, ...patch } : dt)),
    }));
  }

  function removeDayType(id: string) {
    setForm((f) => ({
      ...f,
      dayTypes: f.dayTypes.filter((dt) => dt.dayTypeId !== id),
      weeklyPattern: Object.fromEntries(
        Object.entries(f.weeklyPattern).map(([k, v]) => [k, v === id ? null : v]),
      ) as ScheduleWeeklyPattern,
      overrides: f.overrides.map((o) => (o.dayTypeId === id ? { ...o, dayTypeId: null } : o)),
    }));
  }

  function addPeriod(dayTypeId: string) {
    setForm((f) => ({
      ...f,
      dayTypes: f.dayTypes.map((dt) => {
        if (dt.dayTypeId !== dayTypeId) return dt;
        const last = dt.periods[dt.periods.length - 1];
        const lastEnd = last ? last.endMinute : 480;
        return {
          ...dt,
          periods: [
            ...dt.periods,
            {
              periodId: newId('p'),
              name: `Period ${String(dt.periods.length + 1)}`,
              startMinute: lastEnd,
              endMinute: Math.min(lastEnd + 45, 1439),
              order: dt.periods.length,
            },
          ],
        };
      }),
    }));
  }

  function updatePeriod(dayTypeId: string, periodId: string, patch: Partial<SchedulePeriod>) {
    setForm((f) => ({
      ...f,
      dayTypes: f.dayTypes.map((dt) =>
        dt.dayTypeId === dayTypeId
          ? {
              ...dt,
              periods: dt.periods.map((p) => (p.periodId === periodId ? { ...p, ...patch } : p)),
            }
          : dt,
      ),
    }));
  }

  function removePeriod(dayTypeId: string, periodId: string) {
    setForm((f) => ({
      ...f,
      dayTypes: f.dayTypes.map((dt) =>
        dt.dayTypeId === dayTypeId
          ? {
              ...dt,
              periods: dt.periods
                .filter((p) => p.periodId !== periodId)
                .map((p, i) => ({ ...p, order: i })),
            }
          : dt,
      ),
    }));
  }

  const loading = building.loading || schedule.loading;
  const title = building.data ? `${building.data.displayName} schedule` : 'Building schedule';

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Building schedule']}
      title={title}
      subtitle="Define the bell schedule used to generate bookable observation slots. Day types group a set of class periods; the weekly pattern maps each weekday to a day type; overrides replace the pattern for specific dates."
      actions={
        <Button asChild variant="outline" className="bg-white">
          <Link to="/admin/buildings">
            <ArrowLeft className="h-4 w-4" />
            Back to buildings
          </Link>
        </Button>
      }
    >
      {loading && !schedule.data ? (
        <p className="text-muted-foreground">Loading schedule…</p>
      ) : (
        <div className="max-w-3xl space-y-8">
          {/* Day types */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Day types</h2>
              <Button variant="outline" size="sm" onClick={addDayType}>
                <Plus className="h-4 w-4" />
                Add day type
              </Button>
            </div>
            {form.dayTypes.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No day types yet. Add one (e.g. &quot;Regular&quot;, &quot;Early release&quot;).
              </p>
            ) : (
              <div className="space-y-4">
                {form.dayTypes.map((dt) => (
                  <div
                    key={dt.dayTypeId}
                    className="border-border bg-background rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        value={dt.name}
                        onChange={(e) => updateDayType(dt.dayTypeId, { name: e.target.value })}
                        placeholder="Day type name"
                        className="max-w-xs"
                      />
                      <label className="text-muted-foreground ml-2 flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={dt.isNoSchool}
                          onChange={(e) =>
                            updateDayType(dt.dayTypeId, { isNoSchool: e.target.checked })
                          }
                          className="h-4 w-4"
                        />
                        No school
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive ml-auto"
                        onClick={() => removeDayType(dt.dayTypeId)}
                        aria-label="Delete day type"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {dt.isNoSchool ? (
                      <p className="text-muted-foreground mt-3 text-xs">
                        No periods — observations cannot be scheduled on these days.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {dt.periods.map((p) => (
                          <div key={p.periodId} className="flex flex-wrap items-center gap-2">
                            <Input
                              value={p.name}
                              onChange={(e) =>
                                updatePeriod(dt.dayTypeId, p.periodId, { name: e.target.value })
                              }
                              placeholder="Period name"
                              className="w-40"
                            />
                            <Input
                              type="time"
                              value={minutesToHHMM(p.startMinute)}
                              onChange={(e) =>
                                updatePeriod(dt.dayTypeId, p.periodId, {
                                  startMinute: hhmmToMinutes(e.target.value),
                                })
                              }
                              className="w-32"
                            />
                            <span className="text-muted-foreground text-sm">to</span>
                            <Input
                              type="time"
                              value={minutesToHHMM(p.endMinute)}
                              onChange={(e) =>
                                updatePeriod(dt.dayTypeId, p.periodId, {
                                  endMinute: hhmmToMinutes(e.target.value),
                                })
                              }
                              className="w-32"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => removePeriod(dt.dayTypeId, p.periodId)}
                              aria-label="Delete period"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => addPeriod(dt.dayTypeId)}
                          className="mt-1"
                        >
                          <Plus className="h-4 w-4" />
                          Add period
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Weekly pattern */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Weekly pattern</h2>
            <p className="text-muted-foreground text-sm">
              Which day type each weekday uses by default. Saturdays and Sundays are always
              no-school.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {WEEKDAYS.map(({ key, label }) => (
                <div key={key} className="grid gap-1.5">
                  <Label>{label}</Label>
                  <select
                    value={form.weeklyPattern[key] ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        weeklyPattern: { ...f.weeklyPattern, [key]: e.target.value || null },
                      }))
                    }
                    className="border-input h-9 rounded-md border bg-white px-2 text-sm"
                  >
                    <option value="">No school</option>
                    {form.dayTypes.map((dt) => (
                      <option key={dt.dayTypeId} value={dt.dayTypeId}>
                        {dt.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>

          {/* Overrides */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Date overrides</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    overrides: [...f.overrides, { date: '', dayTypeId: null, note: '' }],
                  }))
                }
              >
                <Plus className="h-4 w-4" />
                Add override
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              Replace the weekly pattern for a specific date (holidays, in-service days, special
              schedules). Set the day type to &quot;No school&quot; to block all bookings that day.
            </p>
            {form.overrides.length === 0 ? (
              <p className="text-muted-foreground text-sm">No overrides.</p>
            ) : (
              <div className="space-y-2">
                {form.overrides.map((o, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={o.date}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.map((x, i) =>
                            i === idx ? { ...x, date: e.target.value } : x,
                          ),
                        }))
                      }
                      className="w-44"
                    />
                    <select
                      value={o.dayTypeId ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.map((x, i) =>
                            i === idx ? { ...x, dayTypeId: e.target.value || null } : x,
                          ),
                        }))
                      }
                      className="border-input h-9 rounded-md border bg-white px-2 text-sm"
                    >
                      <option value="">No school</option>
                      {form.dayTypes.map((dt) => (
                        <option key={dt.dayTypeId} value={dt.dayTypeId}>
                          {dt.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={o.note}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.map((x, i) =>
                            i === idx ? { ...x, note: e.target.value } : x,
                          ),
                        }))
                      }
                      placeholder="Note (optional)"
                      className="min-w-40 flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.filter((_, i) => i !== idx),
                        }))
                      }
                      aria-label="Delete override"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Effective bounds + active */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Effective from</Label>
              <Input
                type="date"
                value={form.effectiveFrom ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value || null }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Effective to</Label>
              <Input
                type="date"
                value={form.effectiveTo ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, effectiveTo: e.target.value || null }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4"
              />
              Schedule active
            </label>
          </section>

          {saveError ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {saveError}
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t pt-4">
            {savedAt ? (
              <p className="text-muted-foreground text-xs">
                Saved at {savedAt.toLocaleTimeString()}
              </p>
            ) : (
              <span />
            )}
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save schedule'}
            </Button>
          </div>
        </div>
      )}
    </PageHeader>
  );
}
