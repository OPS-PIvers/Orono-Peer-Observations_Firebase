import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { CheckCircle2 } from 'lucide-react';
import {
  COLLECTIONS,
  WINDOW_SUBCOLLECTIONS,
  type BookObservationSlotInput,
  type CancelBookingInput,
  type CheckSlotConflictsInput,
  type CheckSlotConflictsResult,
  type ObservationPreference,
  type ObservationSlot,
  type ObservationWindow,
  type RescheduleBookingInput,
  type SignupField,
  type SubmitDayPreferenceInput,
  type WindowInvitee,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { functions } from '@/lib/firebase';
import { SlotGrid } from './SlotGrid';
import { SignupDetailFields, buildDetailAnswers, signupFieldsComplete } from './SignupDetailFields';
import { formatLocalDateTime, formatLocalTime, formatYMD } from './slotTime';

interface BookResult {
  observationId: string;
  /** True when the admin conflict policy is 'warn' and the chosen time
   *  overlaps an event on the observer's real Google Calendar. */
  calendarConflictWarning?: boolean;
}
interface OkResult {
  ok: true;
}

const bookObservationSlotFn = httpsCallable<BookObservationSlotInput, BookResult>(
  functions,
  'bookObservationSlot',
);
const submitDayPreferenceFn = httpsCallable<SubmitDayPreferenceInput, OkResult>(
  functions,
  'submitDayPreference',
);
const cancelBookingFn = httpsCallable<CancelBookingInput, OkResult>(functions, 'cancelBooking');
const rescheduleBookingFn = httpsCallable<
  RescheduleBookingInput,
  { observationId: string | null; calendarConflictWarning?: boolean }
>(functions, 'rescheduleBooking');
const checkSlotConflictsFn = httpsCallable<CheckSlotConflictsInput, CheckSlotConflictsResult>(
  functions,
  'checkSlotConflicts',
);

const CONFLICT_WARNING_TEXT =
  "Heads up: this time overlaps an event on your observer's Google Calendar. They may reach out to adjust.";

type SlotDoc = ObservationSlot & { id: string };

const WEEKDAY_MS = 24 * 60 * 60 * 1000;

/** Build the list of eligible YYYY-MM-DD dates in [start,end] whose weekday
 *  is included. Computed at local noon to avoid DST/midnight edge cases. */
function eligibleDates(startDate: string, endDate: string, weekdays: number[]): string[] {
  if (!startDate || !endDate) return [];
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const allowed = new Set(weekdays);
  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += WEEKDAY_MS) {
    const d = new Date(t);
    if (!allowed.has(d.getDay())) continue;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${String(y)}-${m}-${day}`);
  }
  return out;
}

export function BookingPage() {
  const { windowId } = useParams<{ windowId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { user } = useAuth();
  const myEmail = user?.email?.toLowerCase() ?? '';

  const windowPath = windowId ? `${COLLECTIONS.observationWindows}/${windowId}` : '';
  const { data: windowDoc, loading: windowLoading } =
    useFirestoreDoc<ObservationWindow>(windowPath);

  const slotsPath = windowId
    ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.slots}`
    : '';
  const { data: slots } = useFirestoreCollection<ObservationSlot>(slotsPath);

  const { data: signupFields } = useFirestoreCollection<SignupField>(COLLECTIONS.signupFields);

  // Find the invitee this link belongs to: email must match the signed-in
  // user AND the per-invitee token must match the one in the URL.
  const invitee: WindowInvitee | null = useMemo(() => {
    if (!windowDoc || !token || !myEmail) return null;
    return (
      windowDoc.invitees.find(
        (inv) => inv.email.toLowerCase() === myEmail && inv.inviteToken === token,
      ) ?? null
    );
  }, [windowDoc, token, myEmail]);

  // Existing day-preference submission for this invitee (doc id = email).
  const prefPath =
    windowId && invitee
      ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.preferences}/${invitee.email}`
      : '';
  const { data: existingPref } = useFirestoreDoc<ObservationPreference>(prefPath);

  const fields = useMemo(() => signupFields ?? [], [signupFields]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  function setAnswer(fieldId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
  }

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookedConfirmation, setBookedConfirmation] = useState<string | null>(null);
  const [prefConfirmation, setPrefConfirmation] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduledNote, setRescheduledNote] = useState<string | null>(null);
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [conflictedSlotIds, setConflictedSlotIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const mode = windowDoc?.bookingMode ?? 'direct';

  // Seed the day picker from an existing (unassigned) preference.
  useEffect(() => {
    if (existingPref && !existingPref.assignedSlotId) {
      setSelectedDate(existingPref.preferredDateYMD);
    }
  }, [existingPref]);

  // Ask the server which slots collide with busy time on the observer's REAL
  // Google Calendar (freebusy) so the grid can badge them. Best-effort: any
  // failure (or `checked:false`) just means no badges.
  //
  // Keyed on a stable boolean (not the `invitee` object): every Firestore
  // snapshot of the window doc produces a new invitee identity, so depending
  // on the object would re-fire this callable — and its server-side Calendar
  // freebusy query — for every open booking page whenever ANY invitee books
  // or cancels.
  const hasInvite = invitee !== null;
  useEffect(() => {
    if (!windowId || !token || !hasInvite || mode !== 'direct') return;
    let cancelled = false;
    checkSlotConflictsFn({ windowId, inviteToken: token })
      .then((res) => {
        if (cancelled) return;
        setConflictedSlotIds(new Set(res.data.checked ? res.data.conflictedSlotIds : []));
      })
      .catch(() => {
        if (!cancelled) setConflictedSlotIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [windowId, token, hasInvite, mode]);

  // --- Loading / invalid-link guards --------------------------------------
  if (windowLoading && !windowDoc) {
    return (
      <PageHeader title="Schedule observation" variant="plain">
        <div className="grid gap-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-32 w-full" />
        </div>
      </PageHeader>
    );
  }

  if (!windowDoc || !invitee) {
    return (
      <PageHeader title="Schedule observation" variant="plain">
        <div
          role="alert"
          className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3 text-sm"
        >
          This booking link is invalid or expired. Check that you opened the link sent to your email
          while signed in to the matching account.
        </div>
      </PageHeader>
    );
  }

  const windowCancelled = windowDoc.status === 'cancelled' || windowDoc.status === 'expired';
  const myBuildingSlots = (slots ?? []).filter((s) => s.buildingId === invitee.buildingId);

  // ------------------------------------------------------------------ DIRECT
  function renderDirect() {
    if (!windowDoc || !invitee) return null;

    // Already booked: show the booked slot + Change time / Cancel buttons.
    if (invitee.bookedSlotId && !bookedConfirmation) {
      const booked: SlotDoc | undefined = (slots ?? []).find(
        (s) => s.slotId === invitee.bookedSlotId,
      );

      // 'Change time' flow: pick a new slot; signup answers carry over.
      if (rescheduling) {
        return (
          <div className="grid gap-6">
            <div className="border-border bg-ops-gray-lightest rounded-md border px-4 py-2 text-sm">
              Currently booked for{' '}
              <span className="font-medium">
                {booked ? formatLocalDateTime(booked.startUTC) : 'your reserved slot'}
              </span>
              . Pick a new time below — your signup details carry over.
            </div>
            <div className="grid gap-2">
              <Label>Pick a new time</Label>
              <SlotGrid
                slots={myBuildingSlots}
                selectedSlotId={selectedSlotId}
                onSelect={(s) => setSelectedSlotId(s.slotId)}
                disabled={submitting || windowCancelled}
                conflictedSlotIds={conflictedSlotIds}
              />
              {conflictedSlotIds.size > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Times marked &ldquo;Observer busy&rdquo; overlap events on your observer&apos;s
                  Google Calendar.
                </p>
              ) : null}
            </div>
            {selectedSlotId ? (
              <div className="border-border bg-ops-gray-lightest grid gap-3 rounded-lg border p-4">
                <p className="text-sm font-medium">Confirm your new time</p>
                <p className="text-muted-foreground text-sm">
                  {confirmTimeLabel(myBuildingSlots, selectedSlotId)}
                </p>
                <div className="flex gap-2">
                  <Button
                    disabled={submitting || windowCancelled}
                    onClick={() => void reschedule(selectedSlotId)}
                  >
                    {submitting ? 'Rescheduling…' : 'Confirm new time'}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={submitting}
                    onClick={() => setSelectedSlotId(null)}
                  >
                    Back
                  </Button>
                </div>
              </div>
            ) : null}
            <div>
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setRescheduling(false);
                  setSelectedSlotId(null);
                }}
              >
                Keep current time
              </Button>
            </div>
          </div>
        );
      }

      return (
        <div className="grid gap-4">
          <div className="border-border bg-background rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="text-ops-blue-dark mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">You&apos;re booked.</p>
                {booked ? (
                  <p className="text-muted-foreground text-sm">
                    {formatLocalDateTime(booked.startUTC)}
                    {booked.periodName ? ` · ${booked.periodName}` : ''}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">Your slot is reserved.</p>
                )}
                {rescheduledNote ? (
                  <p className="text-ops-blue-dark mt-1 text-sm">{rescheduledNote}</p>
                ) : null}
                {conflictNote ? (
                  <p className="text-ops-red-dark mt-1 text-sm">{conflictNote}</p>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={submitting || windowCancelled}
              onClick={() => {
                setRescheduling(true);
                setSelectedSlotId(null);
                setError(null);
              }}
            >
              Change time
            </Button>
            <Button
              variant="destructive"
              disabled={submitting || windowCancelled}
              onClick={() => void cancel(invitee.bookedSlotId ?? '')}
            >
              {submitting ? 'Cancelling…' : 'Cancel booking'}
            </Button>
          </div>
        </div>
      );
    }

    if (bookedConfirmation) {
      return (
        <div className="border-border bg-background rounded-lg border p-6 text-center">
          <CheckCircle2 className="text-ops-blue-dark mx-auto mb-3 h-10 w-10" />
          <p className="text-lg font-semibold">You&apos;re booked!</p>
          <p className="text-muted-foreground mt-1 text-sm">{bookedConfirmation}</p>
          {conflictNote ? <p className="text-ops-red-dark mt-2 text-sm">{conflictNote}</p> : null}
        </div>
      );
    }

    const ready =
      selectedSlotId !== null && signupFieldsComplete(fields, 'direct', answers) && !submitting;

    return (
      <div className="grid gap-6">
        <SignupDetailFields
          fields={fields}
          mode="direct"
          buildingId={invitee.buildingId}
          answers={answers}
          onChange={setAnswer}
        />
        <div className="grid gap-2">
          <Label>Pick a time</Label>
          <SlotGrid
            slots={myBuildingSlots}
            selectedSlotId={selectedSlotId}
            onSelect={(s) => setSelectedSlotId(s.slotId)}
            disabled={submitting || windowCancelled}
            conflictedSlotIds={conflictedSlotIds}
          />
          {conflictedSlotIds.size > 0 ? (
            <p className="text-muted-foreground text-xs">
              Times marked &ldquo;Observer busy&rdquo; overlap events on your observer&apos;s Google
              Calendar. You can still pick one, but it may be rejected or need adjusting.
            </p>
          ) : null}
        </div>
        {selectedSlotId ? (
          <div className="border-border bg-ops-gray-lightest grid gap-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Confirm your booking</p>
            <p className="text-muted-foreground text-sm">
              {confirmTimeLabel(myBuildingSlots, selectedSlotId)}
            </p>
            <div className="flex gap-2">
              <Button disabled={!ready} onClick={() => void book(selectedSlotId)}>
                {submitting ? 'Booking…' : 'Confirm booking'}
              </Button>
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => setSelectedSlotId(null)}
              >
                Back
              </Button>
            </div>
            {!signupFieldsComplete(fields, 'direct', answers) ? (
              <p className="text-ops-red-dark text-xs">
                Fill in the required detail fields above before confirming.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // ----------------------------------------------------------- DAY PREFERENCE
  function renderDayPreference() {
    if (!windowDoc || !invitee) return null;

    const dates = eligibleDates(windowDoc.startDate, windowDoc.endDate, windowDoc.weekdaysIncluded);

    if (prefConfirmation) {
      return (
        <div className="border-border bg-background rounded-lg border p-6 text-center">
          <CheckCircle2 className="text-ops-blue-dark mx-auto mb-3 h-10 w-10" />
          <p className="text-lg font-semibold">Preference submitted!</p>
          <p className="text-muted-foreground mt-1 text-sm">{prefConfirmation}</p>
        </div>
      );
    }

    if (existingPref?.assignedSlotId != null) {
      const assigned = (slots ?? []).find((s) => s.slotId === existingPref.assignedSlotId);
      return (
        <div className="border-border bg-background rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="text-ops-blue-dark mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Your observation time has been assigned.</p>
              {assigned ? (
                <p className="text-muted-foreground text-sm">
                  {formatLocalDateTime(assigned.startUTC)}
                  {assigned.periodName ? ` · ${assigned.periodName}` : ''}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Your time has been set by the observer.
                </p>
              )}
            </div>
          </div>
        </div>
      );
    }

    const ready =
      selectedDate !== '' &&
      signupFieldsComplete(fields, 'day-preference', answers) &&
      !submitting &&
      !windowCancelled;

    return (
      <div className="grid gap-6">
        {existingPref ? (
          <div className="border-border bg-ops-gray-lightest rounded-md border px-4 py-2 text-sm">
            You previously chose{' '}
            <span className="font-medium">{formatYMD(existingPref.preferredDateYMD)}</span>. You can
            change it below until a time is assigned.
          </div>
        ) : null}
        <SignupDetailFields
          fields={fields}
          mode="day-preference"
          buildingId={invitee.buildingId}
          answers={answers}
          onChange={setAnswer}
        />
        <div className="grid gap-2">
          <Label>Choose a day</Label>
          {dates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No eligible days in this window.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {dates.map((date) => {
                const cap = windowDoc.perDayCap;
                const used = windowDoc.dayCounts[date] ?? 0;
                const remaining = cap === null ? null : cap - used;
                const full = remaining !== null && remaining <= 0;
                const isSelected = date === selectedDate;
                return (
                  <Button
                    key={date}
                    type="button"
                    variant={isSelected ? 'default' : 'outline'}
                    size="sm"
                    disabled={full || submitting || windowCancelled}
                    onClick={() => setSelectedDate(date)}
                    className="flex-col items-start"
                  >
                    <span>{formatYMD(date)}</span>
                    {remaining !== null ? (
                      <span className="text-xs opacity-80">
                        {full ? 'Full' : `${String(remaining)} left`}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        <div>
          <Button disabled={!ready} onClick={() => void submitPreference(selectedDate)}>
            {submitting ? 'Submitting…' : existingPref ? 'Update preference' : 'Submit preference'}
          </Button>
          {!signupFieldsComplete(fields, 'day-preference', answers) ? (
            <p className="text-ops-red-dark mt-2 text-xs">
              Fill in the required detail fields above before submitting.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  // --- Actions -------------------------------------------------------------
  async function book(slotId: string) {
    if (!windowId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await bookObservationSlotFn({
        windowId,
        slotId,
        inviteToken: token,
        detailAnswers: buildDetailAnswers(fields, 'direct', answers),
      });
      const slot = (slots ?? []).find((s) => s.slotId === slotId);
      setBookedConfirmation(slot ? formatLocalDateTime(slot.startUTC) : 'Your slot is reserved.');
      setConflictNote(res.data.calendarConflictWarning ? CONFLICT_WARNING_TEXT : null);
      setSelectedSlotId(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not book that slot. It may have just been taken.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function reschedule(newSlotId: string) {
    if (!windowId || !newSlotId) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await rescheduleBookingFn({ windowId, newSlotId, inviteToken: token });
      const slot = (slots ?? []).find((s) => s.slotId === newSlotId);
      setRescheduledNote(
        slot
          ? `Your booking was moved to ${formatLocalDateTime(slot.startUTC)}.`
          : 'Your booking was moved to the new time.',
      );
      setConflictNote(res.data.calendarConflictWarning ? CONFLICT_WARNING_TEXT : null);
      setRescheduling(false);
      setSelectedSlotId(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not move your booking. The new time may have just been taken.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(slotId: string) {
    if (!windowId || !slotId) return;
    const reason = window.prompt('Cancel your booking? Optional reason:', '');
    if (reason === null) return;
    setError(null);
    setSubmitting(true);
    try {
      await cancelBookingFn({ windowId, slotId, reason: reason.trim() });
      setBookedConfirmation(null);
      setSelectedSlotId(null);
      setRescheduledNote(null);
      setConflictNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the booking.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPreference(preferredDateYMD: string) {
    if (!windowId || !preferredDateYMD) return;
    setError(null);
    setSubmitting(true);
    try {
      await submitDayPreferenceFn({
        windowId,
        inviteToken: token,
        preferredDateYMD,
        detailAnswers: buildDetailAnswers(fields, 'day-preference', answers),
      });
      setPrefConfirmation(`You requested ${formatYMD(preferredDateYMD)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your preference.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageHeader
      title="Schedule observation"
      subtitle={`Invited by ${windowDoc.observerName || windowDoc.observerEmail}`}
      variant="plain"
    >
      {windowCancelled ? (
        <div
          role="alert"
          className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3 text-sm"
        >
          This observation window has been cancelled and is no longer accepting bookings.
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          aria-live="polite"
          className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3 text-sm"
        >
          {error}
        </div>
      ) : null}
      {mode === 'direct' ? renderDirect() : renderDayPreference()}
    </PageHeader>
  );
}

function confirmTimeLabel(slots: SlotDoc[], slotId: string): string {
  const slot = slots.find((s) => s.slotId === slotId);
  if (!slot) return '';
  return `${formatYMD(slot.dateYMD)} at ${formatLocalTime(slot.startUTC)}${
    slot.periodName ? ` · ${slot.periodName}` : ''
  }`;
}
