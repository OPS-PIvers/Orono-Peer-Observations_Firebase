import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Check, Copy, ExternalLink, Mail } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  WINDOW_SUBCOLLECTIONS,
  type CancelBookingInput,
  type ObservationPreference,
  type ObservationSlot,
  type ObservationWindow,
  type ResendWindowInviteInput,
  type WindowInvitee,
} from '@ops/shared';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { functions } from '@/lib/firebase';
import { formatLocalDateTime, toDate } from './slotTime';

interface OkResult {
  ok: true;
}

const cancelBookingFn = httpsCallable<CancelBookingInput, OkResult>(functions, 'cancelBooking');
const resendWindowInviteFn = httpsCallable<ResendWindowInviteInput, OkResult>(
  functions,
  'resendWindowInvite',
);

type SlotDoc = ObservationSlot & { id: string };
type PrefDoc = ObservationPreference & { id: string };

/** How a row keys its per-invitee action state — email + building is unique. */
function inviteeKey(inv: WindowInvitee): string {
  return `${inv.email}::${inv.buildingId}`;
}

/** Format an inviteSentAt timestamp (Firestore Timestamp / Date / millis). */
function formatSentAt(value: unknown): string {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function WindowDetailPage() {
  const { windowId } = useParams<{ windowId: string }>();
  const navigate = useNavigate();

  const windowPath = windowId ? `${COLLECTIONS.observationWindows}/${windowId}` : '';
  const { data: windowDoc, loading: windowLoading } =
    useFirestoreDoc<ObservationWindow>(windowPath);

  const slotsPath = windowId
    ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.slots}`
    : '';
  const { data: slots } = useFirestoreCollection<ObservationSlot>(slotsPath);

  const prefsPath = windowId
    ? `${COLLECTIONS.observationWindows}/${windowId}/${WINDOW_SUBCOLLECTIONS.preferences}`
    : '';
  const { data: preferences } = useFirestoreCollection<ObservationPreference>(prefsPath);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);
  const [resendingKey, setResendingKey] = useState<string | null>(null);
  const [resentKey, setResentKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Slot lookup by slotId for booked-time + observation links.
  const slotById = useMemo(() => {
    const map = new Map<string, SlotDoc>();
    for (const s of slots ?? []) map.set(s.slotId, s);
    return map;
  }, [slots]);

  // Preference lookup by email (doc id is the staff email).
  const prefByEmail = useMemo(() => {
    const map = new Map<string, PrefDoc>();
    for (const p of preferences ?? []) map.set(p.email, p);
    return map;
  }, [preferences]);

  const invitees = useMemo(
    () =>
      (windowDoc?.invitees ?? [])
        .slice()
        .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
    [windowDoc],
  );

  const isDayPreference = windowDoc?.bookingMode === 'day-preference';

  function copyLink(inv: WindowInvitee) {
    if (!windowDoc) return;
    const origin = window.location.origin;
    const link = `${origin}/book/${windowDoc.windowId}?token=${inv.inviteToken}`;
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        const key = inviteeKey(inv);
        setCopiedKey(key);
        setTimeout(() => {
          setCopiedKey((cur) => (cur === key ? null : cur));
        }, 2000);
      })
      .catch(() => {
        setError('Could not copy the invite link to the clipboard.');
      });
  }

  async function cancel(inv: WindowInvitee) {
    if (!windowDoc || !inv.bookedSlotId) return;
    const reason = window.prompt(
      `Cancel ${inv.name || inv.email}'s booking? They are emailed and the draft observation is removed. Optional reason:`,
      '',
    );
    if (reason === null) return;
    setError(null);
    setCancellingKey(inviteeKey(inv));
    try {
      await cancelBookingFn({
        windowId: windowDoc.windowId,
        slotId: inv.bookedSlotId,
        reason: reason.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the booking.');
    } finally {
      setCancellingKey(null);
    }
  }

  async function resend(inv: WindowInvitee) {
    if (!windowDoc) return;
    setError(null);
    const key = inviteeKey(inv);
    setResendingKey(key);
    try {
      await resendWindowInviteFn({
        windowId: windowDoc.windowId,
        email: inv.email,
        buildingId: inv.buildingId,
      });
      setResentKey(key);
      setTimeout(() => {
        setResentKey((cur) => (cur === key ? null : cur));
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend the invite.');
    } finally {
      setResendingKey(null);
    }
  }

  return (
    <PageHeader
      title="Window detail"
      subtitle={
        windowDoc
          ? `${windowDoc.startDate} – ${windowDoc.endDate} · ${
              isDayPreference ? 'Day preference' : 'Direct booking'
            }`
          : 'Invitees and bookings'
      }
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/observations/windows')}
            className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          {windowDoc?.bookingMode === 'day-preference' ? (
            <Button
              size="sm"
              onClick={() => navigate(`/observations/windows/${windowDoc.windowId}/assign`)}
              className="text-ops-blue-dark bg-white hover:bg-white/90"
            >
              Assign times
            </Button>
          ) : null}
        </div>
      }
    >
      {error ? (
        <div
          role="alert"
          className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}

      {windowLoading && !windowDoc ? (
        <Skeleton className="h-40 w-full" />
      ) : !windowDoc ? (
        <p className="text-muted-foreground py-6 text-center text-sm">Window not found.</p>
      ) : (
        <div className="border-border bg-background overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invitee</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-72">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                    This window has no invitees.
                  </TableCell>
                </TableRow>
              ) : (
                invitees.map((inv) => {
                  const key = inviteeKey(inv);
                  const bookedSlot = inv.bookedSlotId ? slotById.get(inv.bookedSlotId) : undefined;
                  const pref = prefByEmail.get(inv.email);
                  const isBooked = inv.bookedSlotId != null;
                  return (
                    <TableRow key={key}>
                      <TableCell>
                        <div className="font-medium">{inv.name || inv.email}</div>
                        <div className="text-muted-foreground text-xs">
                          {inv.email}
                          {inv.role ? ` · ${inv.role}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {inv.inviteSentAt ? (
                          formatSentAt(inv.inviteSentAt)
                        ) : (
                          <span className="text-muted-foreground">Not sent</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {isBooked ? (
                          <span className="font-medium text-green-700">
                            Booked
                            {bookedSlot ? ` · ${formatLocalDateTime(bookedSlot.startUTC)}` : ''}
                          </span>
                        ) : pref ? (
                          <span className="text-amber-700">Preference submitted</span>
                        ) : (
                          <span className="text-muted-foreground">No response</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {isBooked && bookedSlot?.observationId ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                navigate(`/observations/${bookedSlot.observationId ?? ''}`)
                              }
                            >
                              <ExternalLink className="h-4 w-4" />
                              Observation
                            </Button>
                          ) : null}
                          {isBooked ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => void cancel(inv)}
                              disabled={cancellingKey === key}
                            >
                              {cancellingKey === key ? 'Cancelling…' : 'Cancel booking'}
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  copyLink(inv);
                                }}
                              >
                                {copiedKey === key ? (
                                  <>
                                    <Check className="h-4 w-4" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-4 w-4" />
                                    Copy link
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void resend(inv)}
                                disabled={resendingKey === key}
                              >
                                {resendingKey === key ? (
                                  'Sending…'
                                ) : resentKey === key ? (
                                  <>
                                    <Check className="h-4 w-4" />
                                    Sent
                                  </>
                                ) : (
                                  <>
                                    <Mail className="h-4 w-4" />
                                    Resend invite
                                  </>
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </PageHeader>
  );
}
