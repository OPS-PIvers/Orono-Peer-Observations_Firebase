import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  SIGNUP_FIELD_APPLIES_TO,
  SIGNUP_FIELD_TYPES,
  type SignupField,
  type SignupFieldAppliesTo,
  type SignupFieldType,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';

const TYPE_LABELS: Record<SignupFieldType, string> = {
  select: 'Single-select dropdown',
  'period-picker': 'Period picker (from bell schedule)',
  'before-after': 'Before / after school',
};

const APPLIES_LABELS: Record<SignupFieldAppliesTo, string> = {
  direct: 'Direct booking only',
  'day-preference': 'Day preference only',
  both: 'Both modes',
};

type FieldRow = SignupField & { id: string };

export function SignupFieldsPage() {
  const {
    data: fields,
    loading,
    error,
  } = useFirestoreCollection<SignupField>(COLLECTIONS.signupFields);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftType, setDraftType] = useState<SignupFieldType>('select');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const sorted = (fields ?? []).slice().sort((a, b) => a.order - b.order);

  async function add() {
    setAddError(null);
    const label = draftLabel.trim();
    if (!label) {
      setAddError('Field label is required.');
      return;
    }
    setAdding(true);
    try {
      const fieldId = `f-${String(Date.now())}`;
      await setDoc(doc(db, COLLECTIONS.signupFields, fieldId), {
        fieldId,
        label,
        type: draftType,
        options: [],
        appliesTo: 'both',
        required: false,
        order: sorted.length,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDraftLabel('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setAdding(false);
    }
  }

  async function update(f: FieldRow, patch: Partial<SignupField>) {
    await setDoc(
      doc(db, COLLECTIONS.signupFields, f.id),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async function destroy(id: string) {
    await deleteDoc(doc(db, COLLECTIONS.signupFields, id));
  }

  return (
    <PageHeader
      title="Sign-up Detail Fields"
      subtitle="Optional details staff fill in when they book an observation or express a day preference. Period-picker fields list the staff member's own building periods; before/after-school fields offer a fixed choice. Deactivate to hide a field without losing history."
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load fields: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background mb-6 max-w-3xl rounded-lg border p-4">
        <div className="flex items-start gap-2">
          <Input
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Add a field label…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
          />
          <select
            value={draftType}
            onChange={(e) => setDraftType(e.target.value as SignupFieldType)}
            className="border-input h-9 rounded-md border bg-white px-2 text-sm"
            aria-label="New field type"
          >
            {SIGNUP_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <Button onClick={() => void add()} disabled={adding}>
            <Plus />
            Add
          </Button>
        </div>
        {addError ? <p className="text-destructive mt-2 text-sm">{addError}</p> : null}
      </div>

      {loading && !fields ? (
        <ol className="max-w-3xl space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={`skeleton-${String(i)}`}
              className="border-border bg-background rounded-md border p-4"
            >
              <Skeleton className="h-9 w-full" />
            </li>
          ))}
        </ol>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">No fields yet. Add one above.</p>
      ) : (
        <ol className="max-w-3xl space-y-3">
          {sorted.map((f, idx) => (
            <li key={f.id} className="border-border bg-background space-y-3 rounded-md border p-4">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground w-6 text-right text-sm">{idx + 1}.</span>
                <Input
                  value={f.label}
                  onChange={(e) => void update(f, { label: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => void destroy(f.id)}
                  aria-label="Delete field"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-4 pl-8">
                <div className="grid gap-1">
                  <Label className="text-xs">Type</Label>
                  <select
                    value={f.type}
                    onChange={(e) => void update(f, { type: e.target.value as SignupFieldType })}
                    className="border-input h-9 rounded-md border bg-white px-2 text-sm"
                  >
                    {SIGNUP_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs">Applies to</Label>
                  <select
                    value={f.appliesTo}
                    onChange={(e) =>
                      void update(f, { appliesTo: e.target.value as SignupFieldAppliesTo })
                    }
                    className="border-input h-9 rounded-md border bg-white px-2 text-sm"
                  >
                    {SIGNUP_FIELD_APPLIES_TO.map((a) => (
                      <option key={a} value={a}>
                        {APPLIES_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="mt-4 flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => void update(f, { required: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Required
                </label>
                <label className="mt-4 flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={f.isActive}
                    onChange={(e) => void update(f, { isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Active
                </label>
              </div>

              {f.type === 'select' ? (
                <OptionsEditor field={f} onChange={(options) => void update(f, { options })} />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </PageHeader>
  );
}

function OptionsEditor({
  field,
  onChange,
}: {
  field: FieldRow;
  onChange: (options: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2 pl-8">
      <Label className="text-xs">Dropdown options</Label>
      {field.options.length === 0 ? (
        <p className="text-muted-foreground text-xs">No options yet — add at least one.</p>
      ) : (
        <ul className="space-y-1">
          {field.options.map((opt, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-sm">{opt}</span>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive h-7 w-7"
                onClick={() => onChange(field.options.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${opt}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an option…"
          className="max-w-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...field.options, draft.trim()]);
              setDraft('');
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (draft.trim()) {
              onChange([...field.options, draft.trim()]);
              setDraft('');
            }
          }}
        >
          Add option
        </Button>
      </div>
    </div>
  );
}
