import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  MODULE_SUBCOLLECTIONS,
  type ModuleItem,
  type ModuleSection,
  type TiptapDoc,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TiptapEditor } from '@/components/ui/tiptap-editor';

interface Props {
  moduleId: string;
  section: ModuleSection;
  items: ModuleItem[];
  isFirst: boolean;
  isLast: boolean;
  onPatchSection: (id: string, patch: Partial<ModuleSection>) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}

function newItemId() {
  return `itm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Parse body string → TiptapDoc for the editor. */
function parseBodyDoc(body: string): TiptapDoc | undefined {
  if (!body.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as TiptapDoc;
    }
  } catch {
    // not JSON — return undefined so editor starts fresh
  }
  return undefined;
}

export function ModuleSectionEditor({
  moduleId,
  section,
  items,
  isFirst,
  isLast,
  onPatchSection,
  onMove,
  onDelete,
}: Props) {
  const { user } = useAuth();

  // Track whether we should show the delete confirmation for this section
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sectionItems = items
    .filter((i) => i.sectionId === section.id)
    .slice()
    .sort((a, b) => a.order - b.order);

  function itemRef(itemId: string) {
    return doc(db, COLLECTIONS.modules, moduleId, MODULE_SUBCOLLECTIONS.items, itemId);
  }

  function addItem(kind: ModuleItem['kind']) {
    const itemId = newItemId();
    void setDoc(itemRef(itemId), {
      itemId,
      moduleId,
      kind,
      sectionId: section.id,
      order: sectionItems.length,
      title: kind === 'resource' ? 'New resource' : 'New material',
      description: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user?.email ?? null,
    });
  }

  function patchItem(itemId: string, patch: Partial<ModuleItem>) {
    void setDoc(
      itemRef(itemId),
      { ...patch, updatedAt: serverTimestamp(), updatedBy: user?.email ?? null },
      { merge: true },
    );
  }

  function removeItem(itemId: string) {
    void deleteDoc(itemRef(itemId));
  }

  function handleDeleteClick() {
    if (confirmDelete) {
      onDelete(section.id);
    } else {
      setConfirmDelete(true);
    }
  }

  const bodyDoc = parseBodyDoc(section.body);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <span className="text-muted-foreground text-xs uppercase">{section.type}</span>
        <Input
          value={section.title}
          placeholder="Section title"
          onChange={(e) => onPatchSection(section.id, { title: e.target.value })}
          className="flex-1"
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={isFirst}
          onClick={() => onMove(section.id, -1)}
          aria-label="Move up"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={isLast}
          onClick={() => onMove(section.id, 1)}
          aria-label="Move down"
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={confirmDelete ? 'bg-destructive/10 text-destructive' : 'text-destructive'}
          onClick={handleDeleteClick}
          onBlur={() => setConfirmDelete(false)}
          aria-label={confirmDelete ? 'Confirm delete section' : 'Delete section'}
          title={confirmDelete ? 'Click again to confirm' : 'Delete section'}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {section.type === 'richtext' ? (
          <TiptapEditor
            value={bodyDoc}
            onChange={(doc) => onPatchSection(section.id, { body: JSON.stringify(doc) })}
            variant="full"
            placeholder="Write content for this section…"
          />
        ) : (
          <>
            {sectionItems.map((item) => (
              <div key={item.itemId} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label>Title</Label>
                  <Input
                    value={item.title}
                    onChange={(e) => patchItem(item.itemId, { title: e.target.value })}
                  />
                </div>
                {item.kind === 'resource' ? (
                  <div className="grid gap-1">
                    <Label>Link URL</Label>
                    <Input
                      value={item.linkUrl ?? ''}
                      placeholder="https://…"
                      onChange={(e) => patchItem(item.itemId, { linkUrl: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="grid gap-1">
                    <Label>Due date (optional)</Label>
                    <Input
                      type="date"
                      value={item.dueDate ?? ''}
                      onChange={(e) => patchItem(item.itemId, { dueDate: e.target.value })}
                    />
                  </div>
                )}
                {item.kind === 'material' ? (
                  <div className="grid gap-1 sm:col-span-2">
                    <Label>Description</Label>
                    <Input
                      value={item.description}
                      onChange={(e) => patchItem(item.itemId, { description: e.target.value })}
                    />
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => removeItem(item.itemId)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => addItem(section.type === 'resources' ? 'resource' : 'material')}
            >
              <Plus className="mr-1 h-4 w-4" />
              {section.type === 'resources' ? 'Add resource' : 'Add material'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
