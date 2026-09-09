import { useId } from 'react';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { URL_OPEN, URL_TAIL_HINT } from './copyStrings';

/**
 * Field primitives shared by the three dashboard editor tabs.
 *
 * - `Field`    — label (text-sm, not the old text-xs) + control + inline
 *                error line. The control gets `aria-invalid` and
 *                `aria-describedby` wired to the error automatically.
 * - `TextField`— `Field` around an `<Input>`.
 * - `UrlField` — `TextField` plus a readout of the *end* of the value.
 *                A Drive share link is ~90 characters and the input only
 *                shows the first ~40, so the part that actually identifies
 *                the file (`…/d/1AbC…/view`) was invisible. The readout
 *                shows the last `tailLength` characters and, when the
 *                value parses as http(s), an "Open" link.
 */

export interface FieldProps {
  label: string;
  error?: string | undefined;
  /** Optional helper text under the label. */
  hint?: string | undefined;
  className?: string | undefined;
  children: (a: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => React.ReactNode;
}

export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {hint ? <p className="text-muted-foreground -mt-0.5 text-xs">{hint}</p> : null}
      {children({ id, describedBy: invalid ? errorId : undefined, invalid })}
      {invalid ? (
        <p
          id={errorId}
          role="alert"
          className="text-ops-red-dark inline-flex items-center gap-1 text-xs font-medium"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  maxLength?: number | undefined;
  className?: string | undefined;
  inputClassName?: string | undefined;
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  maxLength,
  className,
  inputClassName,
}: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            invalid && 'border-destructive focus-visible:ring-destructive',
            inputClassName,
          )}
        />
      )}
    </Field>
  );
}

/** Characters of the URL to surface in the tail readout. */
const DEFAULT_TAIL = 44;

export function urlTail(value: string, tailLength = DEFAULT_TAIL): string | null {
  const v = value.trim();
  if (v.length <= tailLength) return null;
  return `…${v.slice(-tailLength)}`;
}

export function isOpenableUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function UrlField({
  tailLength = DEFAULT_TAIL,
  ...props
}: TextFieldProps & { tailLength?: number | undefined }) {
  const tail = urlTail(props.value, tailLength);
  const openable = isOpenableUrl(props.value);
  return (
    <div className="grid gap-1">
      <TextField {...props} inputClassName={cn('font-mono text-[13px]', props.inputClassName)} />
      {tail || openable ? (
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
          {tail ? (
            <span className="min-w-0 truncate" title={props.value}>
              <span className="mr-1">{URL_TAIL_HINT}</span>
              <span className="text-foreground font-mono">{tail}</span>
            </span>
          ) : null}
          {openable ? (
            <a
              href={props.value.trim()}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ops-blue ml-auto inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {URL_OPEN}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
