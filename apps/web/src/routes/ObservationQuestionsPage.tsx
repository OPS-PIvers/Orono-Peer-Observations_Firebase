import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import {
  ADMIN_DEFAULT_QUESTION_SET,
  COLLECTIONS,
  GLOBAL_QUESTION_SET,
  buildingQuestionSetId,
  questionSetId,
  questionType,
  type Building,
  type WorkProductQuestion,
} from '@ops/shared';
import { PageHeader } from '@/components/PageHeader';
import { useFirestoreCollection } from '@/hooks/useFirestoreCollection';
import { useObserverScope } from '@/hooks/useObserverScope';
import { QuestionSetEditor } from '@/admin/work-product/QuestionSetEditor';

const ACTIVE = [where('isActive', '==', true)];

/**
 * Building Administrators' Planning / Reflection questions for their own
 * buildings (spec: admin-observation-updates §2). Their Standard
 * observations use their building's set, or the district Administrator
 * default while the building has none. Whether Peer Evaluators use it too
 * ("Applies to") is set in the Admin Console and only shown here.
 */
export function ObservationQuestionsPage() {
  const scope = useObserverScope();
  const { data: buildingsRaw } = useFirestoreCollection<Building>(COLLECTIONS.buildings, ACTIVE);
  const { data: questions } = useFirestoreCollection<WorkProductQuestion>(
    COLLECTIONS.workProductQuestions,
    ACTIVE,
  );

  const myBuildings = useMemo(
    () =>
      (buildingsRaw ?? [])
        .filter((b) => scope.buildings.includes(b.displayName))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [buildingsRaw, scope.buildings],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const building = myBuildings.find((b) => b.buildingId === pickedId) ?? myBuildings[0] ?? null;

  // An empty building set can start from the Administrator default, or the
  // district's Standard questions when that is empty too.
  const copySource = useMemo(() => {
    const standard = (questions ?? []).filter((q) => questionType(q) === 'standard');
    const adminDefault = standard.filter((q) => questionSetId(q) === ADMIN_DEFAULT_QUESTION_SET);
    if (adminDefault.length > 0) {
      return { label: 'the district Administrator questions', questions: adminDefault };
    }
    return {
      label: 'the district questions',
      questions: standard.filter((q) => questionSetId(q) === GLOBAL_QUESTION_SET),
    };
  }, [questions]);

  const appliesTo = building?.questionsAppliesTo ?? 'admin';

  return (
    <PageHeader
      title="Observation Questions"
      variant="light"
      subtitle="The Planning and Reflection questions staff answer on your observations. Changes apply to draft observations right away; answers already given keep the wording they were written against."
    >
      {!buildingsRaw || scope.loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : !building ? (
        <div className="bg-ops-red-lighter text-ops-red-dark rounded-md px-4 py-3 text-sm">
          Your building assignment isn&apos;t configured. Contact your site admin.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {myBuildings.length > 1 ? (
              <label className="flex items-center gap-2">
                <span className="font-medium">Building</span>
                <select
                  value={building.buildingId}
                  onChange={(e) => setPickedId(e.target.value)}
                  className="border-input bg-background h-10 rounded-md border px-3 text-sm"
                >
                  {myBuildings.map((b) => (
                    <option key={b.buildingId} value={b.buildingId}>
                      {b.displayName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="font-medium">{building.displayName}</span>
            )}
            <span className="text-muted-foreground">
              {appliesTo === 'all'
                ? 'Used on every Standard observation in this building, Peer Evaluators’ included.'
                : 'Used on administrator observations in this building.'}
            </span>
          </div>
          <QuestionSetEditor
            key={building.buildingId}
            setId={buildingQuestionSetId(building.buildingId)}
            buildingId={building.buildingId}
            copySource={copySource}
          />
        </>
      )}
    </PageHeader>
  );
}
