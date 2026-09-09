import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronDown, Lock } from 'lucide-react';
import type { QuestionPhase, TiptapDoc, WorkProductAnswer, WorkProductQuestion } from '@ops/shared';
import { TiptapEditor } from '@/components/ui/tiptap-editor';
import { cn } from '@/lib/utils';
import { toDateInputValue, parseDateInput } from '@/utils/dateHelpers';
import { hasTiptapContent } from '@/utils/tiptapContent';
import { SaveStatusIndicator } from './GlobalToolsBar';
import { answerProgress, answeredAfterFinalize, type AnswerEditability } from './questionAnswers';

/** One phase's slice of the observation question bank, plus whether the
 *  current viewer may answer it right now. */
export interface PhaseQuestionsSlot {
  questions: readonly (WorkProductQuestion & { id: string })[];
  editability: AnswerEditability;
}

/**
 * The observed staff member's pre/post questions, threaded into the
 * Planning / Reflection panels. Omitted entirely when the caller has not
 * loaded a question bank (the panels then hold only the evaluator's date
 * and notes, as before).
 */
export interface QuestionsSlot {
  pre: PhaseQuestionsSlot;
  post: PhaseQuestionsSlot;
  /** Current answer document per questionId. */
  answers: Readonly<Record<string, TiptapDoc>>;
  /** Stored answers (for `updatedAt`) — used to flag post-finalize edits. */
  stored: ReadonlyMap<string, WorkProductAnswer>;
  /** Raw `finalizedAt` from the observation doc; null while a Draft. */
  finalizedAt: unknown;
  /** Observation date, used to explain the Reflection lock. */
  observationDate: Date | null;
  onAnswerChange: (questionId: string, value: TiptapDoc) => void;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  onRetrySave: () => void;
  isOnline: boolean;
}

export interface MeetingNotesSectionProps {
  preObsDate: Date | undefined;
  preObsNotes: TiptapDoc | undefined;
  postObsDate: Date | undefined;
  postObsNotes: TiptapDoc | undefined;
  /** Whether the evaluator's date + notes are editable by this viewer. */
  readOnly: boolean;
  onPreObsDateChange: (date: Date | undefined) => void;
  onPreObsNotesChange: (doc: TiptapDoc) => void;
  onPostObsDateChange: (date: Date | undefined) => void;
  onPostObsNotesChange: (doc: TiptapDoc) => void;
  questions?: QuestionsSlot | undefined;
  /**
   * External request to open a panel — the observation page passes the URL
   * hash (`#planning` / `#reflection`) so dashboard cards and emails can
   * land the reader on the right panel. Re-applied whenever it changes; the
   * user can still close the panel afterwards.
   */
  openPanel?: QuestionPhase | null | undefined;
  /**
   * Optional slot rendered to the far right of the toggle row at md+
   * widths, dropped below the row at narrow widths. Used by the
   * observation editor to host the Assigned/Full Rubric toggle inline
   * with Planning/Reflection on desktop.
   */
  actions?: ReactNode;
}

type ActiveTab = null | QuestionPhase;

interface PanelProps {
  /** Stable HTML-id slug — keep distinct per sub-section ('pre' / 'post'). */
  slug: QuestionPhase;
  dateValue: Date | undefined;
  notesValue: TiptapDoc | undefined;
  readOnly: boolean;
  onDateChange: (date: Date | undefined) => void;
  onNotesChange: (doc: TiptapDoc) => void;
  questions: QuestionsSlot | undefined;
}

const PHASE_LABEL: Record<QuestionPhase, string> = { pre: 'Planning', post: 'Reflection' };

