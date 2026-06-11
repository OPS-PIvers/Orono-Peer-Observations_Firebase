import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, Plus } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  MODULE_CONTENT_SUBCOLLECTION,
  MODULE_ICONS,
  MODULE_SUBCOLLECTIONS,
  type ModuleDoc,
  type ModuleItem,
  type ModuleSection,
  type ModuleSectionType,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ModuleSectionEditor } from './ModuleSectionEditor';

function newSectionId() {
  return `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ModuleBuilderPage() {
  const { moduleId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: module } = useFirestoreDoc<ModuleDoc>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}` : '',
  );
  const { data: items } = useFirestoreCollection<ModuleItem>(
    moduleId ? `${COLLECTIONS.modules}/${moduleId}/${MODULE_SUBCOLLECTIONS.items}` : '',
  );

  const sections = useMemo<ModuleSection[]>(() => module?.sections ?? [], [module]);

  // Latest-known sections array. Every mutation is computed against this ref
  // (never against a render-time `sections` closure), so an interleaved write
  // — e.g. a debounced rich-text flush firing after another section was added,
  // renamed, or moved — can't resurrect a stale array and silently wipe newer
  // edits. The ref is updated eagerly on each local write and re-synced when
  // the Firestore snapshot delivers (latency compensation echoes local writes
  // back in order, so the snapshot never regresses behind our own writes).
  const sectionsRef = useRef<ModuleSection[]>(sections);
  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  function patchModule(patch: Partial<ModuleDoc>) {
    void setDoc(
      doc(db, COLLECTIONS.modules, moduleId),
      { ...patch, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
      { merge: true },
    );
  }

  function updateSections(updater: (current: ModuleSection[]) => ModuleSection[]) {
    const next = updater(sectionsRef.current);
    if (next === sectionsRef.current) return; // updater declined — nothing to write
    sectionsRef.current = next;
    patchModule({ sections: next });
  }

  function addSection(type: ModuleSectionType) {
    // New sections carry only public layout metadata (id/type/title). Rich-text
    // bodies live in the gated /content subcollection (ModuleSectionEditor),
    // never inline on the domain-readable module doc.
    updateSections((current) => [...current, { id: newSectionId(), type, title: '' }]);
  }

  function patchSection(id: string, patch: Partial<ModuleSection>) {
    updateSections((current) =>
      // A flush for a since-deleted section is a no-op rather than a rewrite.
      current.some((s) => s.id === id)
        ? current.map((s) => (s.id === id ? { ...s, ...patch } : s))
        : current,
    );
  }

  function moveSection(id: string, dir: -1 | 1) {
    updateSections((current) => {
      const idx = current.findIndex((s) => s.id === id);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= current.length) return current;
      // Guard already ensures idx and swap are valid indices.
      return current.map((s, i) => {
        if (i === idx) return current[swap] ?? s;
        if (i === swap) return current[idx] ?? s;
        return s;
      });
    });
  }

  function deleteSection(id: string) {
    updateSections((current) => current.filter((s) => s.id !== id));
    // Best-effort: drop the section's gated rich-text content doc (if any) so a
    // deleted richtext section doesn't strand a /content doc. No-op for
    // resources/materials sections, which have no content doc.
    void deleteDoc(doc(db, COLLECTIONS.modules, moduleId, MODULE_CONTENT_SUBCOLLECTION, id));
  }

  if (!module) {
    return (
      <PageHeader title="Module" variant="light" breadcrumb={['Admin', 'Modules']}>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </PageHeader>
    );
  }

  return (
    <PageHeader
      title={module.displayName}
      variant="light"
      breadcrumb={['Admin', 'Modules', module.displayName]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            data-testid="preview-module-button"
            onClick={() => void navigate(`/m/${moduleId}`)}
          >
            <Eye className="mr-1 h-4 w-4" />
            Preview page
          </Button>
          <Button variant="outline" onClick={() => void navigate('/admin/modules')}>
            Back to modules
          </Button>
        </div>
      }
    >
      <div className="mb-6 grid max-w-xl gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={module.hasPage}
            onChange={(e) => patchModule({ hasPage: e.target.checked })}
            className="h-4 w-4"
          />
          Give this module a staff-facing page + sidebar entry
        </label>

        <div className="grid gap-1">
          <Label htmlFor="mod-icon">Sidebar icon</Label>
          <select
            id="mod-icon"
            value={module.icon}
            onChange={(e) => patchModule({ icon: e.target.value as ModuleDoc['icon'] })}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {MODULE_ICONS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-4">
        {sections.map((section, idx) => (
          <ModuleSectionEditor
            key={section.id}
            moduleId={moduleId}
            section={section}
            items={items ?? []}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
            onPatchSection={patchSection}
            onMove={moveSection}
            onDelete={deleteSection}
          />
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="mt-4">
            <Plus className="mr-1 h-4 w-4" />
            Add section
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => addSection('richtext')}>Rich text</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addSection('resources')}>
            Resource list
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => addSection('materials')}>
            Materials / to-dos
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </PageHeader>
  );
}
