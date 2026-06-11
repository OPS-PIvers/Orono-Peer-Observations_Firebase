import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import {
  COLLECTIONS,
  flattenRubricComponentIds,
  rubricInput,
  type Role,
  type RoleYearMapping,
  type Rubric,
  type RubricComponent,
  type RubricDomain,
} from '@ops/shared';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useHydratedDraft } from '@/hooks/useHydratedDraft';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { RubricGridEditor } from './RubricGridEditor';

interface DraftRubric extends Rubric {
  domains: RubricDomain[];
}

/**
 * Merge a patch into a component, treating `color: undefined` (the color
 * "Reset" action) as "delete the key" instead of leaving an own
 * `color: undefined` property behind. Firestore rejects `undefined` field
 * values at write time ("Unsupported field value: undefined"), so a plain
 * spread-merge would break every subsequent Save until the admin re-picked
 * a color or reloaded.
 */
function applyComponentPatch(
  component: RubricComponent,
  patch: Partial<RubricComponent>,
): RubricComponent {
  const next = { ...component, ...patch };
  if (next.color === undefined) delete next.color;
  return next;
}

/**
 * Component IDs that appear more than once across the whole rubric, in
 * first-seen order. The editor no longer mints duplicates (addComponent
 * fills ID gaps), so this is defense against bad imported data — save()
 * refuses to write a rubric with ambiguous component IDs, since
 * observation data and role-year mappings key on them.
 */
function findDuplicateComponentIds(rubric: Rubric): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of flattenRubricComponentIds(rubric)) {
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  return [...duplicates];
}

/**
 * Defense-in-depth for save(): strip any `color: undefined` stragglers
 * (e.g. a draft hydrated before `applyComponentPatch` guarded the merge)
 * so setDoc can never see an undefined field value.
 */
function sanitizeDomains(domains: RubricDomain[]): RubricDomain[] {
  return domains.map((d) => ({
    ...d,
    components: d.components.map((c) => {
      if (c.color !== undefined) return c;
      const next = { ...c };
      delete next.color;
      return next;
    }),
  }));
}

/**
 * Remove domains that have zero components. This allows the form to work
 * more naturally — admins can add a domain, then add components to it,
 * without the schema blocking them at save time.
 */
function pruneEmptyDomains(domains: RubricDomain[]): RubricDomain[] {
  return domains.filter((d) => d.components.length > 0);
}

/**
 * Map Zod validation errors to human-readable messages that identify
 * the domain/component and the field that failed.
 */
function formatValidationErrors(errors: { path: string; message: string }[]): string[] {
  return errors.map((err) => {
    const pathParts = err.path.split(/[[\].]+/).filter(Boolean);

    // Identify the context (which domain/component)
    if (pathParts[0] === 'domains' && pathParts[1]) {
      const domainIdx = parseInt(pathParts[1], 10);
      return `Domain ${domainIdx + 1}: ${err.message}`;
    }
    if (
      pathParts[0] === 'domains' &&
      pathParts[1] &&
      pathParts[2] === 'components' &&
      pathParts[3]
    ) {
      const domainIdx = parseInt(pathParts[1], 10);
      const componentIdx = parseInt(pathParts[3], 10);
      return `Domain ${domainIdx + 1}, Component ${componentIdx + 1}: ${err.message}`;
    }
    return `${pathParts[0] ?? 'Rubric'}: ${err.message}`;
  });
}

