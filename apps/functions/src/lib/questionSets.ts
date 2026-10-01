import type { Firestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  GLOBAL_QUESTION_SET,
  buildingQuestionSetId,
  questionSetId,
  questionType,
  resolveQuestionSetId,
  type Building,
  type ObservationType,
  type WorkProductQuestion,
} from '@ops/shared';

/**
 * Server-side twin of the web's useQuestionSetResolution, for observations
 * created without a person at the keyboard (window bookings). When several
 * buildings qualify there is no one to ask, so the first by name wins.
 */
export async function resolveObservationQuestionSet(
  db: Firestore,
  args: {
    observerRole: string | null | undefined;
    observerBuildings: readonly string[];
    staffBuildings: readonly string[];
    type: ObservationType;
  },
): Promise<string> {
  const [buildingsSnap, questionsSnap] = await Promise.all([
    db.collection(COLLECTIONS.buildings).where('isActive', '==', true).get(),
    db.collection(COLLECTIONS.workProductQuestions).where('isActive', '==', true).get(),
  ]);
  const setsWithQuestions = new Set(
    questionsSnap.docs
      .map((d) => d.data() as WorkProductQuestion)
      .filter((q) => questionType(q) === 'standard')
      .map(questionSetId)
      .filter((id) => id !== GLOBAL_QUESTION_SET),
  );
  const teacherBuildings = buildingsSnap.docs
    .map((d) => d.data() as Partial<Building>)
    .filter(
      (b): b is Partial<Building> & { buildingId: string; displayName: string } =>
        typeof b.buildingId === 'string' &&
        typeof b.displayName === 'string' &&
        args.staffBuildings.includes(b.displayName),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((b) => ({
      buildingId: b.buildingId,
      displayName: b.displayName,
      questionsAppliesTo: b.questionsAppliesTo ?? 'admin',
    }));
  const resolved = resolveQuestionSetId({
    observerRole: args.observerRole,
    type: args.type,
    teacherBuildings,
    observerBuildingNames: args.observerBuildings,
    setsWithQuestions,
  });
  if ('setId' in resolved) return resolved.setId;
  const first = resolved.choose[0];
  return first ? buildingQuestionSetId(first.buildingId) : GLOBAL_QUESTION_SET;
}
