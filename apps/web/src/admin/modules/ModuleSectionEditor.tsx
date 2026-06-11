import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import {
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  COLLECTIONS,
  MAX_MODULE_FILE_BYTES,
  MODULE_CONTENT_SUBCOLLECTION,
  MODULE_SUBCOLLECTIONS,
  type ModuleItem,
  type ModuleSection,
  type ModuleSectionContent,
} from '@ops/shared';
import { useAuth } from '@/auth/AuthProvider';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { db, functions } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { parseTiptapBody } from '@/modules/moduleBody';

const uploadModuleFileFn = httpsCallable<
  {
    moduleId: string;
    itemId: string;
    fileName: string;
    mimeType: string;
    base64Data: string;
  },
  { driveFileId: string; name: string; fileUrl: string }
>(functions, 'uploadModuleFile');

/** Read a File as base64 (sans the `data:...;base64,` prefix) for the callable. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

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

  // Detach an uploaded file from a resource item. `deleteField()` actually
  // removes `fileUrl`/`driveFile` (a `{ merge: true }` write of `undefined`
  // would be rejected by the SDK and wouldn't clear the keys anyway). The
  // Drive file itself is left in place — admins manage the Modules folder.
  function clearItemFile(itemId: string) {
    void updateDoc(itemRef(itemId), {
      fileUrl: deleteField(),
      driveFile: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: user?.email ?? null,
    });
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
          <RichTextSectionEditor moduleId={moduleId} sectionId={section.id} />
        ) : (
          <>
            {sectionItems.map((item) => (
              <div key={item.itemId} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor={`mod-item-title-${item.itemId}`}>Title</Label>
                  <Input
                    id={`mod-item-title-${item.itemId}`}
                    value={item.title}
                    onChange={(e) => patchItem(item.itemId, { title: e.target.value })}
                  />
                </div>
                {item.kind === 'resource' ? (
                  <>
                    <div className="grid gap-1">
                      <Label htmlFor={`mod-item-link-${item.itemId}`}>Link URL</Label>
                      <Input
                        id={`mod-item-link-${item.itemId}`}
                        value={item.linkUrl ?? ''}
                        placeholder="https://…"
                        onChange={(e) => patchItem(item.itemId, { linkUrl: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1 sm:col-span-2">
                      <Label>File</Label>
                      <ResourceFileUpload
                        moduleId={moduleId}
                        item={item}
                        onClearFile={() => clearItemFile(item.itemId)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="grid gap-1">
                    <Label htmlFor={`mod-item-due-${item.itemId}`}>Due date (optional)</Label>
                    <Input
                      id={`mod-item-due-${item.itemId}`}
                      type="date"
                      value={item.dueDate ?? ''}
                      onChange={(e) => patchItem(item.itemId, { dueDate: e.target.value })}
                    />
                  </div>
                )}
                {item.kind === 'material' ? (
                  <div className="grid gap-1 sm:col-span-2">
                    <Label htmlFor={`mod-item-desc-${item.itemId}`}>Description</Label>
                    <Input
                      id={`mod-item-desc-${item.itemId}`}
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

/**
 * Rich-text editor for a `richtext` section. The body is stored OUTSIDE the
 * (domain-readable) module doc, in `/modules/{id}/content/{sectionId}`, so it's
 * access-controlled exactly like resource/material items — only assigned (or
 * auto-enabled) staff and admins can read it. The doc id is the section id, so
 * there's at most one content doc per section.
 *
 * Body saves are debounced (~400 ms) so every keystroke doesn't issue a write,
 * and a pending edit is flushed on unmount so the last change isn't lost.
 */
function RichTextSectionEditor({ moduleId, sectionId }: { moduleId: string; sectionId: string }) {
  const { user } = useAuth();

  const { data: content } = useFirestoreDoc<ModuleSectionContent>(
    moduleId && sectionId
      ? `${COLLECTIONS.modules}/${moduleId}/${MODULE_CONTENT_SUBCOLLECTION}/${sectionId}`
      : '',
  );

  const bodyDoc = parseTiptapBody(content?.body ?? '');

  function contentRef() {
    return doc(db, COLLECTIONS.modules, moduleId, MODULE_CONTENT_SUBCOLLECTION, sectionId);
  }

  // Latest user email, readable from the timer callback / unmount flush without
  // re-creating the debounce effect on every auth render.
  const userEmailRef = useRef<string | null>(user?.email ?? null);
  useEffect(() => {
    userEmailRef.current = user?.email ?? null;
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);

  const flushPendingBody = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingBodyRef.current !== null) {
      const body = pendingBodyRef.current;
      pendingBodyRef.current = null;
      void setDoc(
        contentRef(),
        {
          sectionId,
          moduleId,
          body,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: userEmailRef.current,
        },
        { merge: true },
      );
    }
    // contentRef closes over the stable moduleId/sectionId props.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moduleId/sectionId are stable for this section instance
  }, [moduleId, sectionId]);

  useEffect(() => {
    // Flush any pending rich-text write on unmount so the last edit isn't lost.
    return flushPendingBody;
  }, [flushPendingBody]);

  function handleBodyChange(serialized: string) {
    pendingBodyRef.current = serialized;
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(flushPendingBody, 400);
  }

  return (
    <TiptapEditor
      value={bodyDoc}
      onChange={(d) => handleBodyChange(JSON.stringify(d))}
      variant="full"
      placeholder="Write content for this section…"
    />
  );
}

/**
 * File upload control for a resource item. Picks a file, validates its size
 * against {@link MAX_MODULE_FILE_BYTES}, and hands the bytes to the
 * `uploadModuleFile` callable, which stores the file in the district Drive and
 * writes `fileUrl` + `driveFile` back onto the item (the onSnapshot then
 * re-renders this control with the attached file). When a file is already
 * attached, shows its name with a View link and a clear button.
 */
function ResourceFileUpload({
  moduleId,
  item,
  onClearFile,
}: {
  moduleId: string;
  item: ModuleItem;
  onClearFile: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // An uploaded file always carries a driveFile ref; a bare fileUrl (no ref)
  // could only come from a legacy/manual edit, so key the "attached" state off
  // the ref and fall back to fileUrl for the link target.
  const attached = item.driveFile;
  const fileHref = item.fileUrl ?? null;

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MODULE_FILE_BYTES) {
      setError('File exceeds the 20 MB limit');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const base64Data = await fileToBase64(file);
      await uploadModuleFileFn({
        moduleId,
        itemId: item.itemId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        base64Data,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {attached ? (
        <div className="bg-muted/30 flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
          <FileText className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
          {fileHref ? (
            <a
              href={fileHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary truncate hover:underline"
              title={attached.name}
            >
              {attached.name}
            </a>
          ) : (
            <span className="truncate" title={attached.name}>
              {attached.name}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 shrink-0"
            onClick={onClearFile}
            disabled={uploading}
            aria-label={`Remove file ${attached.name}`}
            title="Remove file"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="mr-1 h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload file'}
        </Button>
      )}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => void handleFileSelect(e)}
      />
    </div>
  );
}
