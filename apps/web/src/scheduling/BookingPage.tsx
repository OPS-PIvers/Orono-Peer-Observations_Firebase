import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { CalendarX, CheckCircle2 } from 'lucide-react';
import {
  APP_SETTINGS_DOC_ID,
  COLLECTIONS,
  WINDOW_SUBCOLLECTIONS,
  type AppSettings,
  type BookObservationSlotInput,
  type CalendarConnectionStatusResult,
  type CancelBookingInput,
  type ObservationPreference,
  type ObservationSlot,
  type ObservationWindow,
  type SignupField,
  type SubmitDayPreferenceInput,
  type WindowInvitee,
  type WithdrawDayPreferenceInput,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { functions } from '@/lib/firebase';
import { beginCalendarConnect } from './connectCalendar';
import { SlotGrid } from './SlotGrid';
import {
  SignupDetailFields,
  buildDetailAnswers,
  signupFieldsComplete,
  windowSignupFields,
} from './SignupDetailFields';
import { formatLocalDateTime, formatLocalTime, formatYMD } from './slotTime';

interface BookResult {
  observationId: string;
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
const withdrawDayPreferenceFn = httpsCallable<WithdrawDayPreferenceInput, OkResult>(
  functions,
  'withdrawDayPreference',
);
const getCalendarConnectionStatusFn = httpsCallable<
  Record<string, never>,
  CalendarConnectionStatusResult
>(functions, 'getCalendarConnectionStatus');

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
  const location = useLocation();

  const windowPath = windowId ? `${COLLECTIONS.observationWindows}/${windowId}` : '';
  const { data: windowDoc, loading: windowLoading } =
    useFirestoreDoc<ObservationWindow>(windowPath);

  const slotsPath = windowId
    ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.slots}`
    : '';
  const { data: slots } = useFirestoreCollection<ObservationSlot>(slotsPath);

  const { data: signupFields } = useFirestoreCollection<SignupField>(COLLECTIONS.signupFields);

  const { data: appSettings } = useFirestoreDoc<AppSettings>(
    `${COLLECTIONS.appSettings}/${APP_SETTINGS_DOC_ID}`,
  );
  const requireCalendarConnect = appSettings?.scheduling.requireCalendarConnect ?? false;

  // Proactively check whether this staff member has a connected Google Calendar
  // when the admin setting is on. We fetch once on mount (no live-listener
  // needed — status only changes via the OAuth callback, which is a separate
  // page load). While the check is in-flight we treat the status as unknown
  // (null) and avoid blocking the UI unnecessarily.
  const [calendarStatus, setCalendarStatus] = useState<
    CalendarConnectionStatusResult['status'] | null
  >(null);
  const [calendarStatusLoading, setCalendarStatusLoading] = useState(false);

  useEffect(() => {
    if (!requireCalendarConnect || !myEmail) return;
    setCalendarStatusLoading(true);
    getCalendarConnectionStatusFn({})
      .then(({ data }) => {
        setCalendarStatus(data.status);
      })
      .catch(() => {
        // Non-fatal: if we can't load the status, fall through and let the
        // server enforce the requirement on submit.
        setCalendarStatus(null);
      })
      .finally(() => {
        setCalendarStatusLoading(false);
      });
  }, [requireCalendarConnect, myEmail]);

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

  // Only the fields the PE selected for this window — never the whole
  // collection. The callables reject answers to unselected fields, so
  // rendering (or required-gating on) them would make submission impossible.
  const fields = useMemo(
    () => windowSignupFields(signupFields ?? [], windowDoc?.signupFieldIds ?? []),
    [signupFields, windowDoc],
  );
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

  const mode = windowDoc?.bookingMode ?? 'direct';

  // Seed the day picker from an existing (unassigned) preference.
  useEffect(() => {
    if (existingPref && !existingPref.assignedSlotId) {
      setSelectedDate(existingPref.preferredDateYMD);
    }
  }, [existingPref]);

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

    // Already booked: show the booked slot + a Cancel button.
    if (invitee.bookedSlotId && !bookedConfirmation) {
      const booked: SlotDoc | undefined = (slots ?? []).find(
        (s) => s.slotId === invitee.bookedSlotId,
      );
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
              </div>
            </div>
          </div>
          <div>
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
          />
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
        <div className="grid gap-4">
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
          <div>
            <Button
              variant="destructive"
              disabled={submitting || windowCancelled}
              onClick={() => void cancel(existingPref.assignedSlotId ?? '')}
            >
              {submitting ? 'Cancelling…' : 'Cancel booking'}
            </Button>
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
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-2">
            <Button disabled={!ready} onClick={() => void submitPreference(selectedDate)}>
              {submitting
                ? 'Submitting…'
                : existingPref
                  ? 'Update preference'
                  : 'Submit preference'}
            </Button>
            {existingPref ? (
              <Button
                variant="destructive"
                disabled={submitting || windowCancelled}
                onClick={() => void withdrawPreference()}
              >
                {submitting ? 'Withdrawing…' : 'Withdraw preference'}
              </Button>
            ) : null}
          </div>
          {!signupFieldsComplete(fields, 'day-preference', answers) ? (
            <p className="text-ops-red-dark text-xs">
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
      await bookObservationSlotFn({
        windowId,
        slotId,
        inviteToken: token,
        detailAnswers: buildDetailAnswers(fields, 'direct', answers),
      });
      const slot = (slots ?? []).find((s) => s.slotId === slotId);
      setBookedConfirmation(slot ? formatLocalDateTime(slot.startUTC) : 'Your slot is reserved.');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the booking.');
    } finally {
      setSubmitting(false);
    }
  }

  async function withdrawPreference() {
    if (!windowId) return;
    const confirmed = window.confirm(
      'Withdraw your day preference? This will free up your slot in the day.',
    );
    if (!confirmed) return;
    setError(null);
    setSubmitting(true);
    try {
      await withdrawDayPreferenceFn({ windowId, inviteToken: token });
      setSelectedDate('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not withdraw your preference.');
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

  // When the admin requires calendar connection and the staff member is not
  // connected, show a blocking card above either booking mode so they get a
  // clear action rather than a cryptic server error on submit.
  const calendarConnectRequired =
    requireCalendarConnect && calendarStatus !== null && calendarStatus !== 'connected';

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
      {calendarStatusLoading ? null : calendarConnectRequired ? (
        <div
          role="alert"
          className="bg-ops-gray-lightest border-border mb-4 flex items-start gap-3 rounded-lg border p-4"
        >
          <CalendarX className="text-ops-red mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium">Google Calendar connection required</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Your observer requires all staff to connect Google Calendar before booking an
              observation. Connect now to continue.
            </p>
            <Button
              className="mt-3"
              onClick={() => {
                try {
                  beginCalendarConnect(myEmail, location.pathname + location.search);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Could not start the calendar connection.',
                  );
                }
              }}
            >
              Connect Google Calendar
            </Button>
          </div>
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
