/**
 * MyObservationsPage — Staff view of their own observations.
 *
 * Two queries, both `observedEmail == current user`:
 *   - In progress: status 'Draft', ordered by createdAt desc (composite
 *     index observedEmail/status/createdAt). Shown above the table with
 *     Planning / Reflection question progress — before this section the
 *     app had no page listing a teacher's active drafts at all.
 *   - Finalized: status 'Finalized', ordered by finalizedAt desc (index
 *     observedEmail/status/finalizedAt).
 * Security rules allow staff to list their own observations regardless of
 * status (firestore.rules).
 *
 * Each row links to /observations/:id (the read-only editor — ObservationEditorPage
 * handles non-observer access with canEdit gating) and shows the acknowledge
 * state. Unacknowledged observations can be acknowledged inline.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Lock } from 'lucide-react';
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
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  QUESTION_TYPE_BY_OBSERVATION_TYPE,
  postQuestionsUnlocked,
  questionType,
  type Observation,
  type WorkProductQuestion,
} from '@ops/shared';
import { answerProgress, splitQuestionsByPhase } from '@/observations/questionAnswers';
import { toJsDate } from '@/utils/staffFormatting';
import { useAuth } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';

// Cap the query — staff never have more than a few dozen observations.
const PAGE_LIMIT = 100;

function formatDate(value: Observation['finalizedAt'] | undefined): string {
  if (value == null) return '—';
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

  const draftConstraints = useMemo(
    () =>
      emailLower
        ? [
            where('observedEmail', '==', emailLower),
            where('status', '==', OBSERVATION_STATUS.draft),
            orderBy('createdAt', 'desc'),
            limit(PAGE_LIMIT),
          ]
        : [],
    [emailLower],
  );
  const { data: drafts } = useFirestoreCollection<Observation>(
    emailLower ? COLLECTIONS.observations : '',
    draftConstraints,
    // Same constraint shape as the finalized query — disambiguate the cache key.
    [emailLower, 'drafts'],
  );
  const { data: questionBank } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    [where('isActive', '==', true), orderBy('order', 'asc')],
  );

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
    <PageHeader
      title="My Observations"
      subtitle="Your peer observations, in progress and finalized"
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3 text-sm">
          Failed to load observations: {error.message}
        </div>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <InProgressSection drafts={drafts} questionBank={questionBank ?? []} />
      ) : null}

      <h2 className="font-heading text-ops-blue-dark mb-2 text-sm font-semibold tracking-wide uppercase">
        Finalized
      </h2>

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

/**
 * Active drafts with the teacher's Planning / Reflection progress. Each row
 * deep-links to the matching panel on the observation page — the same
 * place the dashboard cards send them.
 */
function InProgressSection({
  drafts,
  questionBank,
}: {
  drafts: (Observation & { id: string })[];
  questionBank: (WorkProductQuestion & { id: string })[];
}) {
  const now = new Date();
  return (
    <section className="mb-6" aria-label="Observations in progress">
      <h2 className="font-heading text-ops-blue-dark mb-2 text-sm font-semibold tracking-wide uppercase">
        In progress
      </h2>
      <ul className="space-y-2">
        {drafts.map((o) => {
          const bank = questionBank.filter(
            (q) => questionType(q) === QUESTION_TYPE_BY_OBSERVATION_TYPE[o.type],
          );
          const { pre, post } = splitQuestionsByPhase(bank);
          const answers = new Map(
            (o.workProductAnswers ?? []).map((a) => [a.questionId, a.answer] as const),
          );
          const planning = answerProgress(pre, answers);
          const reflection = answerProgress(post, answers);
          const observationDate = toJsDate(o.observationDate);
          const reflectionOpen = postQuestionsUnlocked(observationDate, now);
          const heading = o.observationName || `${o.type} observation`;
          return (
            <li
              key={o.id}
              className="border-ops-blue-lighter flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-white px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <Link
                  to={`/observations/${o.id}`}
                  className="text-ops-blue font-medium hover:underline"
                >
                  {heading}
                </Link>
                <div className="text-ops-gray mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                  <ObservationTypeBadge type={o.type} />
                  <span>{observationDate ? formatDate(observationDate) : 'Date not set'}</span>
                </div>
              </div>
              <ProgressPill
                label="Planning"
                to={`/observations/${o.id}#planning`}
                answered={planning.answered}
                total={planning.total}
                locked={false}
              />
              <ProgressPill
                label="Reflection"
                to={`/observations/${o.id}#reflection`}
                answered={reflection.answered}
                total={reflection.total}
                locked={!reflectionOpen}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProgressPill({
  label,
  to,
  answered,
  total,
  locked,
}: {
  label: string;
  to: string;
  answered: number;
  total: number;
  locked: boolean;
}) {
  const complete = total > 0 && answered === total;
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
        complete
          ? 'border-green-200 bg-green-50 text-green-800'
          : 'border-ops-blue-lighter text-ops-blue-dark hover:bg-ops-blue-lighter/60 bg-white'
      }`}
      aria-label={
        locked
          ? `${label}: opens the day after the observation`
          : total > 0
            ? `${label}: ${String(answered)} of ${String(total)} answered`
            : label
      }
    >
      {label}
      {locked ? (
        <Lock className="h-3 w-3" aria-hidden="true" />
      ) : total > 0 ? (
        <span className="text-muted-foreground font-normal">
          · {answered} of {total}
        </span>
      ) : null}
    </Link>
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
