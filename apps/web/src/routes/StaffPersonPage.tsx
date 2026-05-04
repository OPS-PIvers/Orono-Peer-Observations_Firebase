import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ClipboardList, Mail } from 'lucide-react';
import { deleteDoc, doc, orderBy, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  OBSERVATION_STATUS,
  OBSERVATION_TYPES,
  type EmailTemplate,
  type Observation,
  type ObservationStatus,
  type Role,
  type Staff,
} from '@ops/shared';
import { useDocument } from '@/hooks/useDocument';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db, functions } from '@/lib/firebase';
import { roleDisplayName } from '@/utils/roleLookup';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CreateObservationDialog } from '@/observations/CreateObservationDialog';
import { yearBadgeClass, yearLabel } from '@/utils/staffFormatting';

type ObsTab = 'all' | ObservationStatus;

const sendManualEmailFn = httpsCallable<
  { templateId: string; toEmail: string; vars: Record<string, string> },
  { sent: boolean }
>(functions, 'sendManualEmail');

const MANUAL_TEMPLATE_CONSTRAINTS = [
  where('triggerType', '==', 'manual'),
  where('isActive', '==', true),
  orderBy('name', 'asc'),
];

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
  const { user } = useAuth();
  const currentEmail = user?.email?.toLowerCase() ?? '';

  const staffDocRef = useMemo(() => (email ? doc(db, COLLECTIONS.staff, email) : null), [email]);
  const { data: staffMember, loading: staffLoading } = useDocument<Staff>(staffDocRef);
  const { data: roles } = useFirestoreCollection<Role>(COLLECTIONS.roles);

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

  const { data: manualTemplates } = useFirestoreCollection<EmailTemplate>(
    COLLECTIONS.emailTemplates,
    MANUAL_TEMPLATE_CONSTRAINTS,
  );

  const [activeTab, setActiveTab] = useState<ObsTab>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Email send state
  const emailMenuRef = useRef<HTMLDivElement>(null);
  const sendSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emailMenuOpen, setEmailMenuOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<(EmailTemplate & { id: string }) | null>(
    null,
  );
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);

  // Clear success timer on unmount to prevent setState on unmounted component
  useEffect(() => {
    return () => {
      if (sendSuccessTimerRef.current) clearTimeout(sendSuccessTimerRef.current);
    };
  }, []);

  // Close email dropdown when clicking outside
  useEffect(() => {
    if (!emailMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (emailMenuRef.current && !emailMenuRef.current.contains(e.target as Node)) {
        setEmailMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [emailMenuOpen]);

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.observations, id));
      setConfirmingDeleteId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete observation');
    }
  }

  async function handleSendEmail() {
    if (!selectedTemplate || !staffMember || !email) return;
    setSending(true);
    setSendError(null);
    try {
      const roleLabel = roleDisplayName(roles, staffMember.role);
      await sendManualEmailFn({
        templateId: selectedTemplate.id,
        toEmail: email,
        vars: {
          observedName: staffMember.name,
          observedEmail: email,
          observedRole: roleLabel,
          observedYear: String(staffMember.year),
          staffName: staffMember.name,
          staffEmail: email,
          staffRole: roleLabel,
          observerName: (user?.email ?? '').split('@')[0] ?? '',
          observerEmail: user?.email ?? '',
        },
      });
      setSendSuccess(true);
      sendSuccessTimerRef.current = setTimeout(() => {
        setSendDialogOpen(false);
        setSendSuccess(false);
      }, 1500);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const allObs = observations ?? [];
  const draftObs = allObs.filter((o) => o.status === OBSERVATION_STATUS.draft);
  const finalizedObs = allObs.filter((o) => o.status === OBSERVATION_STATUS.finalized);

  const visibleObs =
    activeTab === 'all' ? allObs : activeTab === OBSERVATION_STATUS.draft ? draftObs : finalizedObs;

  const hasTemplates = manualTemplates && manualTemplates.length > 0;

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
    <>
      <PageHeader
        title={staffMember.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{roleDisplayName(roles, staffMember.role)}</span>
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
              <span key={b} className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white/90">
                {b}
              </span>
            ))}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-white/80 hover:bg-white/10 hover:text-white"
            >
              <Link to="/staff">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>

            {/* Send email dropdown */}
            <div className="relative" ref={emailMenuRef}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmailMenuOpen((o) => !o)}
                disabled={!hasTemplates}
                title={hasTemplates ? undefined : 'No active manual templates'}
                className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <Mail className="h-4 w-4" />
                Send Email
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              {emailMenuOpen && hasTemplates ? (
                <div className="absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                  {manualTemplates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setEmailMenuOpen(false);
                        setSelectedTemplate(t);
                        setSendDialogOpen(true);
                      }}
                      className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <Button
              onClick={() => setDialogOpen(true)}
              className="text-ops-blue-dark bg-white hover:bg-white/90"
            >
              New Observation
            </Button>
          </div>
        }
      />

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

      {deleteError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {deleteError}
        </div>
      ) : null}

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
            <ObservationCard
              key={o.id}
              observation={o}
              canDelete={o.observerEmail === currentEmail}
              confirmingDelete={confirmingDeleteId === o.id}
              onRequestDelete={() => setConfirmingDeleteId(o.id)}
              onCancelDelete={() => setConfirmingDeleteId(null)}
              onConfirmDelete={() => void handleDelete(o.id)}
            />
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

      {/* Send email confirm dialog */}
      {sendDialogOpen && selectedTemplate ? (
        <Dialog
          open={sendDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              if (sendSuccessTimerRef.current) clearTimeout(sendSuccessTimerRef.current);
              setSendDialogOpen(false);
              setSendError(null);
              setSelectedTemplate(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Send &quot;{selectedTemplate.name}&quot;</DialogTitle>
              <DialogDescription>
                This will send an email to <strong>{email}</strong>.
              </DialogDescription>
            </DialogHeader>
            {sendError ? <p className="text-destructive text-sm">{sendError}</p> : null}
            {sendSuccess ? (
              <p className="text-sm text-green-700">Email sent successfully.</p>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (sendSuccessTimerRef.current) clearTimeout(sendSuccessTimerRef.current);
                  setSendDialogOpen(false);
                  setSendError(null);
                  setSelectedTemplate(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleSendEmail()} disabled={sending}>
                {sending ? 'Sending…' : 'Send Email'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function ObservationCard({
  observation: o,
  canDelete,
  confirmingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  observation: Observation & { id: string };
  canDelete: boolean;
  confirmingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
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

        <div className="flex flex-wrap items-center gap-2">
          {o.status === OBSERVATION_STATUS.draft ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/observations/${o.id}`}>Continue editing</Link>
              </Button>
              {canDelete &&
                (confirmingDelete ? (
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <span>Delete this draft?</span>
                    <button
                      onClick={onConfirmDelete}
                      className="text-ops-red font-semibold"
                      type="button"
                    >
                      Yes, delete
                    </button>
                    <button onClick={onCancelDelete} type="button">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-ops-red hover:text-ops-red hover:bg-red-50"
                    onClick={onRequestDelete}
                  >
                    Delete draft
                  </Button>
                ))}
            </>
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
