import { useMemo } from 'react';
import { where } from 'firebase/firestore';
import {
  COLLECTIONS,
  GLOBAL_QUESTION_SET,
  questionSetId,
  questionType,
  resolveQuestionSetId,
  type Building,
  type ObservationType,
  type QuestionSetResolution,
  type Staff,
  type WorkProductQuestion,
} from '@ops/shared';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useObserverScope } from '@/hooks/useObserverScope';

const ACTIVE = [where('isActive', '==', true)];

/**
 * Which Planning / Reflection question set a new observation of `staff`
 * would use (resolveQuestionSetId), from the live buildings and question
 * sets. Null while loading. `{ choose }` means the observer must pick a
 * building first; pass the pick back as `chosenBuildingId`.
 */
export function useQuestionSetResolution(
  staff: Staff | null,
  type: ObservationType,
  chosenBuildingId: string | null,
): QuestionSetResolution | null {
  const scope = useObserverScope();
  const { data: buildings } = useFirestoreCollection<Building>(
    staff ? COLLECTIONS.buildings : '',
    ACTIVE,
  );
  const { data: questions } = useFirestoreCollection<WorkProductQuestion>(
    staff ? COLLECTIONS.workProductQuestions : '',
    ACTIVE,
  );

  return useMemo(() => {
    if (!staff || !buildings || !questions || scope.loading) return null;
    const setsWithQuestions = new Set(
      questions
        .filter((q) => questionType(q) === 'standard')
        .map(questionSetId)
        .filter((id) => id !== GLOBAL_QUESTION_SET),
    );
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
    const staffBuildings = staff.buildings ?? [];
    const teacherBuildings = buildings
      .filter((b) => staffBuildings.includes(b.displayName))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((b) => ({
        buildingId: b.buildingId,
        displayName: b.displayName,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Firestore reads bypass Zod defaults; older docs may lack this field
        questionsAppliesTo: b.questionsAppliesTo ?? 'admin',
      }));
    return resolveQuestionSetId({
      observerRole: scope.role,
      type,
      teacherBuildings,
      observerBuildingNames: scope.buildings,
      chosenBuildingId,
      setsWithQuestions,
    });
  }, [staff, buildings, questions, scope, type, chosenBuildingId]);
}
