import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Copy, Check } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  type CancelObservationWindowInput,
  type ObservationWindow,
} from '@ops/shared';
import { useAuth, useIsAdmin } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { functions } from '@/lib/firebase';
import { buildMyWindowsConstraints } from './observationWindowQuery';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CreateObservationWindowDialog } from './CreateObservationWindowDialog';

interface CancelResult {
  ok: true;
}

const cancelObservationWindowFn = httpsCallable<CancelObservationWindowInput, CancelResult>(
  functions,
  'cancelObservationWindow',
);

const STATUS_LABELS: Record<ObservationWindow['status'], string> = {
  open: 'Open',
  'partially-booked': 'Partially booked',
  'fully-booked': 'Fully booked',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

function statusBadgeClass(status: ObservationWindow['status']): string {
  switch (status) {
    case 'open':
      return 'bg-ops-blue-lighter text-ops-blue-dark';
    case 'fully-booked':
      return 'bg-green-100 text-green-700';
    case 'cancelled':
    case 'expired':
      return 'bg-ops-gray-lightest text-ops-gray';
    default:
      return 'bg-amber-100 text-amber-700';
  }
}

export function MyObservationWindowsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const myEmail = user?.email?.toLowerCase() ?? '';

  // Admins see every window; everyone else is filtered server-side to the
  // windows they opened, rather than fetching all windows and filtering here.
  const windowConstraints = useMemo(
    () => buildMyWindowsConstraints({ isAdmin, email: myEmail }),
    [isAdmin, myEmail],
  );
  const { data: windows, loading } = useFirestoreCollection<ObservationWindow>(
    COLLECTIONS.observationWindows,
    windowConstraints,
    [isAdmin, myEmail],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = windows ?? [];

  async function copyLinks(w: ObservationWindow & { id: string }) {
    const origin = window.location.origin;
    const lines = w.invitees.map(
      (inv) => `${inv.name} <${inv.email}>: ${origin}/book/${w.windowId}?token=${inv.inviteToken}`,
    );
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedId(w.id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === w.id ? null : cur));
      }, 2000);
    } catch {
      setError('Could not copy invite links to the clipboard.');
    }
  }

  async function cancel(w: ObservationWindow & { id: string }) {
    const reason = window.prompt(
      `Cancel this observation window? Existing bookings are cancelled and invitees are emailed. Optional reason:`,
      '',
    );
    if (reason === null) return;
    setError(null);
    setCancellingId(w.id);
    try {
      await cancelObservationWindowFn({ windowId: w.windowId, reason: reason.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel the window.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <PageHeader
      title="Observation windows"
      subtitle="Windows you've opened for staff to schedule observations."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/observations/new')}
            className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="text-ops-blue-dark bg-white hover:bg-white/90"
          >
            Open window
          </Button>
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

      <div className="border-border bg-background overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mode</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Booked</TableHead>
              <TableHead className="w-64" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !windows ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`skeleton-${String(i)}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-40" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-7 w-48" />
                  </TableCell>
                </TableRow>
              ))
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-6 text-center">
                  You haven&apos;t opened any observation windows yet.
                </TableCell>
              </TableRow>
            ) : (
              visible.map((w) => {
                const total = w.invitees.length;
                const booked = w.invitees.filter((inv) => inv.bookedSlotId).length;
                const isCancelled = w.status === 'cancelled' || w.status === 'expired';
                return (
                  <TableRow key={w.id}>
                    <TableCell>
                      {w.bookingMode === 'direct' ? 'Direct booking' : 'Day preference'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {w.startDate} – {w.endDate}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${statusBadgeClass(w.status)}`}
                      >
                        {STATUS_LABELS[w.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {String(booked)} / {String(total)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {w.bookingMode === 'day-preference' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigate(`/observations/windows/${w.windowId}/assign`)}
                          >
                            Assign times
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void copyLinks(w)}
                          disabled={total === 0}
                        >
                          {copiedId === w.id ? (
                            <>
                              <Check className="h-4 w-4" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-4 w-4" />
                              Copy invite links
                            </>
                          )}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void cancel(w)}
                          disabled={isCancelled || cancellingId === w.id}
                        >
                          {cancellingId === w.id ? 'Cancelling…' : 'Cancel'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CreateObservationWindowDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setDialogOpen(false);
        }}
      />
    </PageHeader>
  );
}
