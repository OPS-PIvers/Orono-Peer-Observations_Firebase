import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
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

  function patchModule(patch: Partial<ModuleDoc>) {
    void setDoc(
      doc(db, COLLECTIONS.modules, moduleId),
      { ...patch, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
      { merge: true },
    );
  }

  function setSections(next: ModuleSection[]) {
    patchModule({ sections: next });
  }

  function addSection(type: ModuleSectionType) {
    setSections([...sections, { id: newSectionId(), type, title: '', body: '' }]);
  }

  function patchSection(id: string, patch: Partial<ModuleSection>) {
    setSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function moveSection(id: string, dir: -1 | 1) {
    const idx = sections.findIndex((s) => s.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= sections.length) return;
    const next = [...sections];
    // Guard already ensures idx and swap are valid indices.
    const swapped = next.map((s, i) => {
      if (i === idx) return next[swap] ?? s;
      if (i === swap) return next[idx] ?? s;
      return s;
    });
    setSections(swapped);
  }

  function deleteSection(id: string) {
    setSections(sections.filter((s) => s.id !== id));
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
        <Button variant="outline" onClick={() => void navigate('/admin/modules')}>
          Back to modules
        </Button>
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
          <Label>Sidebar icon</Label>
          <select
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