function Panel({
  slug,
  dateValue,
  notesValue,
  readOnly,
  onDateChange,
  onNotesChange,
  questions,
}: PanelProps) {
  const dateInputId = `meeting-date-${slug}`;
  const phase = questions?.[slug];
  const answering = phase?.editability === 'editable';
  const hasQuestions = (phase?.questions.length ?? 0) > 0;
  // A read-only viewer (the observed teacher, today) should not stare at an
  // empty date input and an empty "Add meeting notes…" box that belong to
  // the evaluator. Show those controls only when they carry content.
  const showDate = !readOnly || dateValue !== undefined;
  const showNotes = !readOnly || hasTiptapContent(notesValue);

  return (
    <div
      id={`meeting-panel-${slug}`}
      className="border-ops-blue-lighter mt-2 space-y-4 rounded-md border bg-white p-3"
    >
      <div className="flex min-h-6 items-center gap-3">
        {showDate ? (
          <>
            <label htmlFor={dateInputId} className="text-ops-gray-dark text-xs font-medium">
              Date
            </label>
            <input
              id={dateInputId}
              type="date"
              value={toDateInputValue(dateValue)}
              disabled={readOnly}
              onChange={(e) => onDateChange(parseDateInput(e.target.value))}
              className={cn(
                'border-input h-9 rounded-md border px-3 text-sm',
                readOnly && 'cursor-not-allowed opacity-70',
              )}
            />
          </>
        ) : null}
        {questions && answering ? (
          <div className="ml-auto">
            <SaveStatusIndicator
              state={questions.saveState}
              error={questions.saveError}
              onRetry={questions.onRetrySave}
              isOnline={questions.isOnline}
            />
          </div>
        ) : null}
      </div>

      {questions && phase && hasQuestions ? (
        <section className="space-y-4" aria-label={`${PHASE_LABEL[slug]} questions`}>
          <SectionHeading>{PHASE_LABEL[slug]} questions</SectionHeading>
          <PhaseQuestionsBlock phase={slug} slot={phase} questions={questions} />
        </section>
      ) : null}

      {showNotes ? (
        <section className="space-y-2">
          {hasQuestions ? <SectionHeading>Evaluator notes</SectionHeading> : null}
          <TiptapEditor
            value={notesValue}
            onChange={onNotesChange}
            readOnly={readOnly}
            variant="full"
            minHeight="5rem"
            placeholder="Add meeting notes…"
          />
        </section>
      ) : null}
    </div>
  );
}

