import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarClock, CalendarPlus, History, Plus, Trash2 } from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  orderBy,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  BUILDING_SCHEDULE_DRAFT_DOC_ID,
  BUILDING_SCHEDULE_SUBCOLLECTIONS,
  COLLECTIONS,
  type Building,
  type BuildingSchedule,
  type BuildingScheduleVersion,
  type ScheduleDateOverride,
  type ScheduleDayType,
  type SchedulePeriod,
  type ScheduleWeeklyPattern,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/PageHeader';

/** Local form-only wrapper giving each override a stable key so React can
 *  track rows correctly across remove-from-middle edits (list `key` must
 *  not be the array index — see docs/CODEBASE_AUDIT.md P2 "index-as-key").
 *  The persisted shape (`ScheduleDateOverride`) is unchanged; `key` is
 *  stripped again on save. */
interface OverrideEntry {
  key: string;
  value: ScheduleDateOverride;
}

interface ScheduleForm {
  timeZone: string;
  dayTypes: ScheduleDayType[];
  weeklyPattern: ScheduleWeeklyPattern;
  overrides: OverrideEntry[];
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

/** `2025-08-25` → `2026-08-25`. Feb 29 lands on Feb 28 (no next-year leap
 *  equivalent). Null/unparseable values pass through untouched. */
function shiftDateOneYear(date: string | null): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const [, y, mo, d] = m ?? [];
  if (!y || !mo || !d) return date;
  const monthDay = mo === '02' && d === '29' ? '02-28' : `${mo}-${d}`;
  return `${String(Number(y) + 1)}-${monthDay}`;
}

/** Academic-year label from effective bounds, e.g. "2025–2026". */
function yearLabel(from: string | null, to: string | null, fallback: string): string {
  const fy = from ? from.slice(0, 4) : null;
  const ty = to ? to.slice(0, 4) : null;
  if (fy && ty) return fy === ty ? fy : `${fy}–${ty}`;
  return fy ?? ty ?? fallback;
}

