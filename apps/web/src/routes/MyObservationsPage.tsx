/**
 * MyObservationsPage — Staff view of their own finalized observations.
 *
 * Queries observations where observedEmail == current user and status ==
 * 'Finalized', ordered by finalizedAt desc. The composite index
 * (observedEmail, status, finalizedAt) already exists in
 * firestore.indexes.json. Security rules already allow staff to read their
 * own finalized observations (firestore.rules).
 *
 * Each row links to /observations/:id (the read-only editor — ObservationEditorPage
 * handles non-observer access with canEdit gating) and shows the acknowledge
 * state. Unacknowledged observations can be acknowledged inline.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText } from 'lucide-react';
import {
  Timestamp,
  doc,
  limit,
  orderBy,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { COLLECTIONS, OBSERVATION_STATUS, type Observation } from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';

// Cap the query — staff never have more than a few dozen observations.
const PAGE_LIMIT = 100;

function formatDate(value: Observation['finalizedAt']): string {
  if (value === null) return '—';
  // Firestore returns Timestamp even though Zod models as Date.
  // Mirrors the same guard used by RecentObservationsStrip.
  const date = value instanceof Timestamp ? value.toDate() : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function MyObservationsPage() {
  const { user } = useAuth();
  const emailLower = user?.email?.toLowerCase() ?? '';
  const queryClient = useQueryClient();

  const constraints = useMemo(
    () =>
      emailLower
        ? [
            where('observedEmail', '==', emailLower),
            where('status', '==', OBSERVATION_STATUS.finalized),
            orderBy('finalizedAt', 'desc'),
            limit(PAGE_LIMIT),
          ]
        : [],
    [emailLower],
  );

  const {
    data: observations,
    loading,
    error,
  } = useFirestoreCollection<Observation>(emailLower ? COLLECTIONS.observations : '', constraints, [
    emailLower,
  ]);

  const ackMutation = useMutation({
    mutationFn: async (observationId: string) => {
      await updateDoc(doc(db, COLLECTIONS.observations, observationId), {
        acknowledgedAt: serverTimestamp(),
        acknowledgedBy: emailLower,
        lastModifiedAt: serverTimestamp(),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (q) => {
          if (!Array.isArray(q.queryKey)) return false;
          const second: unknown = q.queryKey[1];
          return typeof second === 'string' && second.includes(COLLECTIONS.observations);
        },
      });
    },
    onError: (err: unknown) => {
      toast.error('Failed to acknowledge observation', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    },
  });

  return (
    <PageHeader title="My Observations" subtitle="Your finalized peer observations">
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3 text-sm">
          Failed to load observations: {error.message}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm" role="grid" aria-label="My finalized observations">
          <thead>
            <tr className="bg-ops-blue text-white">
              {['Date', 'Observation', 'Observer', 'Type', 'PDF', 'Acknowledged'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="font-heading px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide uppercase"
                >
                  {h}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && !observations ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr
                  key={`skeleton-${String(i)}`}
                  className={i % 2 === 0 ? 'bg-white' : 'bg-ops-gray-lightest'}
                >
                  {i === 0 ? (
                    <td className="px-4 py-3" colSpan={7}>
                      <span className="sr-only" role="status" aria-live="polite">
                        Loading observations…
                      </span>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ) : (
                    <td className="px-4 py-3" colSpan={7}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  )}
                </tr>
              ))
            ) : !observations || observations.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-ops-gray py-10 text-center text-sm">
                  No finalized observations yet.
                </td>
              </tr>
            ) : (
              observations.map((o, i) => {
                const pdfHref = o.pdfDriveFileId
                  ? `https://drive.google.com/file/d/${o.pdfDriveFileId}/view`
                  : null;
                const isAcknowledged = Boolean(o.acknowledgedAt);
                const heading = o.observationName || `${o.type} observation`;
                const emailPrefix = o.observerEmail.split('@')[0] ?? '';
                const observerLabel = o.observerName || emailPrefix || o.observerEmail;

                return (
                  <tr
                    key={o.id}
                    className={`hover:bg-ops-blue-lighter/30 transition-colors ${
                      i % 2 === 0 ? 'bg-white' : 'bg-ops-gray-lightest'
                    }`}
                  >
                    {/* Date */}
                    <td className="text-ops-gray px-4 py-3 text-xs whitespace-nowrap">
                      {formatDate(o.finalizedAt)}
                    </td>

                    {/* Observation name / link */}
                    <td className="px-4 py-3">
                      <Link
                        to={`/observations/${o.id}`}
                        className="text-ops-blue font-medium hover:underline"
                      >
                        {heading}
                      </Link>
                    </td>

                    {/* Observer */}
                    <td className="text-ops-gray px-4 py-3 text-xs">{observerLabel}</td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <ObservationTypeBadge type={o.type} />
                    </td>

                    {/* PDF link */}
                    <td className="px-4 py-3">
                      {pdfHref ? (
                        <a
                          href={pdfHref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ops-blue inline-flex items-center gap-1 text-xs underline hover:no-underline"
                          aria-label={`Open PDF for ${heading}`}
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          PDF
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : (
                        <span className="text-ops-gray-lighter" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>

                    {/* Acknowledged state */}
                    <td className="px-4 py-3">
                      {isAcknowledged ? (
                        <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
                          Acknowledged
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">Not yet</span>
                      )}
                    </td>

                    {/* Acknowledge action for unacknowledged rows */}
                    <td className="px-4 py-3">
                      {!isAcknowledged ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={ackMutation.isPending}
                          onClick={() => ackMutation.mutate(o.id)}
                          aria-label={`Acknowledge ${heading}`}
                        >
                          Acknowledge
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </PageHeader>
  );
}

function ObservationTypeBadge({ type }: { type: string }) {
  let cls = 'bg-ops-blue-lighter text-ops-blue-dark border border-ops-blue-lighter';
  if (type === 'Work Product') cls = 'bg-amber-100 text-amber-800 border border-amber-200';
  if (type === 'Instructional Round')
    cls = 'bg-purple-100 text-purple-800 border border-purple-200';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {type}
    </span>
  );
}
