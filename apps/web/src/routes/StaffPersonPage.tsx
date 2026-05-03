import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ClipboardList } from 'lucide-react';
import { doc, orderBy, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type Observation,
  type ObservationStatus,
  type Staff,
} from '@ops/shared';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { CreateObservationDialog } from '@/observations/CreateObservationDialog';
import { yearBadgeClass, yearLabel } from '@/utils/staffFormatting';

type ObsTab = 'all' | ObservationStatus;

function formatRelative(value: Observation['lastModifiedAt']): string {
  const raw = value as unknown;
  const date =
    raw instanceof Date
      ? raw
      : typeof raw === 'object' &&
          raw !== null &&
          'toDate' in raw &&
          typeof raw.toDate === 'function'
        ? (raw as { toDate: () => Date }).toDate()
        : null;
  if (!date) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${String(diffMin)}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${String(diffHr)}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${String(diffDay)}d ago`;
  return date.toLocaleDateString();
}

function typeBadge(type: string): string {
  if (type === OBSERVATION_TYPES.workProduct)
    return 'bg-amber-100 text-amber-800 border border-amber-200';
  if (type === OBSERVATION_TYPES.instructionalRound)
    return 'bg-purple-100 text-purple-800 border border-purple-200';
  return 'bg-ops-blue-lighter text-ops-blue-dark border border-ops-blue-lighter';
}

export function StaffPersonPage() {
  const { email: rawEmail } = useParams<{ email: string }>();
  // Decode and normalise: URLs use encodeURIComponent so "+" and other
  // special chars are safe, but Firestore doc IDs are stored lowercase.
  const email = decodeURIComponent(rawEmail ?? '').toLowerCase() || undefined;
  const navigate = useNavigate();

  const staffDocRef = useMemo(() => (email ? doc(db, COLLECTIONS.staff, email) : null), [email]);
  const { data: staffMember, loading: staffLoading } = useDocument<Staff>(staffDocRef);

  const obsConstraints = useMemo(
    () => (email ? [where('observedEmail', '==', email), orderBy('lastModifiedAt', 'desc')] : []),
    // The hook keys on constraint types only; email is captured in closure.
    // KeyedStaffPersonPage (App.tsx) remounts this component when email changes,
    // so the subscription always reflects the correct person.

    [email],
  );
  const { data: observations } = useFirestoreCollection<Observation>(
    COLLECTIONS.observations,
    obsConstraints,
  );

  const [activeTab, setActiveTab] = useState<ObsTab>('all');
  const [dialogOpen, setDialogOpen] = useState(false);

  const allObs = observations ?? [];
  const draftObs = allObs.filter((o) => o.status === OBSERVATION_STATUS.draft);
  const finalizedObs = allObs.filter((o) => o.status === OBSERVATION_STATUS.finalized);

  const visibleObs =
    activeTab === 'all' ? allObs : activeTab === OBSERVATION_STATUS.draft ? draftObs : finalizedObs;

  if (staffLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 rounded-lg bg-gray-100" />
        <div className="h-10 w-64 rounded bg-gray-100" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!staffMember) {
    return (
      <div className="py-16 text-center">
        <p className="text-ops-gray mb-4 font-medium">Staff member not found.</p>
        <Button variant="ghost" onClick={() => void navigate('/staff')}>
          <ChevronLeft className="h-4 w-4" />
          Back to Staff
        </Button>
      </div>
    );
  }

  const tabs: { id: ObsTab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: allObs.length },
    { id: OBSERVATION_STATUS.draft, label: 'Draft', count: draftObs.length },
    { id: OBSERVATION_STATUS.finalized, label: 'Finalized', count: finalizedObs.length },
  ];

  return (
    <div>
      {/* Person header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="font-heading text-ops-blue-dark text-3xl font-semibold">
            {staffMember.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-ops-gray text-sm">{staffMember.role}</span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${yearBadgeClass(staffMember.year)}`}
            >
              {yearLabel(staffMember.year)}
            </span>
            {staffMember.summativeYear ? (
              <span className="bg-ops-blue-lighter text-ops-blue-dark inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold">
                High Cycle
              </span>
            ) : null}
            {staffMember.buildings.map((b) => (
              <span key={b} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                {b}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/staff">
              <ChevronLeft className="h-4 w-4" />
              Back to Staff
            </Link>
          </Button>
          <Button onClick={() => setDialogOpen(true)}>New Observation</Button>
        </div>
      </div>

      {/* Observation tabs */}
      <div className="mb-4 flex overflow-hidden rounded-lg border border-gray-200 bg-white">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-ops-blue font-semibold text-white'
                : 'text-ops-gray hover:bg-ops-blue-lighter hover:text-ops-blue-dark'
            }`}
          >
            {tab.label} ({String(tab.count)})
          </button>
        ))}
      </div>

      {/* Observation list */}
      {visibleObs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <ClipboardList className="text-ops-gray-lighter h-10 w-10" />
          <p className="text-ops-gray font-medium">No observations yet for {staffMember.name}</p>
          <Button onClick={() => setDialogOpen(true)}>Start first observation</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleObs.map((o) => (
            <ObservationCard key={o.id} observation={o} />
          ))}
        </div>
      )}

      {/* New observation dialog */}
      {dialogOpen ? (
        <CreateObservationDialog
          open
          onOpenChange={setDialogOpen}
          staff={staffMember}
          onCreated={(id) => void navigate(`/observations/${id}`)}
        />
      ) : null}
    </div>
  );
}

function ObservationCard({ observation: o }: { observation: Observation & { id: string } }) {
  const accentColor =
    o.status === OBSERVATION_STATUS.draft ? 'border-l-ops-blue' : 'border-l-green-500';

  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-l-[3px] border-gray-200 bg-white pl-4 shadow-sm ${accentColor}`}
    >
      <div className="p-4">
        <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-heading text-ops-blue-dark font-semibold">
              {o.observationName || (
                <span className="text-ops-gray italic">Untitled observation</span>
              )}
            </span>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${typeBadge(o.type)}`}
            >
              {o.type}
            </span>
          </div>
          <StatusChip status={o.status} />
        </div>

        <p className="text-ops-gray mb-3 text-xs">
          By: {o.observerEmail} · Last modified: {formatRelative(o.lastModifiedAt)}
        </p>

        <div className="flex flex-wrap gap-2">
          {o.status === OBSERVATION_STATUS.draft ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={`/observations/${o.id}`}>Continue editing</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/observations/${o.id}`}>View</Link>
              </Button>
              {o.pdfDriveFileId ? (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={`https://drive.google.com/file/d/${o.pdfDriveFileId}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View PDF (opens in new tab)"
                  >
                    View PDF
                  </a>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: ObservationStatus }) {
  if (status === OBSERVATION_STATUS.draft) {
    return (
      <span className="inline-flex items-center rounded border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        Draft
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded border border-green-200 bg-green-100 px-2 py-0.5 text-xs text-green-800">
      Finalized
    </span>
  );
}
