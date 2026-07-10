import { useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type WorkProductQuestion } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { bulkMergePerRow } from '@/admin/_shared/bulkWrite';
import { GripHandle, SortableItem } from '@/admin/dashboard/SortableItem';

const QUESTION_TYPES = ['work-product', 'instructional-round'] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];

const TYPE_LABELS: Record<QuestionType, string> = {
  'work-product': 'Work Product',
  'instructional-round': 'Instructional Round',
};

type QuestionRow = WorkProductQuestion & { id: string };

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
  const [deleting, setDeleting] = useState<QuestionRow | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const sorted = (questions ?? []).slice().sort((a, b) => a.order - b.order);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function add() {
    setAddError(null);
    const text = draft.trim();
    if (!text) {
      setAddError('Question text is required.');
      return;
    }
    setAdding(true);
    try {
      const order = sorted.length;
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

  async function update(
    q: WorkProductQuestion & { id: string },
    patch: Partial<WorkProductQuestion>,
  ) {
    await setDoc(
      doc(db, COLLECTIONS.workProductQuestions, q.id),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async function confirmDelete() {
    if (!deleting) return;
    await deleteDoc(doc(db, COLLECTIONS.workProductQuestions, deleting.id));
    setDeleting(null);
  }

  async function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = sorted.findIndex((q) => q.id === e.active.id);
    const newIndex = sorted.findIndex((q) => q.id === e.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sorted, oldIndex, newIndex);
    setReorderError(null);
    setReordering(true);
    try {
      await bulkMergePerRow(
        COLLECTIONS.workProductQuestions,
        reordered.map((q) => q.id),
        (id) => {
          const nextOrder = reordered.findIndex((q) => q.id === id);
          return nextOrder === -1 ? null : { order: nextOrder };
        },
      );
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : 'Reorder failed');
    } finally {
      setReordering(false);
    }
  }

  return (
    <PageHeader
      title="Observation Question Bank"
      subtitle="Questions for Work Product and Instructional Round observations. Edit text inline; deactivate to hide a question without deleting its history. Set the type so each question appears in the correct staff-facing form."
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sorted.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2">
              {sorted.map((q, idx) => (
                <SortableItem key={q.id} id={q.id}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background grid grid-cols-[auto_auto_1fr_auto] gap-2 rounded-md border p-3 md:grid-cols-[auto_auto_1fr_auto_auto_auto] md:items-center">
                      <GripHandle
                        dragHandleProps={dragHandleProps}
                        label="Drag to reorder question"
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
                        onClick={() => setDeleting(q)}
                        aria-label="Delete question"
                        className="md:col-start-6"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <select
                        value={q.type}
                        onChange={(e) => void update(q, { type: e.target.value as QuestionType })}
                        className="col-start-3 h-9 rounded-md border border-gray-200 px-2 py-1.5 text-xs md:col-start-4 md:w-auto"
                        aria-label="Question type"
                      >
                        {QUESTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                      <label className="col-start-3 flex items-center gap-1 text-xs md:col-start-5 md:self-center">
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
      )}

      <p className="text-muted-foreground mt-6 text-xs">
        Drag the grip handle to reorder questions; the new order is saved automatically.
        {reordering ? ' Saving order…' : null}
      </p>
      {reorderError ? <p className="text-destructive mt-1 text-xs">{reorderError}</p> : null}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete question</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>&quot;{deleting?.text}&quot;</strong>? This question will
              be removed from the question bank, but past responses will remain in finalized
              observations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} type="button">
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} type="button">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageHeader>
  );
}
