import { describe, expect, it } from 'vitest';
import { OBSERVATION_TYPES } from '../constants.js';
import {
  ADMIN_DEFAULT_QUESTION_SET,
  GLOBAL_QUESTION_SET,
  buildingQuestionSetId,
  questionsForObservation,
  resolveQuestionSetId,
  type QuestionSetBuilding,
} from './workProductQuestion.js';

const OHS: QuestionSetBuilding = { buildingId: 'ohs', displayName: 'High School' };
const OMS: QuestionSetBuilding = { buildingId: 'oms', displayName: 'Middle School' };
const STANDARD = OBSERVATION_TYPES.standard;

describe('resolveQuestionSetId — building Administrator', () => {
  const admin = (over: Partial<Parameters<typeof resolveQuestionSetId>[0]> = {}) =>
    resolveQuestionSetId({
      observerRole: 'administrator',
      type: STANDARD,
      teacherBuildings: [OHS],
      observerBuildingNames: ['High School'],
      setsWithQuestions: new Set(),
      ...over,
    });

  it("uses their building's set when it has questions", () => {
    expect(admin({ setsWithQuestions: new Set([buildingQuestionSetId('ohs')]) })).toEqual({
      setId: 'building-ohs',
    });
  });

  it('falls back to the admin default, then the district set', () => {
    expect(admin({ setsWithQuestions: new Set([ADMIN_DEFAULT_QUESTION_SET]) })).toEqual({
      setId: ADMIN_DEFAULT_QUESTION_SET,
    });
    expect(admin()).toEqual({ setId: GLOBAL_QUESTION_SET });
  });

  it('asks which building when two of theirs have sets, and honours the pick', () => {
    const args = {
      teacherBuildings: [OHS, OMS],
      observerBuildingNames: ['High School', 'Middle School'],
      setsWithQuestions: new Set(['building-ohs', 'building-oms']),
    };
    expect(admin(args)).toEqual({ choose: [OHS, OMS] });
    expect(admin({ ...args, chosenBuildingId: 'oms' })).toEqual({ setId: 'building-oms' });
  });

  it("ignores the teacher's other buildings that aren't the admin's", () => {
    expect(
      admin({
        teacherBuildings: [OHS, OMS],
        setsWithQuestions: new Set(['building-oms']),
      }),
    ).toEqual({ setId: GLOBAL_QUESTION_SET });
  });
});

describe('resolveQuestionSetId — Peer Evaluator', () => {
  const pe = (over: Partial<Parameters<typeof resolveQuestionSetId>[0]> = {}) =>
    resolveQuestionSetId({
      observerRole: 'peer-evaluator',
      type: STANDARD,
      teacherBuildings: [{ ...OHS, questionsAppliesTo: 'all' }],
      setsWithQuestions: new Set(['building-ohs']),
      ...over,
    });

  it("uses the teacher's building set only when it applies to all observations", () => {
    expect(pe()).toEqual({ setId: 'building-ohs' });
    expect(pe({ teacherBuildings: [{ ...OHS, questionsAppliesTo: 'admin' }] })).toEqual({
      setId: GLOBAL_QUESTION_SET,
    });
  });

  it('never uses the admin default', () => {
    expect(pe({ teacherBuildings: [OHS], setsWithQuestions: new Set(['district-admin']) })).toEqual(
      { setId: GLOBAL_QUESTION_SET },
    );
  });

  it('asks which building when several qualify', () => {
    const both = [
      { ...OHS, questionsAppliesTo: 'all' as const },
      { ...OMS, questionsAppliesTo: 'all' as const },
    ];
    const sets = new Set(['building-ohs', 'building-oms']);
    expect(pe({ teacherBuildings: both, setsWithQuestions: sets })).toEqual({ choose: both });
    expect(
      pe({ teacherBuildings: both, setsWithQuestions: sets, chosenBuildingId: 'ohs' }),
    ).toEqual({ setId: 'building-ohs' });
  });

  it('keeps Work Product and Instructional Round on the district set', () => {
    expect(pe({ type: OBSERVATION_TYPES.workProduct })).toEqual({ setId: GLOBAL_QUESTION_SET });
  });
});

describe('questionsForObservation', () => {
  const q = (id: string, type: 'standard' | 'work-product', setId?: string) => ({
    questionId: id,
    type,
    ...(setId ? { setId } : {}),
  });
  const bank = [
    q('legacy', 'standard'),
    q('g', 'standard', 'global'),
    q('b', 'standard', 'building-ohs'),
    q('wp', 'work-product'),
  ];

  it('treats questions and observations without a set as the district set', () => {
    expect(questionsForObservation(bank, { type: STANDARD }).map((x) => x.questionId)).toEqual([
      'legacy',
      'g',
    ]);
  });

  it("returns only the observation's set", () => {
    expect(
      questionsForObservation(bank, { type: STANDARD, questionSetId: 'building-ohs' }).map(
        (x) => x.questionId,
      ),
    ).toEqual(['b']);
  });
});
