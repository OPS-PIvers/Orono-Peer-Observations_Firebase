import { useEffect, useMemo, useState } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { COLLECTIONS, type EmailTemplate, type Staff } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

const MANUAL_TEMPLATE_CONSTRAINTS = [
  where('triggerType', '==', 'manual'),
  where('isActive', '==', true),
  orderBy('name', 'asc'),
];

const SELECT_CLASSNAME =
  'border-input bg-background ring-offset-background focus-visible:ring-ring h-11 min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden';

/**
 * Hard cap mirrored from apps/functions/src/email/sendBulkManualEmail.ts's
 * MAX_BULK_RECIPIENTS. The client can't import a functions-only module, so
 * this is a UI-side pre-check for a friendlier error before the round trip —
 * the callable enforces the real cap regardless.
 */
const MAX_BULK_RECIPIENTS = 200;

interface SendBulkManualEmailResult {
  requested: number;
  sent: number;
  suppressed: string[];
}

const sendBulkManualEmailFn = httpsCallable<
  { templateId: string; toEmails: string[]; vars?: Record<string, string> },
  SendBulkManualEmailResult
>(functions, 'sendBulkManualEmail');

interface MessageGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently-selected staff rows from the Staff page's bulk-select. */
  selectedRows: (Staff & { id: string })[];
  onSent: () => void;
}

type Step = 'compose' | 'confirm';

/**
 * "Message a group" bulk action — broadcasts a manual-trigger email template
 * to every currently-selected staff member via the sendBulkManualEmail
 * callable (PLAT-08). The audience is whatever the admin has filtered
 * (StaffFilterBar's role/building/year/status chips) and selected via the
 * existing bulk-select checkboxes; this dialog only picks the template and
 * confirms the resolved recipient count before sending.
 */
export function MessageGroupDialog({
  open,
  onOpenChange,
  selectedRows,
  onSent,
}: MessageGroupDialogProps) {
  const { data: templatesRaw, loading: templatesLoading } = useFirestoreCollection<EmailTemplate>(
    COLLECTIONS.emailTemplates,
    MANUAL_TEMPLATE_CONSTRAINTS,
  );
  const templates = useMemo(() => templatesRaw ?? [], [templatesRaw]);

  const [templateId, setTemplateId] = useState('');
  const [step, setStep] = useState<Step>('compose');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendBulkManualEmailResult | null>(null);

  // Reset each time the dialog opens so a stale template/result from a prior
  // send doesn't linger into the next one.
  useEffect(() => {
    if (!open) return;
    setTemplateId('');
    setStep('compose');
    setSending(false);
    setError(null);
    setResult(null);
  }, [open]);

  // De-dupe by email (case-insensitive) — defensive against the same staff
  // member appearing twice in a selection.
  const recipients = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of selectedRows) {
      const email = r.email.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
    return out;
  }, [selectedRows]);

  const overCap = recipients.length > MAX_BULK_RECIPIENTS;
  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;

  async function handleSend() {
    if (!selectedTemplate || recipients.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await sendBulkManualEmailFn({
        templateId: selectedTemplate.id,
        toEmails: recipients,
      });
      setResult(res.data);
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Broadcast failed.');
      setStep('compose');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (sending) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Message a group</DialogTitle>
          <DialogDescription>
            Send a manual-trigger email template to every selected staff member in one action.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {result ? (
            <div className="rounded-md border-l-4 border-green-600 bg-green-50 px-3 py-2 text-sm text-green-900">
              <p className="font-medium">
                Sent to {result.sent} of {result.requested} staff member
                {result.requested === 1 ? '' : 's'}.
              </p>
              {result.suppressed.length > 0 ? (
                <p className="mt-1">
                  {result.suppressed.length} opted out of manual messages (Profile → email
                  preferences) and did not receive it: {result.suppressed.join(', ')}
                </p>
              ) : null}
            </div>
          ) : step === 'confirm' && selectedTemplate ? (
            <div className="border-ops-blue bg-ops-blue-lighter/40 rounded-md border-l-4 px-3 py-2 text-sm">
              <p className="font-medium">
                Send “{selectedTemplate.name}” to {recipients.length} staff member
                {recipients.length === 1 ? '' : 's'}?
              </p>
              <p className="text-muted-foreground mt-1">This cannot be undone.</p>
            </div>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="message-group-template">Template</Label>
                <select
                  id="message-group-template"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className={SELECT_CLASSNAME}
                  disabled={templatesLoading}
                >
                  <option value="" disabled>
                    {templatesLoading ? 'Loading…' : 'Choose a manual template…'}
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {!templatesLoading && templates.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    No active manual templates. Create one on the Email Templates page first.
                  </p>
                ) : null}
              </div>

              <p className="text-muted-foreground text-sm">
                {recipients.length} staff member{recipients.length === 1 ? '' : 's'} selected.
              </p>

              {overCap ? (
                <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
                  A broadcast can target at most {MAX_BULK_RECIPIENTS} recipients — narrow the
                  selection to send (currently {recipients.length}).
                </div>
              ) : null}
            </>
          )}

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : step === 'confirm' ? (
            <>
              <Button
                variant="outline"
                type="button"
                onClick={() => setStep('compose')}
                disabled={sending}
              >
                Back
              </Button>
              <Button onClick={() => void handleSend()} disabled={sending}>
                {sending ? 'Sending…' : `Send to ${String(recipients.length)}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => setStep('confirm')}
                disabled={!selectedTemplate || recipients.length === 0 || overCap}
              >
                Continue
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
