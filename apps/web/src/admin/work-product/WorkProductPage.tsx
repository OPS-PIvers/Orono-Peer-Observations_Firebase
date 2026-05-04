import { useState } from 'react';
import { Plus, GripVertical, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { COLLECTIONS, type WorkProductQuestion } from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { db } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

const QUESTION_TYPES = ['work-product', 'instructional-round'] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];

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

  const sorted = (questions ?? []).slice().sort((a, b) => a.order - b.order);

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

  async function destroy(id: string) {
    await deleteDoc(doc(db, COLLECTIONS.workProductQuestions, id));
  }

  return (
    <>
      <PageHeader
        title="Observation Question Bank"
        subtitle="Questions for Work Product and Instructional Round observations. Edit text inline; deactivate to hide a question without deleting its history. Set the type so each question appears in the correct staff-facing form."
      />

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
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">No questions yet. Add one above.</p>
      ) : (
        <ol className="space-y-2">
          {sorted.map((q, idx) => (
            <li
              key={q.id}
              className="border-border bg-background flex items-start gap-2 rounded-md border p-3"
            >
              <span className="text-muted-foreground mt-2 cursor-grab" aria-hidden>
                <GripVertical className="h-4 w-4" />
              </span>
              <span className="text-muted-foreground mt-2 w-6 text-right text-sm">{idx + 1}.</span>
              <Input
                value={q.text}
                onChange={(e) => void update(q, { text: e.target.value })}
                className="flex-1"
              />
              <select
                value={q.type}
                onChange={(e) => void update(q, { type: e.target.value as QuestionType })}
                className="rounded-md border border-gray-200 px-2 py-1.5 text-xs"
                aria-label="Question type"
              >
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <label className="mt-2 flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={q.isActive}
                  onChange={(e) => void update(q, { isActive: e.target.checked })}
                  className="h-4 w-4"
                />
                Active
              </label>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void destroy(q.id)}
                aria-label="Delete question"
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}

      <p className="text-muted-foreground mt-6 text-xs">
        Reordering via drag-and-drop will land in Phase 7 polish; for now, add questions in the
        order you want them displayed.
      </p>
    </>
  );
}
