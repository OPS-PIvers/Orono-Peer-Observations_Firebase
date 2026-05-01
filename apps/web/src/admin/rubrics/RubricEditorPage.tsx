import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, Trash2, X } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
} from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface DraftRubric extends Rubric {
  domains: RubricDomain[];
}

const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  developing: 'Developing',
  basic: 'Basic',
  proficient: 'Proficient',
  distinguished: 'Distinguished',
};

export function RubricEditorPage() {
  const { rubricId } = useParams<{ rubricId: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useFirestoreDoc<Rubric>(
    `${COLLECTIONS.rubrics}/${rubricId ?? ''}`,
  );

  const [draft, setDraft] = useState<DraftRubric | null>(null);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Hydrate once; later snapshots would clobber in-progress edits. Key
  // off the loaded doc's own id so a route change can't briefly hydrate
  // with the previous rubric. Issue #3.
  useHydratedDraft(data?.id ?? null, data, (src) => {
    setDraft(src);
    const firstComponent = src.domains[0]?.components[0]?.id;
    setSelectedComponentId((current) => current ?? firstComponent ?? null);
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

  const selected = findComponent(draft, selectedComponentId);

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
      bestPractices: '',
      lookFors: [],
    };
    const next: DraftRubric = {
      ...draft,
      domains: draft.domains.map((d) =>
        d.id === domainId ? { ...d, components: [...d.components, newComponent] } : d,
      ),
    };
    update(next);
    setSelectedComponentId(newId);
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
    if (selectedComponentId === componentId) {
      setSelectedComponentId(next.domains[0]?.components[0]?.id ?? null);
    }
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

  function addLookFor(componentId: string) {
    const c = findComponent(draft, componentId);
    if (!c) return;
    const newLookFor = { id: `lf-${String(Date.now())}`, text: '' };
    updateComponent(componentId, { lookFors: [...c.lookFors, newLookFor] });
  }

  function updateLookFor(componentId: string, lookForId: string, text: string) {
    const c = findComponent(draft, componentId);
    if (!c) return;
    updateComponent(componentId, {
      lookFors: c.lookFors.map((lf) => (lf.id === lookForId ? { ...lf, text } : lf)),
    });
  }

  function removeLookFor(componentId: string, lookForId: string) {
    const c = findComponent(draft, componentId);
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

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin/rubrics')}
            className="mb-2"
          >
            <ChevronLeft className="h-4 w-4" />
            All rubrics
          </Button>
          <h1 className="text-3xl font-bold">{draft.displayName}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {draft.domains.length} domain{draft.domains.length === 1 ? '' : 's'},{' '}
            {draft.domains.reduce((sum, d) => sum + d.components.length, 0)} component
            {draft.domains.reduce((sum, d) => sum + d.components.length, 0) === 1 ? '' : 's'}
            {dirty ? ' • unsaved changes' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt ? (
            <span className="text-muted-foreground text-xs">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          ) : null}
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save rubric'}
          </Button>
        </div>
      </header>

      {saveError ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-3 py-2 text-sm">
          {saveError}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left: domain/component tree */}
        <aside className="border-border bg-background sticky top-4 h-fit max-h-[calc(100vh-160px)] overflow-y-auto rounded-lg border p-3">
          {draft.domains.map((domain) => (
            <DomainSection
              key={domain.id}
              domain={domain}
              selectedComponentId={selectedComponentId}
              onSelectComponent={setSelectedComponentId}
              onChangeName={(name) => updateDomain(domain.id, { name })}
              onAddComponent={() => addComponent(domain.id)}
            />
          ))}
          <Button variant="outline" size="sm" onClick={addDomain} className="mt-3 w-full">
            <Plus className="h-4 w-4" />
            Add domain
          </Button>
        </aside>

        {/* Right: component editor */}
        <section>
          {selected ? (
            <ComponentEditor
              component={selected}
              onPatch={(patch) => updateComponent(selected.id, patch)}
              onAddLookFor={() => addLookFor(selected.id)}
              onUpdateLookFor={(id, text) => updateLookFor(selected.id, id, text)}
              onRemoveLookFor={(id) => removeLookFor(selected.id, id)}
              onRemove={() => removeComponent(selected.id)}
            />
          ) : (
            <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
              Select a component on the left, or add one to get started.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function findComponent(rubric: DraftRubric | null, id: string | null): RubricComponent | null {
  if (!rubric || !id) return null;
  for (const d of rubric.domains) {
    const c = d.components.find((cc) => cc.id === id);
    if (c) return c;
  }
  return null;
}

interface DomainSectionProps {
  domain: RubricDomain;
  selectedComponentId: string | null;
  onSelectComponent: (id: string) => void;
  onChangeName: (name: string) => void;
  onAddComponent: () => void;
}

function DomainSection({
  domain,
  selectedComponentId,
  onSelectComponent,
  onChangeName,
  onAddComponent,
}: DomainSectionProps) {
  return (
    <div className="mb-3">
      <div className="text-muted-foreground mb-1 flex items-center gap-1 text-xs font-medium tracking-wide uppercase">
        <span>Domain {domain.id}</span>
      </div>
      <Input
        value={domain.name}
        onChange={(e) => onChangeName(e.target.value)}
        className="mb-2 h-9 text-sm"
      />
      <ul className="space-y-1">
        {domain.components.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelectComponent(c.id)}
              className={cn(
                'w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                selectedComponentId === c.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span className="font-mono text-xs opacity-70">{c.id}</span>{' '}
              <span>{c.title || <em className="opacity-60">untitled</em>}</span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" onClick={onAddComponent} className="mt-1 w-full text-xs">
        <Plus className="h-3 w-3" />
        Add component
      </Button>
    </div>
  );
}

interface ComponentEditorProps {
  component: RubricComponent;
  onPatch: (patch: Partial<RubricComponent>) => void;
  onAddLookFor: () => void;
  onUpdateLookFor: (id: string, text: string) => void;
  onRemoveLookFor: (id: string) => void;
  onRemove: () => void;
}

function ComponentEditor({
  component,
  onPatch,
  onAddLookFor,
  onUpdateLookFor,
  onRemoveLookFor,
  onRemove,
}: ComponentEditorProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="border-border bg-background space-y-6 rounded-lg border p-6">
      <div>
        <Label htmlFor="component-id" className="text-xs tracking-wide uppercase">
          Component {component.id}
        </Label>
        <Input
          id="component-title"
          value={component.title}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="Component title (e.g. Demonstrating Knowledge of Content)"
          className="mt-1 text-base font-medium"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Proficiency descriptors</legend>
        {PROFICIENCY_LEVELS.map((level) => (
          <div key={level} className="grid gap-1">
            <Label htmlFor={`prof-${level}`} className="text-xs">
              {PROFICIENCY_LABELS[level]}
            </Label>
            <Textarea
              id={`prof-${level}`}
              value={component.proficiencyLevels[level]}
              onChange={(e) =>
                onPatch({
                  proficiencyLevels: { ...component.proficiencyLevels, [level]: e.target.value },
                })
              }
              rows={3}
            />
          </div>
        ))}
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="best-practices">Best practices</Label>
        <Textarea
          id="best-practices"
          value={component.bestPractices}
          onChange={(e) => onPatch({ bestPractices: e.target.value })}
          rows={4}
          placeholder="Multi-line list of best-practice indicators (one per line)"
        />
      </div>

      <fieldset className="space-y-2">
        <div className="flex items-center justify-between">
          <legend className="text-sm font-medium">Look-fors</legend>
          <Button variant="outline" size="sm" onClick={onAddLookFor} type="button">
            <Plus className="h-4 w-4" />
            Add look-for
          </Button>
        </div>
        {component.lookFors.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No look-fors yet. Click &ldquo;Add look-for&rdquo; to define observable behaviors
            evaluators can check during an observation.
          </p>
        ) : (
          <ul className="space-y-2">
            {component.lookFors.map((lf) => (
              <li key={lf.id} className="flex items-start gap-2">
                <Input
                  value={lf.text}
                  onChange={(e) => onUpdateLookFor(lf.id, e.target.value)}
                  placeholder="Look-for text"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveLookFor(lf.id)}
                  aria-label="Remove look-for"
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="border-border border-t pt-4">
        {confirmingDelete ? (
          <div className="border-destructive bg-ops-red-lighter text-ops-red-dark space-y-2 rounded-md border-l-4 px-3 py-2 text-sm">
            <p>
              Delete component <strong>{component.id}</strong>? Existing observations referencing it
              will keep the data but evaluators won&apos;t see it on the rubric anymore.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={onRemove}>
                Yes, delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            onClick={() => setConfirmingDelete(true)}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete component
          </Button>
        )}
      </div>
    </div>
  );
}
