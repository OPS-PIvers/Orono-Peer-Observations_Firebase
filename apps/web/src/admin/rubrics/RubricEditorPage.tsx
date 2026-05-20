import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type Rubric, type RubricComponent, type RubricDomain } from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { RubricGridEditor } from './RubricGridEditor';

interface DraftRubric extends Rubric {
  domains: RubricDomain[];
}

export function RubricEditorPage() {
  const { rubricId } = useParams<{ rubricId: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useFirestoreDoc<Rubric>(
    `${COLLECTIONS.rubrics}/${rubricId ?? ''}`,
  );

  const [draft, setDraft] = useState<DraftRubric | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Hydrate once; later snapshots would clobber in-progress edits. Key
  // off the loaded doc's own id so a route change can't briefly hydrate
  // with the previous rubric. Issue #3.
  useHydratedDraft(data?.id ?? null, data, (src) => {
    setDraft(src);
    setDirty(false);
  });

  if (!rubricId) {
    return (
      <div className="text-destructive">
        No rubric ID in URL. Go back to <a href="/admin/rubrics">Rubrics</a>.
      </div>
    );
  }

  if (loading && !draft) return <p className="text-muted-foreground">Loading rubric…</p>;
  if (error)
    return (
      <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
        Failed to load rubric: {error.message}
      </div>
    );
  if (!draft)
    return (
      <div className="border-destructive bg-ops-red-lighter text-ops-red-dark rounded-md border-l-4 px-4 py-3">
        Rubric <code>{rubricId}</code> not found.
      </div>
    );

  function update(next: DraftRubric) {
    setDraft(next);
    setDirty(true);
  }

  function updateComponent(componentId: string, patch: Partial<RubricComponent>) {
    if (!draft) return;
    const next: DraftRubric = {
      ...draft,
      domains: draft.domains.map((d) => ({
        ...d,
        components: d.components.map((c) => (c.id === componentId ? { ...c, ...patch } : c)),
      })),
    };
    update(next);
  }

  function updateDomain(domainId: string, patch: Partial<Omit<RubricDomain, 'components'>>) {
    if (!draft) return;
    const next: DraftRubric = {
      ...draft,
      domains: draft.domains.map((d) => (d.id === domainId ? { ...d, ...patch } : d)),
    };
    update(next);
  }

  function addComponent(domainId: string) {
    if (!draft) return;
    const domain = draft.domains.find((d) => d.id === domainId);
    if (!domain) return;
    const nextLetter = String.fromCharCode(97 + domain.components.length); // a, b, c…
    const newId = `${domainId}${nextLetter}`;
    if (newId.length !== 2) return; // ran out of letters; admin can clean up
    const newComponent: RubricComponent = {
      id: newId,
      title: 'New component',
      proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
      lookFors: [],
    };
    const next: DraftRubric = {
      ...draft,
      domains: draft.domains.map((d) =>
        d.id === domainId ? { ...d, components: [...d.components, newComponent] } : d,
      ),
    };
    update(next);
  }

  function removeComponent(componentId: string) {
    if (!draft) return;
    const next: DraftRubric = {
      ...draft,
      domains: draft.domains.map((d) => ({
        ...d,
        components: d.components.filter((c) => c.id !== componentId),
      })),
    };
    update(next);
  }

  function addDomain() {
    if (!draft) return;
    const nextDomainId = String(draft.domains.length + 1);
    const newDomain: RubricDomain = {
      id: nextDomainId,
      name: `Domain ${nextDomainId}`,
      components: [],
    };
    update({ ...draft, domains: [...draft.domains, newDomain] });
  }

  function findComponent(id: string): RubricComponent | null {
    if (!draft) return null;
    for (const d of draft.domains) {
      const c = d.components.find((cc) => cc.id === id);
      if (c) return c;
    }
    return null;
  }

  function addLookFor(componentId: string) {
    const c = findComponent(componentId);
    if (!c) return;
    const newLookFor = { id: `lf-${String(Date.now())}`, text: '' };
    updateComponent(componentId, { lookFors: [...c.lookFors, newLookFor] });
  }

  function updateLookFor(componentId: string, lookForId: string, text: string) {
    const c = findComponent(componentId);
    if (!c) return;
    updateComponent(componentId, {
      lookFors: c.lookFors.map((lf) => (lf.id === lookForId ? { ...lf, text } : lf)),
    });
  }

  function removeLookFor(componentId: string, lookForId: string) {
    const c = findComponent(componentId);
    if (!c) return;
    updateComponent(componentId, {
      lookFors: c.lookFors.filter((lf) => lf.id !== lookForId),
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Explicit field list — don't write back the `id` injected by
      // useFirestoreDoc, and let createdAt stay untouched via merge.
      await setDoc(
        doc(db, `${COLLECTIONS.rubrics}/${draft.rubricId}`),
        {
          rubricId: draft.rubricId,
          displayName: draft.displayName,
          domains: draft.domains,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setSavedAt(new Date());
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const componentCount = draft.domains.reduce((sum, d) => sum + d.components.length, 0);

  return (
    <PageHeader
      variant="dark"
      title={draft.displayName}
      subtitle={`${String(draft.domains.length)} domain${draft.domains.length === 1 ? '' : 's'}, ${String(componentCount)} component${componentCount === 1 ? '' : 's'}${dirty ? ' • unsaved changes' : ''}`}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/rubrics')}
            className="text-white/80 hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
            All rubrics
          </Button>
          {savedAt ? (
            <span className="text-xs text-white/70">Saved {savedAt.toLocaleTimeString()}</span>
          ) : null}
          <Button
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="text-ops-blue-dark bg-white hover:bg-white/90 disabled:bg-white/40"
          >
            {saving ? 'Saving…' : 'Save rubric'}
          </Button>
        </div>
      }
    >
      {saveError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {saveError}
        </div>
      ) : null}

      <RubricGridEditor
        draft={draft}
        onUpdateDomain={updateDomain}
        onAddDomain={addDomain}
        onAddComponent={addComponent}
        onUpdateComponent={updateComponent}
        onRemoveComponent={removeComponent}
        onAddLookFor={addLookFor}
        onUpdateLookFor={updateLookFor}
        onRemoveLookFor={removeLookFor}
      />
    </PageHeader>
  );
}
