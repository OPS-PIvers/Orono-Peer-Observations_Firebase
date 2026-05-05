import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Mail, Plus, Trash2 } from 'lucide-react';
import { deleteDoc, doc, orderBy, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  EMAIL_RECIPIENT_TYPES,
  EMAIL_TRIGGER_TYPES,
  KNOWN_TEMPLATE_VARIABLES,
  type EmailRecipientType,
  type EmailTemplate,
  type EmailTriggerType,
  type TemplateVariable,
} from '@ops/shared';
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
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';

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
};

const RECIPIENT_LABELS: Record<EmailRecipientType, string> = {
  observed: 'To: Staff',
  observer: 'To: PE',
  both: 'To: Both',
  admin: 'To: Admin',
};

const TRIGGER_VARIABLES: Record<EmailTriggerType, TemplateVariable[]> = {
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
  'staff.created': ['staffName', 'staffEmail', 'staffRole', 'signInLink', 'appName'],
  'roleYearMapping.updated': [
    'staffName',
    'staffEmail',
    'staffRole',
    'assignedComponentCount',
    'assignedDomainList',
    'signInLink',
    'appName',
  ],
  'scheduled.preObservation': [
    'observedName',
    'observedEmail',
    'observerName',
    'observationDate',
    'observationName',
    'signInLink',
    'appName',
  ],
  'scheduled.reminderIncomplete': [
    'observedName',
    'observedEmail',
    'observationType',
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
  assignedDomainList: '3 components assigned',
  assignedComponentCount: '3',
  signupLink: 'https://calendly.com/example',
};

// ── Callable ───────────────────────────────────────────────────────────────

const sendManualEmailFn = httpsCallable<
  { templateId: string; toEmail: string; vars: Record<string, string> },
  { sent: boolean }
>(functions, 'sendManualEmail');

// ── Component ──────────────────────────────────────────────────────────────

type TemplateDoc = EmailTemplate & { id: string };

export function EmailTemplatesPage() {
  const { user } = useAuth();
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
    await setDoc(
      doc(db, COLLECTIONS.emailTemplates, t.id),
      { isActive: !t.isActive, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async function saveTemplate() {
    if (!editForm.id) return;
    setSaving(true);
    setSaveError(null);
    try {
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
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
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
      isActive: false,
      isSystem: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, COLLECTIONS.emailTemplates, newId), newDoc);
    setExpandedId(newId);
    setEditForm({ ...newDoc, id: newId });
  }

  async function deleteTemplate(t: TemplateDoc) {
    await deleteDoc(doc(db, COLLECTIONS.emailTemplates, t.id));
    setDeleteTarget(null);
    if (expandedId === t.id) setExpandedId(null);
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
      });
      setTestResult('sent');
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setTestSending(false);
    }
  }

  function copyVariable(v: string) {
    void navigator.clipboard.writeText(`{{${v}}}`);
  }

  function substitutePreview(html: string): string {
    return html.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      return (
        (SAMPLE_VARS as Partial<Record<TemplateVariable, string>>)[key as TemplateVariable] ??
        `[${key}]`
      );
    });
  }

  return (
    <PageHeader
      title="Email Templates"
      subtitle="Manage notification templates. System templates can be toggled but not deleted."
      actions={
        <Button
          onClick={() => void createTemplate()}
          className="text-ops-blue-dark bg-white hover:bg-white/90"
        >
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
          Array.from({ length: 4 }).map((_, i) => (
            <div key={`skeleton-${String(i)}`} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-5 w-5 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          ))
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
              onCopyVariable={copyVariable}
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
              Send this template with sample data to any address.
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
  onCopyVariable: (v: string) => void;
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
  onCopyVariable,
  substitutePreview,
}: TemplateRowProps) {
  const triggerType = editForm.triggerType ?? t.triggerType;
  const relevantVars: TemplateVariable[] = (
    TRIGGER_VARIABLES as Partial<Record<EmailTriggerType, TemplateVariable[]>>
  )[triggerType] ?? [...KNOWN_TEMPLATE_VARIABLES];
  const isScheduled = triggerType.startsWith('scheduled.');

  return (
    <div>
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Active toggle */}
        <button
          role="switch"
          aria-checked={t.isActive}
          onClick={onToggle}
          className={`focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
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

        {/* Name + badges */}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">{t.name}</span>
          <span className="ml-2 inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
            {TRIGGER_LABELS[t.triggerType]}
          </span>
          <span className="ml-1 inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
            {RECIPIENT_LABELS[t.recipient]}
          </span>
          {t.isSystem ? (
            <span className="ml-1 inline-flex items-center rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500">
              System
            </span>
          ) : null}
        </div>

        {/* Edit toggle */}
        <Button variant="ghost" size="sm" onClick={onEditToggle} className="shrink-0">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="ml-1">{expanded ? 'Close' : 'Edit'}</span>
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

          {/* Variable chips */}
          <div className="border-border bg-background rounded-md border p-3">
            <p className="text-muted-foreground mb-2 text-xs font-medium">
              Available variables — click to copy
            </p>
            <div className="flex flex-wrap gap-1.5">
              {relevantVars.map((v) => (
                <button
                  key={v}
                  onClick={() => onCopyVariable(v)}
                  className="rounded bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700 transition-colors hover:bg-blue-100"
                  title={`Copy {{${v}}}`}
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* Body HTML editor */}
          <div className="grid gap-1.5">
            <Label>Body HTML</Label>
            <Textarea
              className="min-h-[300px] font-mono text-xs"
              value={editForm.bodyHtml ?? ''}
              onChange={(e) => onFormChange({ ...editForm, bodyHtml: e.target.value })}
            />
          </div>

          {/* Preview — sandboxed iframe prevents script execution */}
          {editForm.bodyHtml ? (
            <div className="border-border rounded-md border bg-white p-3">
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                Preview (sample data)
              </p>
              <iframe
                sandbox=""
                srcDoc={substitutePreview(editForm.bodyHtml)}
                className="min-h-[160px] w-full border-0"
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
