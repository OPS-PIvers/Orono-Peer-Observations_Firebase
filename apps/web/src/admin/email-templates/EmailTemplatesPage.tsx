import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Mail, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { deleteDoc, doc, orderBy, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  EMAIL_RECIPIENT_TYPES,
  EMAIL_TRIGGER_TYPES,
  KNOWN_TEMPLATE_VARIABLES,
  renderEmailShell,
  type EmailRecipientType,
  type EmailTemplate,
  type EmailTriggerType,
  type TemplateVariable,
} from '@ops/shared';
import { useBranding } from '@/hooks/useBranding';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db, functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { EmailBodyField } from './EmailBodyField';

// ── Constants ──────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<EmailTriggerType, string> = {
  manual: 'Manual (PE sends)',
  'observation.created.standard': 'Standard Obs Created',
  'observation.created.workProduct': 'Work Product Created',
  'observation.created.instructionalRound': 'IR Created',
  'observation.finalized': 'Observation Finalized',
  'staff.created': 'New Staff Added',
  'roleYearMapping.updated': 'Subdomains Assigned',
  'scheduled.preObservation': 'Scheduled: Pre-Observation',
  'scheduled.reminderIncomplete': 'Scheduled: Incomplete Reminder',
  'scheduled.reminderUnacknowledged': 'Scheduled: Unacknowledged Observation Reminder',
  'scheduling.windowInvite': 'Scheduling: Window Invite',
  'scheduling.bookingConfirmation': 'Scheduling: Booking Confirmed',
  'scheduling.bookingRescheduled': 'Scheduling: Booking Rescheduled',
  'scheduling.bookingTimeChanged': 'Scheduling: Time Changed (Bell Schedule)',
  'scheduling.assignmentNotice': 'Scheduling: Time Assigned',
  'scheduling.bookingCancelled': 'Scheduling: Booking Cancelled',
  'scheduling.windowCancelled': 'Scheduling: Window Cancelled',
  'scheduling.windowExpired': 'Scheduling: Window Expired',
  'scheduling.preferenceSubmitted': 'Scheduling: Day Preference Submitted',
};

const RECIPIENT_LABELS: Record<EmailRecipientType, string> = {
  observed: 'To: Staff',
  observer: 'To: PE',
  both: 'To: Both',
  admin: 'To: Admin',
};

/** Exported for drift-prevention tests only — not part of the public API. */
export const TRIGGER_VARIABLES: Record<EmailTriggerType, TemplateVariable[]> = {
  manual: [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'observationDate',
    'observationName',
    'observationType',
    'signupLink',
    'signInLink',
    'appName',
  ],
  'observation.created.standard': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'observationDate',
    'observationName',
    'signInLink',
    'appName',
  ],
  'observation.created.workProduct': [
    'observedName',
    'observedEmail',
    'observerName',
    'signInLink',
    'appName',
  ],
  'observation.created.instructionalRound': [
    'observedName',
    'observedEmail',
    'observerName',
    'signInLink',
    'appName',
  ],
  'observation.finalized': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'observationDate',
    'observationName',
    'observationType',
    'pdfDriveLink',
    'driveFolderLink',
    'signInLink',
    'appName',
  ],
  'staff.created': ['staffName', 'staffEmail', 'staffRole', 'staffYear', 'signInLink', 'appName'],
  'roleYearMapping.updated': [
    'staffName',
    'staffEmail',
    'staffRole',
    'staffYear',
    'assignedComponentCount',
    'assignedDomainList',
    'signInLink',
    'appName',
  ],
  'scheduled.preObservation': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'observationDate',
    'observationName',
    'observedRole',
    'observedYear',
    'observationType',
    'signInLink',
    'appName',
  ],
  'scheduled.reminderIncomplete': [
    'observedName',
    'observedEmail',
    'observedRole',
    'observationType',
    'observationName',
    'signInLink',
    'appName',
  ],
  'scheduled.reminderUnacknowledged': [
    'observedName',
    'observedEmail',
    'observedRole',
    'observedYear',
    'observerName',
    'observerEmail',
    'observationDate',
    'observationName',
    'observationType',
    'pdfDriveLink',
    'driveFolderLink',
    'signInLink',
    'appName',
  ],
  'scheduling.windowInvite': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'staffName',
    'staffEmail',
    'staffRole',
    'bookingLink',
    'buildingName',
    'windowStartLocal',
    'windowEndLocal',
    'signInLink',
    'appName',
  ],
  'scheduling.bookingConfirmation': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'slotDateLocal',
    'slotStartLocal',
    'slotEndLocal',
    'slotPeriodName',
    'buildingName',
    'signInLink',
    'appName',
  ],
  'scheduling.bookingRescheduled': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'slotDateLocal',
    'slotStartLocal',
    'slotEndLocal',
    'slotPeriodName',
    'buildingName',
    'signInLink',
    'appName',
  ],
  'scheduling.bookingTimeChanged': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'slotDateLocal',
    'slotStartLocal',
    'slotEndLocal',
    'slotPeriodName',
    'buildingName',
    'signInLink',
    'appName',
  ],
  'scheduling.assignmentNotice': [
    'observedName',
    'observedEmail',
    'observerName',
    'slotDateLocal',
    'slotStartLocal',
    'slotEndLocal',
    'slotPeriodName',
    'buildingName',
    'signInLink',
    'appName',
  ],
  'scheduling.bookingCancelled': [
    'observedName',
    'observedEmail',
    'observerName',
    'observerEmail',
    'slotDateLocal',
    'slotStartLocal',
    'slotEndLocal',
    'slotPeriodName',
    'buildingName',
    'cancellationReason',
    'signInLink',
    'appName',
  ],
  'scheduling.windowCancelled': [
    'observedName',
    'observedEmail',
    'observerName',
    'windowStartLocal',
    'windowEndLocal',
    'cancellationReason',
    'signInLink',
    'appName',
  ],
  'scheduling.windowExpired': [
    'observedName',
    'observedEmail',
    'observerName',
    'windowStartLocal',
    'windowEndLocal',
    'signInLink',
    'appName',
  ],
  'scheduling.preferenceSubmitted': [
    'observerName',
    'staffName',
    'windowStartLocal',
    'windowEndLocal',
    'preferredDateLocal',
    'signInLink',
    'appName',
  ],
};

