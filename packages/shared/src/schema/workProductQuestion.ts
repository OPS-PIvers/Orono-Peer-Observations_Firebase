import { z } from 'zod';
import { isoDate, slugId } from './common.js';
import { OBSERVATION_TYPES, type ObservationType } from '../constants.js';

/**
 * Which observation type a question is filed under — one entry per member of
 * `OBSERVATION_TYPES`. Every observation type carries its own pre/post
 * reflection questions, Standard included; this list must stay in step with
 * `OBSERVATION_TYPES` in constants.ts.
 */
export const QUESTION_TYPES = ['standard', 'work-product', 'instructional-round'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Which question-bank `type` an observation's questions are filed under.
 * Exhaustive over `OBSERVATION_TYPES` — a new observation type will fail to
 * compile here until its questions have a home, which is the point. Shared
 * by the web editor (loading the bank for the Planning / Reflection panels)
 * and the finalize callable (printing answers into the PDF).
 */
export const QUESTION_TYPE_BY_OBSERVATION_TYPE: Record<ObservationType, QuestionType> = {
  [OBSERVATION_TYPES.standard]: 'standard',
  [OBSERVATION_TYPES.workProduct]: 'work-product',
  [OBSERVATION_TYPES.instructionalRound]: 'instructional-round',
};

/**
 * /workProductQuestions/{id} — the reflection question bank the observed staff
 * member answers, filed by observation type.
 *
 * The collection keeps its migrated name (from the GAS WorkProductQuestions
 * sheet) because renaming a live Firestore collection buys nothing but a
 * migration. `type` below, not the collection name, decides which observations
 * a question belongs to — and that includes Standard observations, which have
 * pre/post questions exactly as Work Product and Instructional Round do.
 */
export const workProductQuestion = z.object({
  questionId: slugId,
  text: z.string().trim().min(1),
  /** Display order. Lower = earlier in the form. */
  order: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
  /** Which observation type this question belongs to. Defaults to 'work-product'
   *  so existing docs without this field parse correctly. */
  type: z.enum(QUESTION_TYPES).default('work-product'),
  /**
   * When the teacher answers this question, relative to the observation
   * itself. `pre` questions are answerable from the moment the observation is
   * created; `post` questions unlock per the district's Reflection setting (see
   * `postQuestionsUnlocked`). Defaults to 'pre' so every question written
   * before the split keeps its existing always-available behaviour.
   */
  phase: z.enum(['pre', 'post']).default('pre'),
  /**
   * Which question set this belongs to (see resolveQuestionSetId):
   * GLOBAL_QUESTION_SET (the district set, every type — and every question
   * written before sets existed), ADMIN_DEFAULT_QUESTION_SET, or a
   * building's set (buildingQuestionSetId). Building and admin sets hold
   * Standard questions only.
   */
  setId: z.string().default('global'),
  /** The building, for a building set (rules check the editor's buildings). */
  buildingId: z.string().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type WorkProductQuestion = z.infer<typeof workProductQuestion>;

export const workProductQuestionInput = workProductQuestion.omit({
  createdAt: true,
  updatedAt: true,
});
export type WorkProductQuestionInput = z.infer<typeof workProductQuestionInput>;

/** Ordered phases, for rendering the two sections and the admin selector. */
export const QUESTION_PHASES = ['pre', 'post'] as const;
export type QuestionPhase = (typeof QUESTION_PHASES)[number];

/**
 * When a staff member's Reflection (post) questions open, district-wide.
 * Set in the admin Observation Questions page; stored on `/appSettings/global`.
 *   - 'always'            — open from the moment the observation exists, so a
 *                           teacher can draft reflections at their own pace.
 *   - 'after-observation' — open the calendar day after the observation date.
 */
export const REFLECTION_UNLOCK_MODES = ['always', 'after-observation'] as const;
export type ReflectionUnlockMode = (typeof REFLECTION_UNLOCK_MODES)[number];

/** Peer evaluators asked for Reflection to be available up front (Sept 2026). */
export const DEFAULT_REFLECTION_UNLOCK: ReflectionUnlockMode = 'always';

/**
 * The mode to apply, given whatever `/appSettings/global` holds. A settings
 * doc that has not loaded yet, predates the field, or holds an unknown value
 * falls back to {@link DEFAULT_REFLECTION_UNLOCK}.
 */
export function resolveReflectionUnlock(stored: unknown): ReflectionUnlockMode {
  return (REFLECTION_UNLOCK_MODES as readonly unknown[]).includes(stored)
    ? (stored as ReflectionUnlockMode)
    : DEFAULT_REFLECTION_UNLOCK;
}

/**
 * Are a staff member's post-observation questions open yet?
 *
 * In 'always' mode they are open unconditionally. In 'after-observation' mode
 * the gate is the observation date, not the status: an observation stays
 * `Draft` until the evaluator finalizes it, which can be days later, and the
 * teacher's post-reflection is meant to be written while the lesson is fresh.
 * Comparing calendar days (not timestamps) means the questions open the moment
 * the day after the observation begins, rather than 24 hours after whatever
 * time was stored. An observation with no date recorded keeps its post
 * questions closed in that mode — there is nothing to be "after" yet.
 */
export function postQuestionsUnlocked(
  observationDate: Date | null,
  now: Date,
  mode: ReflectionUnlockMode,
): boolean {
  if (mode === 'always') return true;
  if (!observationDate) return false;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return day(now) > day(observationDate);
}

/**
 * Read `type` / `phase` off a question that came straight from Firestore.
 *
 * `useFirestoreCollection` hands back raw document data without running the
 * Zod parser, so the `.default()`s above never fire on read: a question
 * written before one of these fields existed genuinely arrives without it,
 * even though the inferred type promises otherwise. These helpers apply the
 * default at the read edge and keep the narrowing — and the reason it is
 * needed — in one place instead of scattering `?? 'pre'` across call sites
 * where the linter can only see the (lying) type.
 */
export function questionPhase(q: Pick<WorkProductQuestion, 'phase'>): QuestionPhase {
  return (q as Partial<Pick<WorkProductQuestion, 'phase'>>).phase ?? 'pre';
}

export function questionType(q: Pick<WorkProductQuestion, 'type'>): QuestionType {
  return (q as Partial<Pick<WorkProductQuestion, 'type'>>).type ?? 'work-product';
}

// ─── Question sets ───────────────────────────────────────────────────────────

/** The district set: Peer Evaluator observations, every non-Standard type,
 *  and every observation created before question sets existed. */
export const GLOBAL_QUESTION_SET = 'global';
/** The district default for building Administrators' observations when
 *  their building has no set of its own. */
export const ADMIN_DEFAULT_QUESTION_SET = 'district-admin';

export function buildingQuestionSetId(buildingId: string): string {
  return `building-${buildingId}`;
}

/** `setId` off a raw Firestore question (see questionPhase on why). */
export function questionSetId(q: { setId?: string | undefined }): string {
  return q.setId ?? GLOBAL_QUESTION_SET;
}

/** The questions an observation shows: its type's questions in its set. */
export function questionsForObservation<
  Q extends Pick<WorkProductQuestion, 'type'> & { setId?: string | undefined },
>(
  questions: readonly Q[],
  obs: { type: ObservationType; questionSetId?: string | undefined },
): Q[] {
  const type = QUESTION_TYPE_BY_OBSERVATION_TYPE[obs.type];
  const setId = obs.questionSetId ?? GLOBAL_QUESTION_SET;
  return questions.filter((q) => questionType(q) === type && questionSetId(q) === setId);
}

export interface QuestionSetBuilding {
  buildingId: string;
  displayName: string;
  questionsAppliesTo?: 'admin' | 'all' | undefined;
}

export type QuestionSetResolution =
  | { setId: string }
  /** More than one of the teacher's buildings qualifies: the observer picks. */
  | { choose: QuestionSetBuilding[] };

/**
 * Which question set a new observation uses (spec: admin-observation-updates
 * §2). Only Standard observations use building / admin sets.
 *
 * - Building Administrator: the chosen building's set (defaulted when only
 *   one of the teacher's buildings is theirs), else the district admin
 *   default, else the district set.
 * - Anyone else: the teacher's building set when that building applies its
 *   set to all observations; the observer picks if several do; otherwise
 *   the district set.
 *
 * `setsWithQuestions` holds the set ids that have at least one active
 * Standard question; an empty set never wins.
 */
export function resolveQuestionSetId(args: {
  observerRole: string | null | undefined;
  type: ObservationType;
  /** Buildings the observed teacher is in. */
  teacherBuildings: readonly QuestionSetBuilding[];
  /** For an Administrator: their buildings' display names. */
  observerBuildingNames?: readonly string[];
  /** The observer's pick when there was a choice. */
  chosenBuildingId?: string | null | undefined;
  setsWithQuestions: ReadonlySet<string>;
}): QuestionSetResolution {
  const { observerRole, type, teacherBuildings, setsWithQuestions } = args;
  if (type !== OBSERVATION_TYPES.standard) return { setId: GLOBAL_QUESTION_SET };
  const hasSet = (b: QuestionSetBuilding) =>
    setsWithQuestions.has(buildingQuestionSetId(b.buildingId));

  if (observerRole === 'administrator') {
    const mine = teacherBuildings.filter((b) =>
      (args.observerBuildingNames ?? []).includes(b.displayName),
    );
    const chosen =
      mine.find((b) => b.buildingId === args.chosenBuildingId) ??
      (mine.length === 1 ? mine[0] : undefined);
    if (!chosen && mine.filter(hasSet).length > 1) return { choose: mine.filter(hasSet) };
    const building = chosen ?? mine.find(hasSet);
    if (building && hasSet(building)) return { setId: buildingQuestionSetId(building.buildingId) };
    return {
      setId: setsWithQuestions.has(ADMIN_DEFAULT_QUESTION_SET)
        ? ADMIN_DEFAULT_QUESTION_SET
        : GLOBAL_QUESTION_SET,
    };
  }

  const qualifying = teacherBuildings.filter((b) => b.questionsAppliesTo === 'all' && hasSet(b));
  const chosen = qualifying.find((b) => b.buildingId === args.chosenBuildingId);
  if (chosen) return { setId: buildingQuestionSetId(chosen.buildingId) };
  if (qualifying.length === 1 && qualifying[0]) {
    return { setId: buildingQuestionSetId(qualifying[0].buildingId) };
  }
  if (qualifying.length > 1) return { choose: qualifying };
  return { setId: GLOBAL_QUESTION_SET };
}