function PhaseQuestionsBlock({
  phase,
  slot,
  questions,
}: {
  phase: QuestionPhase;
  slot: PhaseQuestionsSlot;
  questions: QuestionsSlot;
}) {
  if (slot.editability === 'locked-until-after') {
    const date = questions.observationDate;
    return (
      <div className="text-muted-foreground flex items-start gap-2.5 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          {date
            ? `Reflection questions open the day after the observation (${date.toLocaleDateString()}).`
            : 'Reflection questions open once the observation has been scheduled and has taken place.'}
        </p>
      </div>
    );
  }

  const editable = slot.editability === 'editable';

  return (
    <div className="space-y-5">
      {slot.editability === 'finalized' ? (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Planning answers are locked now that this observation is finalized.
        </p>
      ) : null}
      {editable ? (
        <p className="text-muted-foreground text-xs">
          Your answers save automatically as you type.
        </p>
      ) : null}
      {slot.questions.map((q, idx) => {
        const value = questions.answers[q.questionId];
        const answered = hasTiptapContent(value);
        const editedAfterFinalize = answeredAfterFinalize(
          questions.stored.get(q.questionId),
          questions.finalizedAt,
        );
        return (
          <div key={q.id} data-phase={phase}>
            <p className="text-ops-gray-dark mb-1.5 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
              <span>
                {idx + 1}. {q.text}
              </span>
              {editedAfterFinalize ? (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Edited after finalize
                </span>
              ) : null}
            </p>
            {editable ? (
              <TiptapEditor
                value={value}
                onChange={(next) => questions.onAnswerChange(q.questionId, next)}
                placeholder="Type your response here…"
                minHeight="6rem"
              />
            ) : answered ? (
              <TiptapEditor
                value={value}
                onChange={() => undefined}
                readOnly
                variant="compact"
                minHeight="4rem"
                className="mt-1"
              />
            ) : (
              <p className="mt-1 text-sm text-gray-400 italic">Not yet answered</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-ops-gray-dark border-b border-gray-200 pb-1.5 text-xs font-semibold tracking-wide uppercase">
      {children}
    </h3>
  );
}

function dateLabel(d: Date | undefined): string | null {
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
}

/**
 * Pill suffix after the date: `3 of 5` answered, a padlock while Reflection
 * is still locked, nothing when the bank is empty. Both sides of the
 * observation see the same thing.
 */
function progressLabel(
  slug: QuestionPhase,
  questions: QuestionsSlot | undefined,
): { text: string } | { locked: true } | null {
  const phase = questions?.[slug];
  if (!questions || !phase || phase.questions.length === 0) return null;
  if (phase.editability === 'locked-until-after') return { locked: true };
  const { answered, total } = answerProgress(phase.questions, questions.answers);
  return { text: `${String(answered)} of ${String(total)}` };
}

function TabButton({
  active,
  hasContent,
  onClick,
  label,
  date,
  progress,
  controls,
}: {
  active: boolean;
  hasContent: boolean;
  onClick: () => void;
  label: string;
  date: string | null;
  progress: ReturnType<typeof progressLabel>;
  controls: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      aria-controls={controls}
      className={cn(
        'flex w-full items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
        'md:inline-flex md:w-auto md:shrink-0 md:justify-start',
        active
          ? 'border-ops-blue bg-ops-blue/10 text-ops-blue-dark'
          : hasContent
            ? 'border-ops-blue-lighter text-ops-blue-dark hover:bg-ops-blue-lighter/60 bg-white'
            : 'border-input text-ops-gray-dark hover:bg-ops-blue-lighter/50 bg-white',
      )}
    >
      <CalendarClock className="h-3.5 w-3.5" />
      {label}
      {date ? <span className="text-muted-foreground font-normal">· {date}</span> : null}
      {progress && 'locked' in progress ? (
        <span className="text-muted-foreground inline-flex items-center gap-1 font-normal">
          · <Lock className="h-3 w-3" aria-label="Locked until the day after the observation" />
        </span>
      ) : progress ? (
        <span className="text-muted-foreground font-normal">· {progress.text}</span>
      ) : null}
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', active && 'rotate-180')} />
    </button>
  );
}

/**
 * Compact Planning / Reflection control. Renders as a slim label + two
 * pill-style toggles inline with the page flow; the panel expands beneath
 * only when its pill is active. Each panel holds, in order, the evaluator's
 * meeting date, the observed staff member's questions for that phase (when
 * a question bank is supplied), and the evaluator's meeting notes.
 */
export function MeetingNotesSection({
  preObsDate,
  preObsNotes,
  postObsDate,
  postObsNotes,
  readOnly,
  onPreObsDateChange,
  onPreObsNotesChange,
  onPostObsDateChange,
  onPostObsNotesChange,
  questions,
  openPanel,
  actions,
}: MeetingNotesSectionProps) {
  const [active, setActive] = useState<ActiveTab>(openPanel ?? null);

  useEffect(() => {
    if (!openPanel) return;
    setActive(openPanel);
    // Scroll after the panel has mounted. The scroll container is <main>,
    // not the document, so a native anchor jump would not land here anyway.
    const id = requestAnimationFrame(() => {
      document
        .getElementById(`meeting-panel-${openPanel}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [openPanel]);

  return (
    <div className="space-y-2 md:space-y-0">
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-nowrap md:items-center md:overflow-x-auto">
        <span className="text-ops-gray-dark hidden shrink-0 text-xs font-semibold tracking-wide uppercase sm:inline">
          Meeting Notes
        </span>
        <TabButton
          active={active === 'pre'}
          hasContent={preObsDate !== undefined || hasTiptapContent(preObsNotes)}
          onClick={() => setActive((v) => (v === 'pre' ? null : 'pre'))}
          label="Planning"
          date={dateLabel(preObsDate)}
          progress={progressLabel('pre', questions)}
          controls="meeting-panel-pre"
        />
        <TabButton
          active={active === 'post'}
          hasContent={postObsDate !== undefined || hasTiptapContent(postObsNotes)}
          onClick={() => setActive((v) => (v === 'post' ? null : 'post'))}
          label="Reflection"
          date={dateLabel(postObsDate)}
          progress={progressLabel('post', questions)}
          controls="meeting-panel-post"
        />
        {actions ? <div className="hidden md:ml-auto md:block">{actions}</div> : null}
      </div>
      {actions ? <div className="md:hidden">{actions}</div> : null}
      {active === 'pre' ? (
        <Panel
          slug="pre"
          dateValue={preObsDate}
          notesValue={preObsNotes}
          readOnly={readOnly}
          onDateChange={onPreObsDateChange}
          onNotesChange={onPreObsNotesChange}
          questions={questions}
        />
      ) : null}
      {active === 'post' ? (
        <Panel
          slug="post"
          dateValue={postObsDate}
          notesValue={postObsNotes}
          readOnly={readOnly}
          onDateChange={onPostObsDateChange}
          onNotesChange={onPostObsNotesChange}
          questions={questions}
        />
      ) : null}
    </div>
  );
}
