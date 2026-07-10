import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Loader2, Plus } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Rubric } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/PageHeader';
import {
  AdminDataView,
  type AdminDataViewSort,
  type ColumnDef,
} from '@/admin/_shared/AdminDataView';
import { sortRows } from '@/admin/_shared/sortRows';
import { AdminSearchInput } from '@/admin/_shared/AdminSearchInput';

interface RubricRow extends Rubric {
  id: string;
  componentCount: number;
}

export function RubricsListPage() {
  const { data: rubrics, loading, error } = useFirestoreCollection<Rubric>(COLLECTIONS.rubrics);
  const [sort, setSort] = useState<AdminDataViewSort | null>({
    key: 'displayName',
    direction: 'asc',
  });
  const [duplicating, setDuplicating] = useState<RubricRow | null>(null);
  const [search, setSearch] = useState('');

  const decorated: RubricRow[] = useMemo(
    () =>
      (rubrics ?? []).map((r) => ({
        ...r,
        componentCount: r.domains.reduce((sum, d) => sum + d.components.length, 0),
      })),
    [rubrics],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return decorated;
    return decorated.filter(
      (r) => r.displayName.toLowerCase().includes(q) || r.rubricId.toLowerCase().includes(q),
    );
  }, [decorated, search]);

  const existingIds = useMemo(() => new Set((rubrics ?? []).map((r) => r.id)), [rubrics]);

  const columns: ColumnDef<RubricRow>[] = useMemo(
    () => [
      {
        key: 'displayName',
        header: 'Display name',
        cellClassName: 'font-medium',
        sortAccessor: (r) => r.displayName,
        cell: (r) => r.displayName,
        mobile: { primary: true },
      },
      {
        key: 'rubricId',
        header: 'Rubric ID',
        cellClassName: 'text-muted-foreground font-mono text-xs',
        sortAccessor: (r) => r.rubricId,
        cell: (r) => r.rubricId,
      },
      {
        key: 'domains',
        header: 'Domains',
        headClassName: 'w-24',
        sortAccessor: (r) => r.domains.length,
        cell: (r) => r.domains.length,
      },
      {
        key: 'components',
        header: 'Components',
        headClassName: 'w-28',
        sortAccessor: (r) => r.componentCount,
        cell: (r) => r.componentCount,
      },
    ],
    [],
  );

  const sorted = useMemo(() => sortRows(filtered, columns, sort), [filtered, columns, sort]);

  return (
    <PageHeader
      variant="light"
      breadcrumb={['Admin', 'Rubrics']}
      title="Rubrics"
      subtitle="One rubric per role. Each rubric has 4 domains and a variable number of components with proficiency descriptors, best practices, and look-fors. Duplicate a rubric to start a new version — finalized observations keep a snapshot of the rubric text they were scored against."
      actions={
        <Button asChild>
          <Link to="/admin/roles">
            <Plus />
            Add role
          </Link>
        </Button>
      }
    >
      <AdminSearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search by name or rubric ID"
        aria-label="Search rubrics"
        className="mb-4"
      />

      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load rubrics: {error.message}
        </div>
      ) : null}

      <AdminDataView
        columns={columns}
        rows={loading && !rubrics ? null : sorted}
        loading={loading}
        rowKey={(r) => r.id}
        empty={
          search ? 'No rubrics match that search.' : 'No rubrics yet. Add a role to get started.'
        }
        sort={sort}
        onSortChange={setSort}
        rowActions={(r) => (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to={`/admin/rubrics/${r.id}`}>Edit</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDuplicating(r)}
              aria-label={`Duplicate ${r.displayName}`}
            >
              <Copy />
              Duplicate
            </Button>
          </div>
        )}
      />

      {duplicating ? (
        <DuplicateRubricDialog
          // Remount per source so the form state re-initializes from the
          // clicked rubric instead of a previous duplication attempt.
          key={duplicating.id}
          source={duplicating}
          existingIds={existingIds}
          onClose={() => setDuplicating(null)}
        />
      ) : null}
    </PageHeader>
  );
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** First "-copy" / "-copy-N" suffix of the source id that isn't taken. */
function suggestCopyId(sourceId: string, existingIds: Set<string>): string {
  const base = `${sourceId}-copy`;
  if (!existingIds.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${String(n)}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return base;
}

/**
 * Confirm dialog for duplicating a rubric into a new document — the
 * "start next year's version" workflow. The copy is a full deep clone
 * (domains, components, proficiency descriptors, look-fors, colors);
 * nothing points at it until an admin assigns the new rubric ID to a role,
 * so the live rubric keeps serving existing roles untouched.
 */
function DuplicateRubricDialog({
  source,
  existingIds,
  onClose,
}: {
  source: RubricRow;
  existingIds: Set<string>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState(`${source.displayName} (Copy)`);
  const [rubricId, setRubricId] = useState(() => suggestCopyId(source.rubricId, existingIds));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function duplicate() {
    setFormError(null);
    const name = displayName.trim();
    const id = rubricId.trim();
    if (!name) {
      setFormError('Display name is required.');
      return;
    }
    if (!SLUG_RE.test(id) || id.length > 64) {
      setFormError('Rubric ID must be lower-kebab-case (e.g. "teacher-2027"), max 64 characters.');
      return;
    }
    if (existingIds.has(id)) {
      setFormError(`A rubric with ID "${id}" already exists — pick a different ID.`);
      return;
    }

    setSubmitting(true);
    try {
      await setDoc(doc(db, COLLECTIONS.rubrics, id), {
        rubricId: id,
        displayName: name,
        domains: source.domains,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      onClose();
      void navigate(`/admin/rubrics/${id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Duplicate failed');
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate rubric</DialogTitle>
          <DialogDescription>
            Copies every domain, component, proficiency descriptor, and look-for of{' '}
            <strong>{source.displayName}</strong> into a new rubric — the starting point for a new
            version (e.g. next evaluation year). Point a role at the new rubric ID when you&apos;re
            ready to adopt it; observations already finalized keep the rubric text they were scored
            against.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="duplicate-display-name">Display name</Label>
            <Input
              id="duplicate-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
              maxLength={80}
              disabled={submitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="duplicate-rubric-id">New rubric ID</Label>
            <Input
              id="duplicate-rubric-id"
              value={rubricId}
              onChange={(e) => setRubricId(e.target.value)}
              autoComplete="off"
              className="font-mono text-xs"
              placeholder="e.g. teacher-2027"
              disabled={submitting}
            />
          </div>

          {formError ? (
            <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-3 py-2 text-sm">
              {formError}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting} type="button">
            Cancel
          </Button>
          <Button onClick={() => void duplicate()} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Duplicating…
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Duplicate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
