import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Rubric } from '@ops/shared';
import { db } from '@/lib/firebase';
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

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** 4-domain scaffold used when creating a blank rubric. Domain IDs follow the
 *  Danielson convention ("1"–"4"); each domain starts with one placeholder
 *  component so the editor doesn't show an empty/invalid state. */
function makeScaffoldDomains(): Rubric['domains'] {
  return [1, 2, 3, 4].map((n) => ({
    id: String(n),
    name: `Domain ${String(n)}`,
    components: [
      {
        id: `${String(n)}a`,
        title: 'New component',
        proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
        lookFors: [],
      },
    ],
  }));
}

/** Deep-copy all domains from source rubric, used for "Duplicate" flow.
 *  Mirrors the sanitizeDomains helper in RubricEditorPage — strips any
 *  `color: undefined` stray keys so Firestore never sees an undefined field. */
function deepCopyDomains(source: Rubric): Rubric['domains'] {
  return source.domains.map((d) => ({
    ...d,
    components: d.components.map((c) => {
      const copy = { ...c, lookFors: c.lookFors.map((lf) => ({ ...lf })) };
      if (copy.color === undefined) delete copy.color;
      return copy;
    }),
  }));
}

export interface CreateRubricDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing rubrics to offer a "copy from" dropdown. Pass null/undefined
   *  while the collection is still loading. */
  existingRubrics: (Rubric & { id: string })[] | null | undefined;
  /** Pre-filled rubricId (e.g. derived from a freshly created role). When
   *  supplied and the user hasn't manually edited the rubric-id field, it is
   *  kept in sync with this value. */
  prefillRubricId?: string;
}

interface FormState {
  displayName: string;
  rubricId: string;
  copyFromId: string;
}

const emptyForm: FormState = {
  displayName: '',
  rubricId: '',
  copyFromId: '',
};

export function CreateRubricDialog({
  open,
  onOpenChange,
  existingRubrics,
  prefillRubricId,
}: CreateRubricDialogProps) {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setForm({
        displayName: '',
        rubricId: prefillRubricId ?? '',
        copyFromId: '',
      });
      setError(null);
    }
  }, [open, prefillRubricId]);

  /** Auto-derives the rubricId slug from the display name, unless the user has
   *  manually set it to something other than the auto-derived value. */
  function handleDisplayNameChange(name: string) {
    setForm((f) => {
      const autoSlug = slugify(f.displayName);
      const shouldSync = f.rubricId === autoSlug || f.rubricId === '';
      return {
        ...f,
        displayName: name,
        rubricId: shouldSync ? slugify(name) : f.rubricId,
      };
    });
  }

  const existingIds = new Set((existingRubrics ?? []).map((r) => r.rubricId));

  async function handleSubmit() {
    setError(null);

    if (!form.displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (!form.rubricId || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.rubricId)) {
      setError('Rubric ID must be lower-kebab-case (e.g. "library-media-specialist").');
      return;
    }
    if (existingIds.has(form.rubricId)) {
      setError(`A rubric with ID "${form.rubricId}" already exists. Choose a different ID.`);
      return;
    }

    const sourceRubric =
      form.copyFromId !== ''
        ? (existingRubrics ?? []).find((r) => r.rubricId === form.copyFromId)
        : undefined;

    const domains = sourceRubric ? deepCopyDomains(sourceRubric) : makeScaffoldDomains();

    setSubmitting(true);
    try {
      await setDoc(doc(db, COLLECTIONS.rubrics, form.rubricId), {
        rubricId: form.rubricId,
        displayName: form.displayName.trim(),
        domains,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onOpenChange(false);
      void navigate(`/admin/rubrics/${form.rubricId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New rubric</DialogTitle>
          <DialogDescription>
            Creates a blank 4-domain rubric (or a copy of an existing one) and opens the editor.
            Rubric ID is stable — it links roles, observations, and role/year mappings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="cr-displayName">Display name</Label>
            <Input
              id="cr-displayName"
              value={form.displayName}
              onChange={(e) => handleDisplayNameChange(e.target.value)}
              autoComplete="off"
              placeholder="Library Media Specialist"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cr-rubricId">Rubric ID</Label>
            <Input
              id="cr-rubricId"
              value={form.rubricId}
              onChange={(e) => setForm((f) => ({ ...f, rubricId: e.target.value }))}
              autoComplete="off"
              className="font-mono text-xs"
              placeholder="library-media-specialist"
            />
            <p className="text-muted-foreground text-xs">
              Lower-kebab-case. Stable after creation — changing it would break existing
              observations.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="cr-copyFrom">Copy from existing rubric (optional)</Label>
            <select
              id="cr-copyFrom"
              value={form.copyFromId}
              onChange={(e) => setForm((f) => ({ ...f, copyFromId: e.target.value }))}
              disabled={!existingRubrics || existingRubrics.length === 0}
              className="border-input bg-background ring-offset-background focus-visible:ring-ring h-11 min-h-11 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden"
            >
              <option value="">
                {!existingRubrics
                  ? 'Loading…'
                  : existingRubrics.length === 0
                    ? 'No rubrics to copy from'
                    : 'Blank scaffold (4 empty domains)'}
              </option>
              {(existingRubrics ?? []).map((r) => (
                <option key={r.rubricId} value={r.rubricId}>
                  {r.displayName}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} type="button">
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create rubric'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