export function RubricEditorPage() {
  const { rubricId } = useParams<{ rubricId: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useFirestoreDoc<Rubric>(
    `${COLLECTIONS.rubrics}/${rubricId ?? ''}`,
  );
  const { data: allRoles } = useFirestoreCollection<Role>(COLLECTIONS.roles);
  const { data: allMappings } = useFirestoreCollection<RoleYearMapping>(
    COLLECTIONS.roleYearMappings,
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

  useUnsavedChangesGuard(dirty);

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
        components: d.components.map((c) =>
          c.id === componentId ? applyComponentPatch(c, patch) : c,
        ),
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
    // First unused letter a…z in this domain. Deriving the letter from
    // components.length re-mints an existing ID after a mid-list delete
    // (delete 1b from [1a, 1b, 1c], add → length 2 → "1c" collides with
    // the surviving 1c). The domain-digit prefix already guarantees
    // cross-domain uniqueness, so only this domain's IDs matter.
    const usedIds = new Set(domain.components.map((c) => c.id));
    let newId: string | null = null;
    for (let i = 0; i < 26; i++) {
      const candidate = `${domainId}${String.fromCharCode(97 + i)}`;
      if (!usedIds.has(candidate)) {
        newId = candidate;
        break;
      }
    }
    if (newId?.length !== 2) return; // out of letters; admin can clean up
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
    // Find the lowest digit 1-9 not yet used as a domain ID.
    const usedIds = new Set(draft.domains.map((d) => d.id));
    let nextDomainId: string | null = null;
    for (let i = 1; i <= 9; i++) {
      const candidate = String(i);
      if (!usedIds.has(candidate)) {
        nextDomainId = candidate;
        break;
      }
    }
    if (!nextDomainId) return; // All 9 domain slots are used
    const newDomain: RubricDomain = {
      id: nextDomainId,
      name: `Domain ${nextDomainId}`,
      components: [],
    };
    update({ ...draft, domains: [...draft.domains, newDomain] });
  }

  function removeDomain(domainId: string) {
    if (!draft) return;
    const next: DraftRubric = {
      ...draft,
      domains: draft.domains.filter((d) => d.id !== domainId),
    };
    update(next);
  }

  function reorderDomain(domainId: string, direction: 'up' | 'down') {
    if (!draft) return;
    const idx = draft.domains.findIndex((d) => d.id === domainId);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= draft.domains.length) return;
    const next = [...draft.domains];
    const temp = next[idx];
    const swap = next[newIdx];
    if (!temp || !swap) return;
    next[idx] = swap;
    next[newIdx] = temp;
    update({ ...draft, domains: next });
  }

  function reorderComponent(componentId: string, direction: 'up' | 'down') {
    if (!draft) return;
    const domainIdx = draft.domains.findIndex((d) =>
      d.components.some((c) => c.id === componentId),
    );
    if (domainIdx === -1) return;
    const domain = draft.domains[domainIdx];
    if (!domain) return;
    const compIdx = domain.components.findIndex((c) => c.id === componentId);
    const newCompIdx = direction === 'up' ? compIdx - 1 : compIdx + 1;
    if (newCompIdx < 0 || newCompIdx >= domain.components.length) return;
    const nextComponents = [...domain.components];
    const temp = nextComponents[compIdx];
    const swap = nextComponents[newCompIdx];
    if (!temp || !swap) return;
    nextComponents[compIdx] = swap;
    nextComponents[newCompIdx] = temp;
    const nextDomains = draft.domains.map((d, i) =>
      i === domainIdx ? { ...d, components: nextComponents } : d,
    );
    update({ ...draft, domains: nextDomains });
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
    const duplicateIds = findDuplicateComponentIds(draft);
    if (duplicateIds.length > 0) {
      setSaveError(
        `Cannot save: duplicate component ID${duplicateIds.length === 1 ? '' : 's'} (${duplicateIds.join(', ')}). Each component needs a unique ID — observations and role-year mappings reference components by ID.`,
      );
      return;
    }

    // Validate against the shared schema before saving
    const sanitized = sanitizeDomains(draft.domains);
    const payload = {
      rubricId: draft.rubricId,
      displayName: draft.displayName,
      domains: pruneEmptyDomains(sanitized),
    };

    const validationResult = rubricInput.safeParse(payload);
    if (!validationResult.success) {
      const validationErrors = validationResult.error.issues.map((err) => ({
        path: err.path.map(String).join(''),
        message: err.message,
      }));
      const messages = formatValidationErrors(validationErrors);
      setSaveError(messages.join('\n'));
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      // Detect which component IDs were deleted from the original rubric
      const originalComponentIds = new Set(flattenRubricComponentIds(data ?? draft));
      const newComponentIds = new Set(flattenRubricComponentIds(validationResult.data));
      const deletedIds = new Set(
        Array.from(originalComponentIds).filter((id) => !newComponentIds.has(id)),
      );

      // Explicit field list — don't write back the `id` injected by
      // useFirestoreDoc, and let createdAt stay untouched via merge.
      await setDoc(
        doc(db, `${COLLECTIONS.rubrics}/${draft.rubricId}`),
        {
          rubricId: draft.rubricId,
          displayName: draft.displayName,
          domains: validationResult.data.domains,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      // If components were deleted, prune them from all roleYearMappings
      // that reference this rubric
      if (deletedIds.size > 0 && allRoles && allMappings) {
        const rolesWithThisRubric = allRoles.filter((r) => r.rubricId === draft.rubricId);
        if (rolesWithThisRubric.length > 0) {
          let totalPruned = 0;
          const batchUpdates: { id: string; ids: string[] }[] = [];

          for (const role of rolesWithThisRubric) {
            for (const mapping of allMappings) {
              if (mapping.roleId === role.roleId) {
                const prunedIds = mapping.assignedComponentIds.filter((id) => !deletedIds.has(id));
                const prunedInThisMapping = mapping.assignedComponentIds.length - prunedIds.length;
                if (prunedInThisMapping > 0) {
                  totalPruned += prunedInThisMapping;
                  batchUpdates.push({ id: mapping.id, ids: prunedIds.sort() });
                }
              }
            }
          }

          if (totalPruned > 0) {
            const batch = writeBatch(db);
            for (const update of batchUpdates) {
              batch.set(
                doc(db, `${COLLECTIONS.roleYearMappings}/${update.id}`),
                {
                  assignedComponentIds: update.ids,
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              );
            }
            await batch.commit();
          }
        }
      }

      setSavedAt(new Date());
      setDirty(false);
      if (deletedIds.size > 0) {
        setSaveError(
          `Saved rubric. Pruned ${String(deletedIds.size)} component${deletedIds.size === 1 ? '' : 's'} from role/year mappings.`,
        );
        // Clear the message after a brief delay so it doesn't stay permanently
        setTimeout(() => setSaveError(null), 5000);
      }
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
      title={
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="rubric-display-name" className="sr-only">
            Rubric display name
          </Label>
          <Input
            id="rubric-display-name"
            value={draft.displayName}
            onChange={(e) => update({ ...draft, displayName: e.target.value })}
            placeholder="Rubric display name"
            className="font-heading h-9 border-white/20 bg-white/10 text-xl font-bold text-white placeholder:text-white/50 focus-visible:border-white/60 focus-visible:ring-white/40"
          />
        </div>
      }
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
        onRemoveDomain={removeDomain}
        onReorderDomain={reorderDomain}
        onAddDomain={addDomain}
        onAddComponent={addComponent}
        onUpdateComponent={updateComponent}
        onRemoveComponent={removeComponent}
        onReorderComponent={reorderComponent}
        onAddLookFor={addLookFor}
        onUpdateLookFor={updateLookFor}
        onRemoveLookFor={removeLookFor}
      />
    </PageHeader>
  );
}
