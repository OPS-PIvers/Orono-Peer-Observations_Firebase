import { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import {
  APP_SETTINGS_DOC_ID,
  BOOKING_MODES,
  COLLECTIONS,
  DEFAULT_SCHEDULING_SETTINGS,
  OBSERVATION_TYPES,
  type AppSettings,
  type BookingMode,
  type Building,
  type CreateObservationWindowInput,
  type ObservationType,
  type Role,
  type SignupField,
  type Staff,
} from '@ops/shared';
import { functions } from '@/lib/firebase';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { yearLabel } from '@/utils/staffFormatting';
import { StaffFilterBar, EMPTY_FILTERS, type StaffFilters } from '@/admin/staff/StaffFilterBar';

interface CreateObservationWindowResult {
  windowId: string;
  slotCount: number;
  inviteeCount: number;
}

const createObservationWindowFn = httpsCallable<
  CreateObservationWindowInput,
  CreateObservationWindowResult
>(functions, 'createObservationWindow');

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
] as const;

function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function hhmmToMinutes(value: string): number {
  const parts = value.split(':');
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export interface CreateObservationWindowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (windowId: string) => void;
}

export function CreateObservationWindowDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateObservationWindowDialogProps) {
  const { data: settingsDoc } = useFirestoreDoc<AppSettings>(SETTINGS_PATH);
  const settings = settingsDoc?.scheduling ?? DEFAULT_SCHEDULING_SETTINGS;

  const { data: staff } = useFirestoreCollection<Staff>(COLLECTIONS.staff);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: buildings } = useFirestoreCollection<Building>(COLLECTIONS.buildings);
  const { data: signupFields } = useFirestoreCollection<SignupField>(COLLECTIONS.signupFields);

  // Map building display name -> buildingId slug (staff.buildings holds names).
  const buildingIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of buildings ?? []) map.set(b.displayName, b.buildingId);
    return map;
  }, [buildings]);

  // --- Window config state -------------------------------------------------
  const [bookingMode, setBookingMode] = useState<BookingMode>(settings.defaultBookingMode);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>(settings.defaultWeekdays);
  const [earliestMinute, setEarliestMinute] = useState(settings.defaultEarliestMinute);
  const [latestMinute, setLatestMinute] = useState(settings.defaultLatestMinute);
  const [travelBuffer, setTravelBuffer] = useState(settings.travelBufferMinutes);
  const [perDayCap, setPerDayCap] = useState<number | null>(settings.defaultPerDayCap);
  const [selectedFieldIds, setSelectedFieldIds] = useState<Set<string>>(new Set());
  const [observationType, setObservationType] = useState<ObservationType>(
    OBSERVATION_TYPES.standard,
  );
  const [observationName, setObservationName] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [gcalSendUpdates, setGcalSendUpdates] = useState<'none' | 'all'>(settings.gcalSendUpdates);

  // --- Invitee picker state ------------------------------------------------
  const [filters, setFilters] = useState<StaffFilters>(EMPTY_FILTERS);
  // selected staff email -> chosen building display name (which schedule).
  const [selected, setSelected] = useState<Map<string, string>>(new Map());

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens, seeding from current settings.
  useEffect(() => {
    if (!open) return;
    const allowed = settings.allowedBookingModes;
    const initialMode = allowed.includes(settings.defaultBookingMode)
      ? settings.defaultBookingMode
      : (allowed[0] ?? 'direct');
    setBookingMode(initialMode);
    setStartDate('');
    setEndDate('');
    setWeekdays(settings.defaultWeekdays);
    setEarliestMinute(settings.defaultEarliestMinute);
    setLatestMinute(settings.defaultLatestMinute);
    setTravelBuffer(settings.travelBufferMinutes);
    setPerDayCap(settings.defaultPerDayCap);
    setSelectedFieldIds(new Set());
    setObservationType(OBSERVATION_TYPES.standard);
    setObservationName('');
    setEventTitle('');
    setEventDescription('');
    setGcalSendUpdates(settings.gcalSendUpdates);
    setFilters(EMPTY_FILTERS);
    setSelected(new Map());
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed only on open
  }, [open]);

  const allowedModes = settings.allowedBookingModes;

  // Sign-up fields applicable to the chosen mode ('both' always matches).
  const applicableFields = useMemo(() => {
    return (signupFields ?? [])
      .filter((f) => f.isActive && (f.appliesTo === 'both' || f.appliesTo === bookingMode))
      .sort((a, b) => a.order - b.order);
  }, [signupFields, bookingMode]);

  // Drop selected field ids that no longer apply when the mode changes.
  useEffect(() => {
    setSelectedFieldIds((prev) => {
      const valid = new Set(applicableFields.map((f) => f.fieldId));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [applicableFields]);

  // Filtered staff (mirrors StaffFilters semantics across all buildings).
  const filteredStaff = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return (staff ?? []).filter((s) => {
      if (filters.status === 'active' && !s.isActive) return false;
      if (filters.status === 'inactive' && s.isActive) return false;
      if (filters.roles.size > 0 && !filters.roles.has(s.role)) return false;
      if (filters.years.size > 0 && !filters.years.has(s.year)) return false;
      if (filters.buildings.size > 0 && !s.buildings.some((b) => filters.buildings.has(b)))
        return false;
      if (q) {
        const matches =
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          s.role.toLowerCase().includes(q) ||
          s.buildings.some((b) => b.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [staff, filters]);

  const allFilteredSelected =
    filteredStaff.length > 0 && filteredStaff.every((s) => selected.has(s.email.toLowerCase()));
  const someFilteredSelected = filteredStaff.some((s) => selected.has(s.email.toLowerCase()));

  function toggleStaff(s: Staff) {
    const key = s.email.toLowerCase();
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, s.buildings[0] ?? '');
      }
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allFilteredSelected) {
        for (const s of filteredStaff) next.delete(s.email.toLowerCase());
      } else {
        for (const s of filteredStaff) {
          const key = s.email.toLowerCase();
          if (!next.has(key)) next.set(key, s.buildings[0] ?? '');
        }
      }
      return next;
    });
  }

  function setInviteeBuilding(email: string, buildingName: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.set(email.toLowerCase(), buildingName);
      return next;
    });
  }

  function toggleWeekday(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  function toggleField(fieldId: string) {
    setSelectedFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  }

  // Resolve each selected staff to an invitee with a buildingId slug.
  const staffByEmail = useMemo(() => {
    const map = new Map<string, Staff>();
    for (const s of staff ?? []) map.set(s.email.toLowerCase(), s);
    return map;
  }, [staff]);

  const resolvedInvitees = useMemo(() => {
    return [...selected.entries()].map(([email, buildingName]) => {
      const s = staffByEmail.get(email);
      const buildingId = buildingName ? (buildingIdByName.get(buildingName) ?? null) : null;
      return { email, staff: s, buildingName, buildingId };
    });
  }, [selected, staffByEmail, buildingIdByName]);

  const unresolved = resolvedInvitees.filter((i) => !i.buildingId);

  const canSubmit =
    !submitting &&
    selected.size > 0 &&
    unresolved.length === 0 &&
    startDate !== '' &&
    endDate !== '' &&
    weekdays.length > 0;

  async function submit() {
    setError(null);
    if (startDate === '' || endDate === '') {
      setError('Pick a start and end date.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    if (weekdays.length === 0) {
      setError('Select at least one weekday.');
      return;
    }
    if (latestMinute <= earliestMinute) {
      setError('Latest time must be after the earliest time.');
      return;
    }
    if (selected.size === 0) {
      setError('Select at least one invitee.');
      return;
    }
    if (unresolved.length > 0) {
      setError('Resolve the building for every invitee before submitting.');
      return;
    }

    const invitees = resolvedInvitees
      .filter((i): i is typeof i & { buildingId: string } => i.buildingId !== null)
      .map((i) => ({ email: i.email, buildingId: i.buildingId }));

    const input: CreateObservationWindowInput = {
      bookingMode,
      startDate,
      endDate,
      weekdaysIncluded: weekdays,
      earliestMinute,
      latestMinute,
      travelBufferMinutes: travelBuffer,
      perDayCap: bookingMode === 'day-preference' ? perDayCap : null,
      signupFieldIds: [...selectedFieldIds],
      defaultObservationType: observationType,
      defaultObservationName: observationName.trim(),
      calendarEventTitle: eventTitle.trim(),
      calendarEventDescription: eventDescription.trim(),
      gcalSendUpdates,
      invitees,
    };

    setSubmitting(true);
    try {
      const res = await createObservationWindowFn(input);
      onOpenChange(false);
      onCreated(res.data.windowId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create observation window.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open observation window</DialogTitle>
          <DialogDescription>
            Invite staff across buildings to schedule an observation within a date range.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-2">
          {/* Booking mode */}
          <div className="grid gap-2">
            <Label htmlFor="window-mode">Booking mode</Label>
            <select
              id="window-mode"
              value={bookingMode}
              onChange={(e) => setBookingMode(e.target.value as BookingMode)}
              className="border-input bg-background h-11 rounded-md border px-3 text-sm"
            >
              {BOOKING_MODES.filter((m) => allowedModes.includes(m)).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="window-start">Start date</Label>
              <Input
                id="window-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="window-end">End date</Label>
              <Input
                id="window-end"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Weekdays */}
          <div className="grid gap-2">
            <Label>Weekdays included</Label>
            <div className="flex flex-wrap gap-3">
              {DOW.map((d) => (
                <label key={d.value} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={weekdays.includes(d.value)}
                    onChange={() => toggleWeekday(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </div>

          {/* Time of day */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="window-earliest">Earliest time</Label>
              <Input
                id="window-earliest"
                type="time"
                value={minutesToHHMM(earliestMinute)}
                onChange={(e) => setEarliestMinute(hhmmToMinutes(e.target.value))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="window-latest">Latest time</Label>
              <Input
                id="window-latest"
                type="time"
                value={minutesToHHMM(latestMinute)}
                onChange={(e) => setLatestMinute(hhmmToMinutes(e.target.value))}
              />
            </div>
          </div>

          {/* Buffer + per-day cap */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="window-buffer">Travel buffer (minutes)</Label>
              <Input
                id="window-buffer"
                type="number"
                min={0}
                max={240}
                value={travelBuffer}
                onChange={(e) => setTravelBuffer(Math.max(0, Number(e.target.value) || 0))}
              />
            </div>
            {bookingMode === 'day-preference' ? (
              <div className="grid gap-2">
                <Label htmlFor="window-cap">Per-day cap (blank = uncapped)</Label>
                <Input
                  id="window-cap"
                  type="number"
                  min={1}
                  value={perDayCap ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPerDayCap(v === '' ? null : Math.max(1, Number(v) || 1));
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Sign-up fields */}
          <div className="grid gap-2">
            <Label>Sign-up fields</Label>
            {applicableFields.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No active sign-up fields apply to this mode.
              </p>
            ) : (
              <div className="grid gap-2">
                {applicableFields.map((f) => (
                  <label key={f.fieldId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedFieldIds.has(f.fieldId)}
                      onChange={() => toggleField(f.fieldId)}
                    />
                    {f.label}
                    {f.required ? (
                      <span className="text-muted-foreground text-xs">(required)</span>
                    ) : null}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Defaults */}
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="window-obs-type">Default observation type</Label>
              <select
                id="window-obs-type"
                value={observationType}
                onChange={(e) => setObservationType(e.target.value as ObservationType)}
                className="border-input bg-background h-11 rounded-md border px-3 text-sm"
              >
                <option value={OBSERVATION_TYPES.standard}>Standard observation</option>
                <option value={OBSERVATION_TYPES.workProduct}>Work product</option>
                <option value={OBSERVATION_TYPES.instructionalRound}>Instructional round</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="window-obs-name">Default observation name (optional)</Label>
              <Input
                id="window-obs-name"
                value={observationName}
                onChange={(e) => setObservationName(e.target.value)}
                placeholder="e.g. Fall round"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="window-event-title">Calendar event title</Label>
              <Input
                id="window-event-title"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                placeholder="e.g. Peer observation"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="window-event-desc">Calendar event description</Label>
              <Textarea
                id="window-event-desc"
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="window-gcal">Google Calendar invites</Label>
              <select
                id="window-gcal"
                value={gcalSendUpdates}
                onChange={(e) => setGcalSendUpdates(e.target.value as 'none' | 'all')}
                className="border-input bg-background h-11 rounded-md border px-3 text-sm"
              >
                <option value="none">Don&apos;t send native invites</option>
                <option value="all">Send native invites to attendees</option>
              </select>
            </div>
          </div>

          {/* Invitee picker */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Invitees</Label>
              <span className="text-muted-foreground text-sm">{selected.size} selected</span>
            </div>
            <StaffFilterBar
              filters={filters}
              onChange={setFilters}
              roles={roles}
              buildings={buildings}
            />
            <div className="border-border bg-background max-h-72 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-ops-gray-lightest sticky top-0">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left">
                      <Checkbox
                        aria-label="Select all filtered"
                        checked={allFilteredSelected}
                        indeterminate={someFilteredSelected && !allFilteredSelected}
                        onChange={toggleSelectAllFiltered}
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Year</th>
                    <th className="px-3 py-2 text-left font-semibold">Building (schedule)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-muted-foreground py-6 text-center">
                        No staff match those filters.
                      </td>
                    </tr>
                  ) : (
                    filteredStaff.map((s) => {
                      const key = s.email.toLowerCase();
                      const isSelected = selected.has(key);
                      const chosenBuilding = selected.get(key) ?? '';
                      const resolvedId = chosenBuilding
                        ? buildingIdByName.get(chosenBuilding)
                        : undefined;
                      return (
                        <tr key={s.id} className="border-border border-t">
                          <td className="px-3 py-2">
                            <Checkbox
                              aria-label={`Select ${s.name}`}
                              checked={isSelected}
                              onChange={() => toggleStaff(s)}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{s.name}</div>
                            <div className="text-muted-foreground text-xs">{s.email}</div>
                          </td>
                          <td className="px-3 py-2">{yearLabel(s.year)}</td>
                          <td className="px-3 py-2">
                            {!isSelected ? (
                              <span className="text-muted-foreground text-xs">
                                {s.buildings.join(', ') || '—'}
                              </span>
                            ) : s.buildings.length > 1 ? (
                              <select
                                value={chosenBuilding}
                                onChange={(e) => setInviteeBuilding(s.email, e.target.value)}
                                className="border-input bg-background h-9 rounded-md border px-2 text-xs"
                              >
                                {s.buildings.map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs">{chosenBuilding || '—'}</span>
                            )}
                            {isSelected && !resolvedId ? (
                              <div className="text-ops-red-dark mt-1 text-xs">
                                No matching building — booking blocked.
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {unresolved.length > 0 ? (
              <div
                role="alert"
                className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
              >
                {String(unresolved.length)} invitee(s) have no resolvable building. Fix or deselect
                them before submitting.
              </div>
            ) : null}
          </div>

          {error ? (
            <div
              role="alert"
              aria-live="polite"
              className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm"
            >
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? 'Opening…' : 'Open window'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