function formatVersionDate(value: BuildingScheduleVersion['createdAt']): string {
  // Firestore Timestamp objects have a toDate() method; Date objects work
  // directly. The schema types value as Date but runtime data may be either.
  const raw = value as unknown;
  const date =
    raw instanceof Date
      ? raw
      : typeof raw === 'object' && raw !== null && 'toDate' in raw
        ? (raw as { toDate: () => Date }).toDate()
        : null;
  if (!date) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** The schedule "content" fields — everything except id/timestamps/version
 *  metadata — used when snapshotting the live doc into an archive version. */
function scheduleContentFields(
  src: BuildingSchedule,
): Pick<
  BuildingSchedule,
  | 'buildingId'
  | 'timeZone'
  | 'dayTypes'
  | 'weeklyPattern'
  | 'overrides'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'isActive'
> {
  return {
    buildingId: src.buildingId,
    timeZone: src.timeZone,
    dayTypes: src.dayTypes,
    weeklyPattern: src.weeklyPattern,
    overrides: src.overrides,
    effectiveFrom: src.effectiveFrom,
    effectiveTo: src.effectiveTo,
    isActive: src.isActive,
  };
}

export function BuildingSchedulePage() {
  const { buildingId = '' } = useParams<{ buildingId: string }>();
  const { user } = useAuth();
  const building = useFirestoreDoc<Building>(
    buildingId ? `${COLLECTIONS.buildings}/${buildingId}` : '',
  );
  const schedulePath = buildingId ? `${COLLECTIONS.buildingSchedules}/${buildingId}` : '';
  const schedule = useFirestoreDoc<BuildingSchedule>(schedulePath);

  // Archived year snapshots + the staged next-year draft. The live doc
  // (doc id = buildingId) stays the only thing slot generation reads.
  const versionsPath = buildingId
    ? `${COLLECTIONS.buildingSchedules}/${buildingId}/${BUILDING_SCHEDULE_SUBCOLLECTIONS.versions}`
    : '';
  const versions = useFirestoreCollection<BuildingScheduleVersion>(versionsPath, [
    orderBy('createdAt', 'desc'),
  ]);
  const draftVersion = versions.data?.find((v) => v.status === 'draft') ?? null;
  const archivedVersions = versions.data?.filter((v) => v.status === 'archived') ?? [];

  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // Which document the editor below is bound to. 'draft' is only reachable
  // once a draft version exists; navigating to another building resets to
  // the live schedule.
  const [editTarget, setEditTarget] = useState<'live' | 'draft'>('live');
  const [showPrepare, setShowPrepare] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [showActivate, setShowActivate] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  useEffect(() => {
    setEditTarget('live');
    setConfirmingDiscard(false);
    setSaveError(null);
    setSavedAt(null);
  }, [buildingId]);

  const activeDraft = editTarget === 'draft' ? draftVersion : null;
  const editingDraft = activeDraft !== null;

  useHydratedDraft(
    activeDraft ? activeDraft.id : (schedule.data?.id ?? null),
    activeDraft ?? schedule.data,
    (src) => {
      setForm({
        timeZone: src.timeZone,
        dayTypes: src.dayTypes,
        weeklyPattern: src.weeklyPattern,
        overrides: src.overrides.map((value) => ({ key: newId('ov'), value })),
        effectiveFrom: src.effectiveFrom,
        effectiveTo: src.effectiveTo,
        isActive: src.isActive,
      });
    },
  );

  function switchTarget(target: 'live' | 'draft') {
    setConfirmingDiscard(false);
    setSaveError(null);
    setSavedAt(null);
    setEditTarget(target);
  }

  function validatePeriodBounds() {
    for (const dt of form.dayTypes) {
      for (const p of dt.periods) {
        if (p.endMinute <= p.startMinute) {
          throw new Error(`Period "${p.name || dt.name}" must end after it starts.`);
        }
      }
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Validate period bounds before writing.
      validatePeriodBounds();
      const targetPath = editingDraft
        ? `${versionsPath}/${BUILDING_SCHEDULE_DRAFT_DOC_ID}`
        : schedulePath;
      await setDoc(
        doc(db, targetPath),
        {
          buildingId,
          timeZone: form.timeZone,
          dayTypes: form.dayTypes,
          weeklyPattern: form.weeklyPattern,
          overrides: form.overrides.map((entry) => entry.value),
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo,
          isActive: form.isActive,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
          ...(editingDraft || schedule.data ? {} : { createdAt: serverTimestamp() }),
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

  /** "Prepare next year": archive a snapshot of the live schedule, then stage
   *  an editable draft with the day types/weekly pattern copied, overrides
   *  (holidays, special days) cleared, and effective dates shifted one year.
   *  The live doc is untouched, so slot generation is undisturbed. */
  async function prepareNextYear() {
    const live = schedule.data;
    if (!live || !buildingId) return;
    setPreparing(true);
    setPrepareError(null);
    try {
      const nextFrom = shiftDateOneYear(live.effectiveFrom);
      const nextTo = shiftDateOneYear(live.effectiveTo);
      const batch = writeBatch(db);
      batch.set(doc(collection(db, versionsPath)), {
        ...scheduleContentFields(live),
        status: 'archived',
        label: yearLabel(
          live.effectiveFrom,
          live.effectiveTo,
          `Snapshot ${new Date().toISOString().slice(0, 10)}`,
        ),
        createdBy: user?.email ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, versionsPath, BUILDING_SCHEDULE_DRAFT_DOC_ID), {
        buildingId,
        timeZone: live.timeZone,
        dayTypes: live.dayTypes,
        weeklyPattern: live.weeklyPattern,
        overrides: [],
        effectiveFrom: nextFrom,
        effectiveTo: nextTo,
        isActive: live.isActive,
        status: 'draft',
        label: yearLabel(nextFrom, nextTo, 'Next year'),
        createdBy: user?.email ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setShowPrepare(false);
      switchTarget('draft');
    } catch (err) {
      setPrepareError(err instanceof Error ? err.message : 'Could not create the draft');
    } finally {
      setPreparing(false);
    }
  }

  /** Activate the draft: archive the outgoing live schedule, overwrite the
   *  live doc (same doc id = buildingId, so the slot-generation contract is
   *  unchanged) with what's in the editor, and delete the draft. One atomic
   *  batch — the onBuildingScheduleWritten trigger then reconciles slots. */
  async function activateDraft() {
    if (!draftVersion || !buildingId) return;
    setActivating(true);
    setActivateError(null);
    try {
      validatePeriodBounds();
      const live = schedule.data;
      const batch = writeBatch(db);
      if (live) {
        batch.set(doc(collection(db, versionsPath)), {
          ...scheduleContentFields(live),
          status: 'archived',
          label: yearLabel(
            live.effectiveFrom,
            live.effectiveTo,
            `Snapshot ${new Date().toISOString().slice(0, 10)}`,
          ),
          createdBy: user?.email ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.set(
        doc(db, schedulePath),
        {
          buildingId,
          timeZone: form.timeZone,
          dayTypes: form.dayTypes,
          weeklyPattern: form.weeklyPattern,
          overrides: form.overrides.map((entry) => entry.value),
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo,
          isActive: form.isActive,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email ?? null,
          ...(live ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
      batch.delete(doc(db, versionsPath, BUILDING_SCHEDULE_DRAFT_DOC_ID));
      await batch.commit();
      setShowActivate(false);
      switchTarget('live');
      setSavedAt(new Date());
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : 'Activation failed');
    } finally {
      setActivating(false);
    }
  }

  async function discardDraft() {
    if (!buildingId) return;
    setDiscarding(true);
    setDiscardError(null);
    try {
      await deleteDoc(doc(db, versionsPath, BUILDING_SCHEDULE_DRAFT_DOC_ID));
      switchTarget('live');
    } catch (err) {
      setDiscardError(err instanceof Error ? err.message : 'Discard failed');
    } finally {
      setDiscarding(false);
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
      overrides: f.overrides.map((entry) =>
        entry.value.dayTypeId === id
          ? { ...entry, value: { ...entry.value, dayTypeId: null } }
          : entry,
      ),
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
  const live = schedule.data;
  const currentLabel = live
    ? yearLabel(live.effectiveFrom, live.effectiveTo, 'the current year')
    : '';
  const nextFrom = live ? shiftDateOneYear(live.effectiveFrom) : null;
  const nextTo = live ? shiftDateOneYear(live.effectiveTo) : null;
  const nextLabel = yearLabel(nextFrom, nextTo, 'next year');

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Building schedule']}
      title={title}
      subtitle="Define the bell schedule used to generate bookable observation slots. Day types group a set of class periods; the weekly pattern maps each weekday to a day type; overrides replace the pattern for specific dates."
      actions={
        <div className="flex flex-wrap gap-2">
          {live && !draftVersion ? (
            <Button variant="outline" className="bg-white" onClick={() => setShowPrepare(true)}>
              <CalendarPlus className="h-4 w-4" />
              Prepare next year
            </Button>
          ) : null}
          <Button asChild variant="outline" className="bg-white">
            <Link to="/admin/buildings">
              <ArrowLeft className="h-4 w-4" />
              Back to buildings
            </Link>
          </Button>
        </div>
      }
    >
      {loading && !schedule.data ? (
        <p className="text-muted-foreground">Loading schedule…</p>
      ) : (
        <div className="max-w-3xl space-y-8">
          {/* Draft lifecycle banner */}
          {draftVersion ? (
            <div className="border-ops-blue bg-ops-blue-lighter text-ops-blue-dark rounded-md border-l-4 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <CalendarClock className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {editingDraft
                      ? `Editing the ${draftVersion.label} draft schedule`
                      : `A draft schedule for ${draftVersion.label} is staged`}
                  </p>
                  <p className="text-xs">
                    {editingDraft
                      ? 'Draft changes never affect booking slots until you activate the draft.'
                      : 'The live schedule below keeps generating booking slots until the draft is activated.'}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap gap-2">
                  {editingDraft ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        onClick={() => switchTarget('live')}
                      >
                        View live schedule
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setConfirmingDiscard(true)}
                      >
                        Discard draft
                      </Button>
                      <Button size="sm" onClick={() => setShowActivate(true)}>
                        Activate draft
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={() => switchTarget('draft')}
                    >
                      Edit draft
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs opacity-80">
                Switching between the live schedule and the draft discards unsaved edits.
              </p>
              {confirmingDiscard ? (
                <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mt-3 rounded-md border-l-4 px-3 py-2 text-sm">
                  <p className="mb-2">
                    Permanently delete the <strong>{draftVersion.label}</strong> draft? The live
                    schedule and archived snapshots are unaffected.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void discardDraft()}
                      disabled={discarding}
                    >
                      Yes, discard
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingDiscard(false)}
                      disabled={discarding}
                    >
                      Cancel
                    </Button>
                  </div>
                  {discardError ? <p className="mt-2">{discardError}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

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
                    overrides: [
                      ...f.overrides,
                      { key: newId('ov'), value: { date: '', dayTypeId: null, note: '' } },
                    ],
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
                {form.overrides.map((entry) => (
                  <div key={entry.key} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={entry.value.date}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.map((x) =>
                            x.key === entry.key
                              ? { ...x, value: { ...x.value, date: e.target.value } }
                              : x,
                          ),
                        }))
                      }
                      className="w-44"
                    />
                    <select
                      value={entry.value.dayTypeId ?? ''}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.map((x) =>
                            x.key === entry.key
                              ? { ...x, value: { ...x.value, dayTypeId: e.target.value || null } }
                              : x,
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
                      value={entry.value.note}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          overrides: f.overrides.map((x) =>
                            x.key === entry.key
                              ? { ...x, value: { ...x.value, note: e.target.value } }
                              : x,
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
                          overrides: f.overrides.filter((x) => x.key !== entry.key),
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
              {saving ? 'Saving…' : editingDraft ? 'Save draft' : 'Save schedule'}
            </Button>
          </div>

          {/* Schedule history */}
          <section className="space-y-3 border-t pt-6">
            <div className="flex items-center gap-2">
              <History className="text-muted-foreground h-4 w-4" />
              <h2 className="text-lg font-semibold">Schedule history</h2>
            </div>
            <p className="text-muted-foreground text-sm">
              Read-only snapshots archived automatically when you prepare or activate a new
              year&apos;s schedule.
            </p>
            {archivedVersions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No archived schedules yet. Use &quot;Prepare next year&quot; to stage next
                year&apos;s schedule — a snapshot of the current one is archived at the same time.
              </p>
            ) : (
              <ul className="space-y-2">
                {archivedVersions.map((v) => (
                  <li
                    key={v.id}
                    className="border-border bg-background rounded-lg border px-4 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium">{v.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {v.effectiveFrom ?? 'No start'} → {v.effectiveTo ?? 'no end'}
                      </span>
                      <span className="text-muted-foreground ml-auto text-xs">
                        Archived {formatVersionDate(v.createdAt)}
                        {v.createdBy ? ` by ${v.createdBy}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Prepare next year dialog */}
          <Dialog open={showPrepare} onOpenChange={setShowPrepare}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Prepare next year&apos;s schedule</DialogTitle>
                <DialogDescription>
                  Stage next year&apos;s bell schedule and holiday calendar without disturbing the
                  current one.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2 text-sm">
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>
                    A read-only snapshot of the current schedule ({currentLabel}) is saved to this
                    building&apos;s schedule history.
                  </li>
                  <li>
                    A draft for <strong>{nextLabel}</strong> is created: day types and the weekly
                    pattern are copied, date overrides (holidays, special days) are cleared, and the
                    effective dates shift one year
                    {nextFrom ? ` (${nextFrom} → ${nextTo ?? 'no end'})` : ''}.
                  </li>
                  <li>
                    The live schedule keeps generating booking slots unchanged until you activate
                    the draft.
                  </li>
                </ul>
                {prepareError ? (
                  <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2">
                    {prepareError}
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowPrepare(false)}
                  type="button"
                  disabled={preparing}
                >
                  Cancel
                </Button>
                <Button onClick={() => void prepareNextYear()} disabled={preparing}>
                  {preparing ? 'Preparing…' : 'Create draft'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Activate draft dialog */}
          <Dialog open={showActivate} onOpenChange={setShowActivate}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Activate draft schedule</DialogTitle>
                <DialogDescription>
                  Make {draftVersion?.label ?? 'the draft'} the live schedule for this building.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2 text-sm">
                <ul className="list-disc space-y-1.5 pl-5">
                  <li>
                    A read-only snapshot of the outgoing live schedule ({currentLabel}) is saved to
                    this building&apos;s schedule history.
                  </li>
                  <li>
                    The schedule shown in the editor — including any unsaved edits — replaces the
                    live schedule, and the draft is removed.
                  </li>
                  <li>
                    Existing observation windows are reconciled against the new schedule right away:
                    open slots that no longer fit are removed, and bookings whose time changed are
                    flagged and affected staff notified.
                  </li>
                </ul>
                {activateError ? (
                  <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2">
                    {activateError}
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowActivate(false)}
                  type="button"
                  disabled={activating}
                >
                  Cancel
                </Button>
                <Button onClick={() => void activateDraft()} disabled={activating}>
                  {activating ? 'Activating…' : 'Activate'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </PageHeader>
  );
}
