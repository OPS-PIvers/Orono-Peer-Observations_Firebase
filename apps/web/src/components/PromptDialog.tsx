import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toSafeUrl } from '@ops/shared';

export interface PromptField {
  key: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  /** 'url' fields are validated to block javascript:/data:/etc — only http:, https:, and mailto: are allowed. */
  type?: 'text' | 'url';
  /** For 'url' fields: also accept a single `{{templateVariable}}` token (used by email CTA links). */
  allowTemplateToken?: boolean;
  required?: boolean;
}

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: PromptField[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Called with trimmed field values keyed by field.key when the user confirms. */
  onConfirm: (values: Record<string, string>) => void;
}

/**
 * Generic "prompt for a string" dialog — a shadcn Dialog + Input replacement
 * for `window.prompt()`. Supports one or more fields (e.g. label + URL for a
 * CTA button) and optional URL protocol validation so link-collecting sites
 * can't be used to inject a `javascript:` (or other non-allowlisted-protocol) href.
 *
 * Dismissing the dialog (Cancel, overlay click, Esc) never calls onConfirm,
 * matching `window.prompt` returning `null`.
 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  onConfirm,
}: PromptDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? ''])));
    setError(null);
    // Only re-run when the dialog opens — `fields` is expected to be a
    // stable-enough literal per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();

    // The URL fields are prefilled with a bare 'https://' placeholder (see
    // call sites). If the user saves without actually typing a URL, that
    // isn't a real edit -- treat it as Cancel instead of surfacing a
    // validation error for a value the user never chose.
    const hasUntouchedPlaceholder = fields.some((field) => {
      if (field.type !== 'url') return false;
      const raw = (values[field.key] ?? '').trim();
      return raw === 'https://' || raw === 'http://';
    });
    if (hasUntouchedPlaceholder) {
      onOpenChange(false);
      return;
    }

    const normalized: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.key] ?? '').trim();
      if (field.required && value === '') {
        setError(`${field.label} is required.`);
        return;
      }
      if (field.type === 'url') {
        const safe = toSafeUrl(value, { allowTemplateToken: field.allowTemplateToken ?? false });
        if (safe === null) {
          setError(`${field.label} must be a valid web address (http://, https://, or mailto:).`);
          return;
        }
        normalized[field.key] = safe;
      } else {
        normalized[field.key] = value;
      }
    }
    onConfirm(normalized);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {fields.map((field) => (
              <div className="grid gap-2" key={field.key}>
                <Label htmlFor={`prompt-dialog-${field.key}`}>{field.label}</Label>
                <Input
                  id={`prompt-dialog-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              </div>
            ))}

            {error ? (
              <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
                {error}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
