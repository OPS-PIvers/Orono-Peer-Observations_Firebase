import { useMemo, useState } from 'react';
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
import {
  COLLECTIONS,
  GLOBAL_QUESTION_SET,
  QUESTION_PHASES,
  QUESTION_TYPES,
  questionPhase,
  questionSetId,
  questionType,
  type QuestionPhase,
  type QuestionType,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useIsViewingAs } from '@/dev/DevModeContext';
import { assertWritable, isViewAsActive } from '@/dev/viewAsGuard';

const TYPE_LABELS: Record<QuestionType, string> = {
  standard: 'Standard',
  'work-product': 'Work Product',
  'instructional-round': 'Instructional Round',
};

// Display only — stored values stay 'pre' / 'post'. Named to match the
// Planning / Reflection panels the teacher answers them in.
export const PHASE_LABELS: Record<QuestionPhase, string> = {
  pre: 'Planning',
  post: 'Reflection',
};

type QuestionRow = WorkProductQuestion & { id: string };

export interface QuestionSetEditorProps {
  /** GLOBAL_QUESTION_SET, ADMIN_DEFAULT_QUESTION_SET or a building set. */
  setId: string;
  /** Set for a building set; written on every question (the rules check it). */
  buildingId?: string;
  /** Questions to offer copying into an empty set, with where they're from. */
  copySource?: { label: string; questions: readonly WorkProductQuestion[] };
}

/**
 * Add / edit / reorder / activate / delete one question set. The district
 * set holds every observation type; building and admin sets hold Standard
 * Planning / Reflection questions only, so their type picker is hidden.
 */
export function QuestionSetEditor({ setId, buildingId, copySource }: QuestionSetEditorProps) {
  const {
    data: questions,
    loading,
    error,
  } = useFirestoreCollection<WorkProductQuestion>(COLLECTIONS.workProductQuestions);
  const allTypes = setId === GLOBAL_QUESTION_SET;
  const isViewingAs = useIsViewingAs();
  const [draft, setDraft] = useState('');
  const [newType, setNewType] = useState<QuestionType>('standard');
  const [newPhase, setNewPhase] = useState<QuestionPhase>('pre');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuestionRow | null>(null);
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const sorted = useMemo(
    () =>
      (questions ?? []).filter((q) => questionSetId(q) === setId).sort((a, b) => a.order - b.order),
    [questions, setId],
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function newQuestionDoc(text: string, type: QuestionType, phase: QuestionPhase, order: number) {
    const questionId = `q-${String(Date.now())}-${String(order)}`;
    return {
      id: questionId,
      data: {
        questionId,
        text,
        type: allTypes ? type : 'standard',
        phase,
        order,
        isActive: true,
        setId,
        ...(buildingId ? { buildingId } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    };
  }

  async function add() {
    setAddError(null);
    const text = draft.trim();
    if (!text) {
      setAddError('Question text is required.');
      return;
    }
    setAdding(true);
    try {
      assertWritable();
      const { id, data } = newQuestionDoc(text, newType, newPhase, sorted.length);
      await setDoc(doc(db, COLLECTIONS.workProductQuestions, id), data);
      setDraft('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setAdding(false);
    }
  }

  async function copyFrom(source: readonly WorkProductQuestion[]) {
    setAddError(null);
    setCopying(true);
    try {
      assertWritable();
      const active = source.filter((q) => q.isActive).sort((a, b) => a.order - b.order);
      for (const [i, q] of active.entries()) {
        const { id, data } = newQuestionDoc(q.text, questionType(q), questionPhase(q), i);
        await setDoc(doc(db, COLLECTIONS.workProductQuestions, id), data);
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Copy failed');
    } finally {
      setCopying(false);
    }
  }

  async function update(q: QuestionRow, patch: Partial<WorkProductQuestion>) {
    if (isViewAsActive()) return;
    await setDoc(
      doc(db, COLLECTIONS.workProductQuestions, q.id),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  async function confirmDelete() {
    if (!deleting || isViewAsActive()) return;
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
      assertWritable();
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
    // Dev view-as is read-only: a disabled fieldset turns off every input,
    // button and drag handle at once, so the page can't look editable.
    <fieldset disabled={isViewingAs} className="min-w-0">
      {isViewingAs ? (
        <p className="text-muted-foreground mb-3 text-sm">
          Read-only while viewing as someone else.
        </p>
      ) : null}
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
            aria-label="New question"
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
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          {allTypes ? (
            <>
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
              <span className="text-muted-foreground hidden md:inline">|</span>
            </>
          ) : null}
          {QUESTION_PHASES.map((ph) => (
            <label key={ph} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="newPhase"
                checked={newPhase === ph}
                onChange={() => setNewPhase(ph)}
                className="h-3.5 w-3.5"
              />
              {PHASE_LABELS[ph]}
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
        <div className="text-muted-foreground space-y-3 text-sm">
          <p>No questions in this set yet. Add one above.</p>
          {copySource?.questions.some((q) => q.isActive) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={copying}
              onClick={() => void copyFrom(copySource.questions)}
            >
              {copying ? 'Copying…' : `Start from ${copySource.label}`}
            </Button>
          ) : null}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sorted.map((q) => q.id)} strategy={verticalListSortingStrategy}>
            <ol className="space-y-2">
              {sorted.map((q, idx) => (
                <SortableItem key={q.id} id={q.id}>
                  {({ dragHandleProps }) => (
                    <li className="border-border bg-background grid grid-cols-[auto_auto_1fr_auto] gap-2 rounded-md border p-3 md:grid-cols-[auto_auto_1fr_auto_auto_auto_auto] md:items-center">
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
                        aria-label={`Question ${String(idx + 1)}`}
                        className="col-span-1 col-start-3 md:col-start-3"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(q)}
                        aria-label="Delete question"
                        className="md:col-start-7"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      {allTypes ? (
                        <select
                          value={questionType(q)}
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
                      ) : null}
                      <select
                        value={questionPhase(q)}
                        onChange={(e) => void update(q, { phase: e.target.value as QuestionPhase })}
                        className="col-start-3 h-9 rounded-md border border-gray-200 px-2 py-1.5 text-xs md:col-start-5 md:w-auto"
                        aria-label="Question phase"
                      >
                        {QUESTION_PHASES.map((ph) => (
                          <option key={ph} value={ph}>
                            {PHASE_LABELS[ph]}
                          </option>
                        ))}
                      </select>
                      <label className="col-start-3 flex items-center gap-1 text-xs md:col-start-6 md:self-center">
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
        Drag the grip handle to reorder questions; the new order is saved automatically. Editing or
        deleting a question never changes answers already given: they keep the wording they were
        written against.
        {reordering ? ' Saving order…' : null}
      </p>
      {reorderError ? <p className="text-destructive mt-1 text-xs">{reorderError}</p> : null}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete question</DialogTitle>
            <DialogDescription>
              Permanently delete <strong>&quot;{deleting?.text}&quot;</strong>? Answers already
              given stay on their observations under the wording they were written against.
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
    </fieldset>
  );
}
