import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import { limit, orderBy, where } from 'firebase/firestore';
import { COLLECTIONS, OBSERVATION_STATUS, type Observation } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { Button } from '@/components/ui/button';

export interface RecentObservationsStripProps {
  /** Lowercased staff email of the observed teacher. */
  observedEmail: string;
}

const PREVIEW_LIMIT = 5;

/**
 * Lists this teacher's most recent finalized observations as cards. Hidden
 * entirely when zero finalized observations exist. "View all" inflates the
 * strip into a full inline list (no new route).
 */
export function RecentObservationsStrip({ observedEmail }: RecentObservationsStripProps) {
  const [expanded, setExpanded] = useState(false);

  // Two separate queries: a small preview (limit 5) and an expanded list.
  // Keep both stable across renders; see the constraintsKey caveat in
  // `useFirestoreCollection`.
  const previewConstraints = useMemo(
    () => [
      where('observedEmail', '==', observedEmail),
      where('status', '==', OBSERVATION_STATUS.finalized),
      orderBy('finalizedAt', 'desc'),
      limit(PREVIEW_LIMIT),
    ],
    [observedEmail],
  );
  const expandedConstraints = useMemo(
    () => [
      where('observedEmail', '==', observedEmail),
      where('status', '==', OBSERVATION_STATUS.finalized),
      orderBy('finalizedAt', 'desc'),
    ],
    [observedEmail],
  );

  const { data: previewData, loading: previewLoading } = useFirestoreCollection<Observation>(
    COLLECTIONS.observations,
    previewConstraints,
  );
  // Only mount the second listener when the user clicks "View all" — the
  // useFirestoreCollection hook subscribes immediately on mount.
  const { data: fullData, loading: fullLoading } = useFirestoreCollection<Observation>(
    expanded ? COLLECTIONS.observations : '',
    expanded ? expandedConstraints : [],
  );

  if (previewLoading) {
    return (
      <section className="border-border bg-background rounded-lg border p-4">
        <h2 className="font-heading text-ops-blue-dark mb-2 text-base font-semibold">
          Recent observations of me
        </h2>
        <p className="text-muted-foreground inline-flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      </section>
    );
  }
  if (!previewData || previewData.length === 0) {
    return null;
  }

  const items = expanded ? (fullData ?? previewData) : previewData;
  const showViewAll = !expanded && previewData.length === PREVIEW_LIMIT;

  return (
    <section className="border-border bg-background rounded-lg border p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-ops-blue-dark text-base font-semibold">
          Recent observations of me
        </h2>
        {expanded && fullLoading ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading more…
          </span>
        ) : null}
      </header>

      <ul className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {items.map((obs) => (
          <li key={obs.id}>
            <ObservationCard obs={obs} />
          </li>
        ))}
      </ul>

      {showViewAll ? (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(true)}
            className="text-primary"
          >
            View all →
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function ObservationCard({ obs }: { obs: Observation & { id: string } }) {
  const finalizedDate = obs.finalizedAt
    ? new Date(obs.finalizedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';
  const heading = obs.observationName || `${obs.type} observation`;
  const pdfHref = obs.pdfDriveFileId
    ? `https://drive.google.com/file/d/${obs.pdfDriveFileId}/view`
    : null;

  return (
    <article className="border-border hover:border-primary group rounded-md border p-3 transition-colors">
      <Link to={`/observations/${obs.id}`} className="block">
        <h3 className="text-foreground group-hover:text-primary text-sm font-semibold">
          {heading}
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          By {obs.observerEmail} · {finalizedDate}
        </p>
      </Link>
      {pdfHref ? (
        <a
          href={pdfHref}
          target="_blank"
          rel="noreferrer"
          className="text-primary mt-2 inline-flex items-center gap-1 text-xs underline hover:no-underline"
        >
          <FileText className="h-3 w-3" />
          PDF
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </article>
  );
}