type FilterCategory = 'all' | 'manual' | 'automatic' | 'scheduled';

const SAMPLE_VARS: Record<TemplateVariable, string> = {
  observerName: 'Sarah Johnson',
  observerEmail: 'sarah.johnson@orono.k12.mn.us',
  observedName: 'Alex Smith',
  observedEmail: 'alex.smith@orono.k12.mn.us',
  observedRole: 'Teacher',
  observedYear: '2',
  observationDate: 'May 15, 2026',
  observationName: 'Spring Classroom Visit',
  observationType: 'Standard',
  pdfDriveLink: 'https://drive.google.com/file/d/example/view',
  driveFolderLink: 'https://drive.google.com/drive/folders/example',
  appName: 'Orono Peer Observations',
  signInLink: 'https://observations.orono.k12.mn.us',
  staffName: 'Alex Smith',
  staffEmail: 'alex.smith@orono.k12.mn.us',
  staffRole: 'Teacher',
  staffYear: '2',
  assignedDomainList: '3 components assigned',
  assignedComponentCount: '3',
  signupLink: 'https://calendly.com/example',
  bookingLink: 'https://observations.orono.k12.mn.us/book/example?token=abc123',
  slotDateLocal: 'Wednesday, May 20, 2026',
  slotStartLocal: '10:15 AM',
  slotEndLocal: '11:00 AM',
  slotPeriodName: 'Period 3',
  buildingName: 'High School',
  cancellationReason: 'Schedule conflict',
  windowStartLocal: 'May 18, 2026',
  windowEndLocal: 'May 29, 2026',
  preferredDateLocal: 'Wednesday, May 20, 2026',
};

// ── Callable ───────────────────────────────────────────────────────────────

const sendManualEmailFn = httpsCallable<
  { templateId: string; toEmail: string; vars: Record<string, string>; isTest: boolean },
  { sent: boolean }
>(functions, 'sendManualEmail');

// ── Component ──────────────────────────────────────────────────────────────

type TemplateDoc = EmailTemplate & { id: string };

