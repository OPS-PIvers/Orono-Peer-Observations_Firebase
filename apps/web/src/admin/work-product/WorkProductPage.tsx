import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { deleteDoc, doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { COLLECTIONS, type WorkProductQuestion } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
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
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { GripHandle, SortableItem } from '@/admin/dashboard/SortableItem';

const QUESTION_TYPES = ['work-product', 'instructional-round'] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];

type QuestionRow = WorkProductQuestion & { id: string };

const TYPE_LABELS: Record<QuestionType, string> = {
  'work-product': 'Work Product',
  'instructional-round': 'Instructional Round',
};

export function WorkProductPage() {
  const {
    data: questions,
    loading,
    error,
  } = useFirestoreCollection<WorkProductQuestion>(COLLECTIONS.workProductQuestions);
  const [draft, setDraft] = useState('');
  const [newType, setNewType] = useState<QuestionType>('work-product');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuestionRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const sorted = useMemo(
    () => (questions ?? []).slice().sort((a, b) => a.order - b.order),
    [questions],
  );

  /** Questions for a single type, in display order. */
  const byType = useMemo(() => {
    const groups: Record<QuestionType, QuestionRow[]> = {
      'work-product': [],
      'instructional-round': [],
    };
    for (const q of sorted) {
      groups[q.type].push(q);
    }
    return groups;
  }, [sorted]);

  async function add() {
    setAddError(null);
    const text = draft.trim();
    if (!text) {
      setAddError('Question text is required.');
      return;
    }
    setAdding(true);
    try {
      // Order is scoped per type so the two question banks have independent,
      // collision-free numbering.
      const order = byType[newType].length;
      const questionId = `q-${String(Date.now())}`;
      await setDoc(doc(db, COLLECTIONS.workProductQuestions, questionId), {
        questionId,
        text,
        type: newType,
        order,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDraft('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setAdding(false);
    }
  }

  async function update(q: QuestionRow, patch: Partial<WorkProductQuestion>) {
    try {
      await setDoc(
        doc(db, COLLECTIONS.workProductQuestions, q.id),
        { ...patch, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (err) {
      toast.error('Failed to save question', {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  }

  /** Persist contiguous order values for one type bucket in a single batch.
   *  No-op (and no commit) when the bucket is empty. */
  async function renumber(rows: QuestionRow[]) {
    if (rows.length === 0) return;
    const batch = writeBatch(db);
    rows.forEach((q, idx) => {
      batch.set(
        doc(db, COLLECTIONS.workProductQuestions, q.id),
        { order: idx, updatedAt: serverTimestamp() },
        { merge: true },
      );
    });
    await batch.commit();
  }

  function closeDeleteDialog() {
    setPendingDelete(null);
    setDeleteError(null);
  }

  /** Recommended path: hide the question from new forms but keep it (and
   *  every historical answer keyed to it) in the bank. */
  async function deactivatePending() {
    if (!pendingDelete) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await update(pendingDelete, { isActive: false });
      closeDeleteDialog();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Deactivate failed');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function destroyPending() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteDoc(doc(db, COLLECTIONS.workProductQuestions, target.id));
      // Close the gap left in the same-type bucket so order stays contiguous.
      const remaining = byType[target.type].filter((q) => q.id !== target.id);
      await renumber(remaining);
      closeDeleteDialog();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  }

  function onDragEnd(type: QuestionType, e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const rows = byType[type];
    const oldIndex = rows.findIndex((q) => q.id === e.active.id);
    const newIndex = rows.findIndex((q) => q.id === e.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    void renumber(arrayMove(rows, oldIndex, newIndex));
  }

  return (
    <PageHeader
      title="Observation Question Bank"
      subtitle="Questions for Work Product and Instructional Round observations. Edit text inline; deactivate to hide a question without deleting its history. Drag the grip handle to reorder within a section."
      variant="light"
      breadcrumb={['Admin', 'Work Product']}
    >
      {error ? (
        <div className="border-destructive bg-ops-red-lighter text-ops-red-dark mb-4 rounded-md border-l-4 px-4 py-3">
          Failed to load questions: {error.message}
        </div>
      ) : null}

      <div className="border-border bg-background mb-6 rounded-lg border p-4">
        <div className="flex items-start gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a new question…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
          />
          <Button onClick={() => void add()} disabled={adding}>
            <Plus />
            Add
          </Button>
        </div>
        <div className="mt-2 flex gap-4">
          {QUESTION_TYPES.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="newType"
                aria-label={TYPE_LABELS[t]}
                checked={newType === t}
                onChange={() => setNewType(t)}
                className="h-3.5 w-3.5"
              />
              {TYPE_LABELS[t]}
            </label>
          ))}
        </div>
        {addError ? <p className="text-destructive mt-2 text-sm">{addError}</p> : null}
      </div>

      {loading && !questions ? (
        <>
          <span className="sr-only" role="status" aria-live="polite">
            Loading questions…
          </span>
          <ol className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <li
                key={`skeleton-${String(i)}`}
                className="border-border bg-background flex items-center gap-2 rounded-md border p-3"
              >
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-6" />
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-4 w-16" />
              </li>
            ))}
          </ol>
        </>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">No questions yet. Add one above.</p>
      ) : (
        <div className="space-y-8">
          {QUESTION_TYPES.map((type) => {
            const rows = byType[type];
            if (rows.length === 0) return null;
            return (
              <section key={type}>
                <h2 className="font-heading text-foreground mb-3 text-base font-semibold">
                  {TYPE_LABELS[type]}
                </h2>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => onDragEnd(type, e)}
                >
                  <SortableContext
                    items={rows.map((q) => q.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ol className="space-y-2">
                      {rows.map((q, idx) => (
                        <SortableItem key={q.id} id={q.id}>
                          {({ dragHandleProps }) => (
                            <li className="border-border bg-background grid grid-cols-[auto_auto_1fr_auto] gap-2 rounded-md border p-3 md:grid-cols-[auto_auto_1fr_auto_auto] md:items-center">
                              <GripHandle
                                dragHandleProps={dragHandleProps}
                                label={`Drag to reorder: ${q.text}`}
                              />
                              <span className="text-muted-foreground w-6 self-center text-right text-sm">
                                {idx + 1}.
                              </span>
                              <Input
                                value={q.text}
                                onChange={(e) => void update(q, { text: e.target.value })}
                                className="col-span-1 col-start-3 md:col-start-3"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setDeleteError(null);
                                  setPendingDelete(q);
                                }}
                                aria-label="Delete question"
                                className="col-start-4 md:col-start-5"
                              >
                                <span aria-hidden>×</span>
                              </Button>
                              <label className="col-start-3 flex items-center gap-1 text-xs md:col-start-4 md:self-center">
                                <input
                                  type="checkbox"
                                  checked={q.isActive}
                                  onChange={(e) => void update(q, { isActive: e.target.checked })}
                                  className="h-4 w-4"
                                />
                                Active
                              </label>
                            </li>
                          )}
                        </SortableItem>
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this question?</DialogTitle>
            <DialogDescription>
              Deactivating is recommended: the question disappears from staff-facing forms but stays
              in the bank. Permanent deletion cannot be undone — past observations keep a snapshot
              of the question text, but the question itself is gone.
            </DialogDescription>
          </DialogHeader>
          {pendingDelete ? (
            <p className="border-border bg-ops-gray-lightest rounded-md border px-3 py-2 text-sm">
              {pendingDelete.text}
            </p>
          ) : null}
          {deleteError ? (
            <p role="alert" className="text-destructive text-sm">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => void destroyPending()}
              disabled={deleteBusy}
              type="button"
              className="text-destructive mr-auto"
            >
              Delete permanently
            </Button>
            <Button
              variant="outline"
              onClick={closeDeleteDialog}
              disabled={deleteBusy}
              type="button"
            >
              Cancel
            </Button>
            <Button onClick={() => void deactivatePending()} disabled={deleteBusy} type="button">
              Deactivate instead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageHeader>
  );
}