export function EmailTemplatesPage() {
  const { user } = useAuth();
  const branding = useBranding();
  const constraints = useMemo(() => [orderBy('isSystem', 'desc'), orderBy('name', 'asc')], []);
  const {
    data: templates,
    loading,
    error,
  } = useFirestoreCollection<EmailTemplate>(COLLECTIONS.emailTemplates, constraints);

  const [filter, setFilter] = useState<FilterCategory>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<TemplateDoc>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Test send dialog
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email ?? '');
  const [testTemplateId, setTestTemplateId] = useState<string | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TemplateDoc | null>(null);

  const filtered = useMemo(() => {
    if (!templates) return [];
    if (filter === 'all') return templates;
    if (filter === 'manual') return templates.filter((t) => t.triggerType === 'manual');
    if (filter === 'automatic')
      return templates.filter(
        (t) => t.triggerType !== 'manual' && !t.triggerType.startsWith('scheduled.'),
      );
    return templates.filter((t) => t.triggerType.startsWith('scheduled.'));
  }, [templates, filter]);

  function openEditor(t: TemplateDoc) {
    if (expandedId === t.id) {
      setExpandedId(null);
    } else {
      setExpandedId(t.id);
      setEditForm({ ...t });
      setSaveError(null);
    }
  }

  async function toggleActive(t: TemplateDoc) {
    const activating = !t.isActive;
    try {
      // When activating a non-manual template, check whether another active
      // template already covers the same trigger. If so, deactivate it in the
      // same batch so there is never more than one active template per trigger.
      const conflict =
        activating && t.triggerType !== 'manual'
          ? (templates ?? []).find(
              (other) => other.id !== t.id && other.triggerType === t.triggerType && other.isActive,
            )
          : undefined;

      if (conflict) {
        const batch = writeBatch(db);
        batch.set(
          doc(db, COLLECTIONS.emailTemplates, conflict.id),
          { isActive: false, updatedAt: serverTimestamp() },
          { merge: true },
        );
        batch.set(
          doc(db, COLLECTIONS.emailTemplates, t.id),
          { isActive: true, updatedAt: serverTimestamp() },
          { merge: true },
        );
        await batch.commit();
        toast.warning(`"${conflict.name}" was deactivated`, {
          description: `Only one active template is allowed per trigger. "${t.name}" is now active for "${TRIGGER_LABELS[t.triggerType]}".`,
          icon: <AlertTriangle className="h-4 w-4" />,
        });
      } else {
        await setDoc(
          doc(db, COLLECTIONS.emailTemplates, t.id),
          { isActive: activating, updatedAt: serverTimestamp() },
          { merge: true },
        );
      }
    } catch (err) {
      toast.error('Failed to update template', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  async function saveTemplate() {
    if (!editForm.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Warn when saving would leave this template active with the same
      // non-manual trigger as another active template. The conflict is only a
      // warning here — the admin chose to save — but it surfaces the ambiguity
      // so they can resolve it deliberately. (toggleActive enforces uniqueness
      // atomically when activating; this catches trigger-reassignment cases.)
      const savedTrigger = editForm.triggerType ?? 'manual';
      const currentTemplate = (templates ?? []).find((t) => t.id === editForm.id);
      const willBeActive = currentTemplate?.isActive ?? false;
      const conflict =
        willBeActive && savedTrigger !== 'manual'
          ? (templates ?? []).find(
              (other) =>
                other.id !== editForm.id && other.triggerType === savedTrigger && other.isActive,
            )
          : undefined;

      await setDoc(
        doc(db, COLLECTIONS.emailTemplates, editForm.id),
        {
          name: editForm.name,
          description: editForm.description,
          subject: editForm.subject,
          bodyHtml: editForm.bodyHtml,
          triggerType: editForm.triggerType,
          recipient: editForm.recipient,
          scheduledDays: editForm.scheduledDays,
          maxReminders: editForm.maxReminders,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      if (conflict) {
        toast.warning('Duplicate active trigger', {
          description: `"${conflict.name}" is also active for "${TRIGGER_LABELS[savedTrigger]}". Deactivate one to avoid ambiguity.`,
          icon: <AlertTriangle className="h-4 w-4" />,
        });
      }

      setExpandedId(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function createTemplate() {
    const newId = `custom-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
    const newDoc: Record<string, unknown> = {
      templateId: newId,
      name: 'New Template',
      description: '',
      subject: 'Subject line here',
      bodyHtml: '<p>Email body here. Use {{appName}}, {{observedName}}, etc.</p>',
      variables: [],
      triggerType: 'manual',
      recipient: 'observed',
      scheduledDays: 3,
      maxReminders: 5,
      isActive: false,
      isSystem: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, COLLECTIONS.emailTemplates, newId), newDoc);
      setExpandedId(newId);
      setEditForm({ ...newDoc, id: newId });
    } catch (err) {
      toast.error('Failed to create template', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  async function deleteTemplate(t: TemplateDoc) {
    try {
      await deleteDoc(doc(db, COLLECTIONS.emailTemplates, t.id));
      setDeleteTarget(null);
      if (expandedId === t.id) setExpandedId(null);
    } catch (err) {
      toast.error('Failed to delete template', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  function openTestDialog(templateId: string) {
    setTestTemplateId(templateId);
    setTestEmail(user?.email ?? '');
    setTestResult(null);
    setTestDialogOpen(true);
  }

  async function sendTest() {
    if (!testTemplateId || !testEmail) return;
    setTestSending(true);
    setTestResult(null);
    try {
      await sendManualEmailFn({
        templateId: testTemplateId,
        toEmail: testEmail,
        vars: Object.fromEntries(KNOWN_TEMPLATE_VARIABLES.map((v) => [v, SAMPLE_VARS[v]])),
        // Test sends may exercise any template (automatic or inactive);
        // the function prefixes the subject with [TEST].
        isTest: true,
      });
      setTestResult('sent');
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setTestSending(false);
    }
  }

  function substitutePreview(html: string): string {
    const content = html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return (
        (SAMPLE_VARS as Partial<Record<TemplateVariable, string>>)[key as TemplateVariable] ??
        `[${key}]`
      );
    });
    return renderEmailShell(content, {
      appName: branding.appName,
      logoUrl: branding.logoUrl,
      signInLink: SAMPLE_VARS.signInLink,
    });
  }

  return (
    <PageHeader
      title="Email Templates"
      subtitle="Manage notification templates. System templates can be toggled but not deleted."
      variant="light"
      breadcrumb={['Admin', 'Email Templates']}
      actions={
        <Button onClick={() => void createTemplate()}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Template
        </Button>
      }
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load templates: {error.message}
        </div>
      ) : null}

      {/* Filter bar */}
      <div className="mb-4 flex gap-2">
        {(['all', 'manual', 'automatic', 'scheduled'] as FilterCategory[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Template list */}
      <div className="border-border bg-background divide-border divide-y rounded-lg border">
        {loading && !templates ? (
          <>
            <span className="sr-only" role="status" aria-live="polite">
              Loading email templates…
            </span>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`skeleton-${String(i)}`} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-5 w-5 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-72" />
                </div>
                <Skeleton className="h-7 w-16" />
              </div>
            ))}
          </>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">No templates.</p>
        ) : (
          filtered.map((t) => (
            <TemplateRow
              key={t.id}
              template={t}
              expanded={expandedId === t.id}
              editForm={editForm}
              saving={saving}
              saveError={saveError}
              onToggle={() => void toggleActive(t)}
              onEditToggle={() => openEditor(t)}
              onFormChange={setEditForm}
              onSave={() => void saveTemplate()}
              onOpenTest={() => openTestDialog(t.id)}
              onDelete={() => setDeleteTarget(t)}
              substitutePreview={substitutePreview}
            />
          ))
        )}
      </div>

      {/* Test send dialog */}
      <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Send this template with sample data to any address. Works for automatic and inactive
              templates too — the subject is prefixed with [TEST] and no real recipients are
              involved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="test-email">Send to</Label>
            <Input
              id="test-email"
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
          {testResult === 'sent' ? (
            <p className="text-sm text-green-700">Test email sent!</p>
          ) : testResult ? (
            <p className="text-destructive text-sm">{testResult}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void sendTest()} disabled={testSending || !testEmail}>
              {testSending ? 'Sending…' : 'Send Test'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Template</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && void deleteTemplate(deleteTarget)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageHeader>
  );
}

// ── TemplateRow sub-component ───────────────────────────────────────────────

interface TemplateRowProps {
  template: TemplateDoc;
  expanded: boolean;
  editForm: Partial<TemplateDoc>;
  saving: boolean;
  saveError: string | null;
  onToggle: () => void;
  onEditToggle: () => void;
  onFormChange: (form: Partial<TemplateDoc>) => void;
  onSave: () => void;
  onOpenTest: () => void;
  onDelete: () => void;
  substitutePreview: (html: string) => string;
}

function TemplateRow({
  template: t,
  expanded,
  editForm,
  saving,
  saveError,
  onToggle,
  onEditToggle,
  onFormChange,
  onSave,
  onOpenTest,
  onDelete,
  substitutePreview,
}: TemplateRowProps) {
  const triggerType = editForm.triggerType ?? t.triggerType;
  const relevantVars: TemplateVariable[] = (
    TRIGGER_VARIABLES as Partial<Record<EmailTriggerType, TemplateVariable[]>>
  )[triggerType] ?? [...KNOWN_TEMPLATE_VARIABLES];
  const isScheduled = triggerType.startsWith('scheduled.');
  // Show the "Max sends" field for any capped scheduled reminder trigger.
  const isCappedReminder =
    triggerType === 'scheduled.reminderIncomplete' ||
    triggerType === 'scheduled.reminderUnacknowledged';

  return (
    <div>
      {/* Row header */}
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Active toggle */}
        <button
          role="switch"
          aria-checked={t.isActive}
          onClick={onToggle}
          className={`focus-visible:ring-ring relative mt-1 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
            t.isActive ? 'bg-green-500' : 'bg-gray-300'
          }`}
          title={t.isActive ? 'Active — click to disable' : 'Inactive — click to enable'}
        >
          <span
            className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
              t.isActive ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>

        {/* Name + badges — wrap on narrow screens so each badge stays
            readable instead of overflowing. */}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium break-words">{t.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
              {TRIGGER_LABELS[t.triggerType]}
            </span>
            <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {RECIPIENT_LABELS[t.recipient]}
            </span>
            {t.isSystem ? (
              <span className="inline-flex items-center rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500">
                System
              </span>
            ) : null}
          </div>
        </div>

        {/* Edit toggle */}
        <Button variant="ghost" size="sm" onClick={onEditToggle} className="shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="ml-1 hidden sm:inline">{expanded ? 'Close' : 'Edit'}</span>
        </Button>
      </div>

      {/* Inline editor */}
      {expanded ? (
        <div className="border-border bg-muted/30 space-y-4 border-t px-4 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={editForm.name ?? ''}
                onChange={(e) => onFormChange({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={editForm.description ?? ''}
                onChange={(e) => onFormChange({ ...editForm, description: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label>Subject</Label>
            <Input
              value={editForm.subject ?? ''}
              onChange={(e) => onFormChange({ ...editForm, subject: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Trigger</Label>
              <select
                className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                value={editForm.triggerType ?? t.triggerType}
                onChange={(e) =>
                  onFormChange({ ...editForm, triggerType: e.target.value as EmailTriggerType })
                }
              >
                {EMAIL_TRIGGER_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {TRIGGER_LABELS[tt]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>Recipient</Label>
              <select
                className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                value={editForm.recipient ?? t.recipient}
                onChange={(e) =>
                  onFormChange({ ...editForm, recipient: e.target.value as EmailRecipientType })
                }
              >
                {EMAIL_RECIPIENT_TYPES.map((r) => (
                  <option key={r} value={r}>
                    {RECIPIENT_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            {isScheduled ? (
              <div className="grid gap-1.5">
                <Label>Days</Label>
                <Input
                  type="number"
                  min={1}
                  value={editForm.scheduledDays ?? t.scheduledDays}
                  onChange={(e) =>
                    onFormChange({ ...editForm, scheduledDays: Number(e.target.value) })
                  }
                />
              </div>
            ) : null}
          </div>

          {isCappedReminder ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5 sm:col-start-3">
                <Label htmlFor={`max-reminders-${t.id}`}>Max sends</Label>
                <Input
                  id={`max-reminders-${t.id}`}
                  type="number"
                  min={1}
                  value={editForm.maxReminders ?? t.maxReminders}
                  onChange={(e) =>
                    onFormChange({ ...editForm, maxReminders: Number(e.target.value) })
                  }
                  aria-describedby={`max-reminders-hint-${t.id}`}
                />
                <p id={`max-reminders-hint-${t.id}`} className="text-muted-foreground text-xs">
                  Stop sending after this many daily reminders per observation.
                </p>
              </div>
            </div>
          ) : null}

          {/* Body editor — visual with variable pills, raw-HTML fallback */}
          <EmailBodyField
            value={editForm.bodyHtml ?? ''}
            onChange={(html) => onFormChange({ ...editForm, bodyHtml: html })}
            variables={relevantVars}
          />

          {/* Preview — sandboxed iframe prevents script execution */}
          {editForm.bodyHtml ? (
            <div className="border-border rounded-md border bg-white p-3">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                Preview (sample data)
              </p>
              <iframe
                sandbox=""
                srcDoc={substitutePreview(editForm.bodyHtml)}
                className="min-h-[440px] w-full border-0"
                title="Email preview"
              />
            </div>
          ) : null}

          {saveError ? <p className="text-destructive text-sm">{saveError}</p> : null}

          {/* Action row */}
          <div className="flex items-center gap-2">
            <Button onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" onClick={onOpenTest}>
              <Mail className="mr-1.5 h-4 w-4" />
              Send Test…
            </Button>
            {!t.isSystem ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive ml-auto"
                onClick={onDelete}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
