import { describe, expect, it } from 'vitest';
import type {
  Observation,
  ObservationRubricSnapshot,
  RubricComponent,
  RubricDomain,
} from '@ops/shared';
import { computeGrowthTrend } from './growthTrend';

const EMPTY_PROFICIENCIES = {
  developing: '',
  basic: '',
  proficient: '',
  distinguished: '',
};

function component(id: string, title: string): RubricComponent {
  return { id, title, proficiencyLevels: EMPTY_PROFICIENCIES, lookFors: [] };
}

function domain(id: string, name: string, components: RubricComponent[]): RubricDomain {
  return { id, name, components };
}

const DOMAIN_1 = domain('1', 'Planning and Preparation', [
  component('1a', 'Demonstrating Knowledge'),
  component('1b', 'Demonstrating Knowledge of Students'),
]);
const DOMAIN_2 = domain('2', 'Classroom Environment', [component('2c', 'Managing Procedures')]);

function snapshot(
  domains: RubricDomain[],
  overrides: Partial<Pick<ObservationRubricSnapshot, 'rubricId' | 'displayName'>> = {},
): ObservationRubricSnapshot {
  return {
    rubricId: 'teacher',
    displayName: 'Teacher Rubric',
    domains,
    assignedComponentIds: domains.flatMap((d) => d.components.map((c) => c.id)),
    capturedAt: new Date('2025-09-01'),
    ...overrides,
  };
}

function makeObservation(
  overrides: Partial<Observation> & { id: string },
): Observation & { id: string } {
  const { id, ...rest } = overrides;
  return {
    observationId: id,
    observerEmail: 'observer@orono.k12.mn.us',
    observerName: 'Observer Name',
    observedEmail: 'staff@orono.k12.mn.us',
    observedName: 'Staff Name',
    observedRole: 'teacher',
    observedYear: 1,
    observedBuildings: [],
    status: 'Finalized',
    type: 'Standard',
    observationName: '',
    observationDate: new Date('2025-10-01'),
    observationData: {},
    componentNotes: {},
    scriptDoc: undefined,
    componentTags: [],
    audioDriveFileIds: [],
    transcripts: {},
    driveFolderId: null,
    pdfDriveFileId: null,
    rubricSnapshot: null,
    createdAt: new Date('2025-10-01'),
    lastModifiedAt: new Date('2025-10-01'),
    finalizedAt: new Date('2025-10-02'),
    acknowledgedAt: null,
    windowId: null,
    slotId: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    gcalEventIds: {},
    signupDetails: [],
    id,
    ...rest,
  };
}

describe('computeGrowthTrend', () => {
  it('returns no series when there are no finalized observations', () => {
    const draft = makeObservation({
      id: 'o1',
      status: 'Draft',
      rubricSnapshot: snapshot([DOMAIN_1]),
    });
    expect(computeGrowthTrend([draft])).toEqual([]);
  });

  it('skips finalized observations with no rubric snapshot (legacy docs)', () => {
    const obs = makeObservation({ id: 'o1', status: 'Finalized', rubricSnapshot: null });
    expect(computeGrowthTrend([obs])).toEqual([]);
  });

  it('skips finalized observations with an unparseable date', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationDate: 'not-a-date' as unknown as Date,
    });
    expect(computeGrowthTrend([obs])).toEqual([]);
  });

  it('averages proficiency indices per domain, one point per observation', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1, DOMAIN_2]),
      observationDate: new Date('2025-10-01'),
      observationData: {
        '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
        '1b': { proficiency: 'distinguished', selectedLookForIds: [], scratchNotes: '' },
        '2c': { proficiency: 'developing', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    const result = computeGrowthTrend([obs]);

    expect(result).toHaveLength(2);
    const d1 = result.find((s) => s.domainId === '1');
    const d2 = result.find((s) => s.domainId === '2');
    // basic(1) + distinguished(3) / 2 = 2
    expect(d1?.points).toEqual([
      {
        observationId: 'o1',
        observationName: 'Untitled observation',
        date: new Date('2025-10-01'),
        average: 2,
        scoredCount: 2,
        totalCount: 2,
      },
    ]);
    // developing(0) / 1 = 0
    expect(d2?.points[0]?.average).toBe(0);
  });

  it('omits a domain from an observation entirely unscored (never plots a false 0)', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1, DOMAIN_2]),
      observationData: {
        '1a': { proficiency: 'proficient', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    const result = computeGrowthTrend([obs]);

    expect(result).toHaveLength(1);
    expect(result[0]?.domainId).toBe('1');
  });

  it('treats an explicit null proficiency as unscored', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationData: {
        '1a': { proficiency: null, selectedLookForIds: [], scratchNotes: '' },
        '1b': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    const result = computeGrowthTrend([obs]);

    expect(result[0]?.points[0]).toMatchObject({ average: 1, scoredCount: 1, totalCount: 2 });
  });

  it('falls back to an empty observationData map when the field is missing (raw-read tolerance)', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
    });
    // Simulate a raw Firestore read where the field was never written.
    // @ts-expect-error -- deliberately testing the undefined-field fallback path
    delete obs.observationData;

    expect(computeGrowthTrend([obs])).toEqual([]);
  });

  it('sorts points chronologically across multiple observations, oldest first', () => {
    const older = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationDate: new Date('2025-09-01'),
      observationData: {
        '1a': { proficiency: 'developing', selectedLookForIds: [], scratchNotes: '' },
      },
    });
    const newer = makeObservation({
      id: 'o2',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationDate: new Date('2026-01-15'),
      observationData: {
        '1a': { proficiency: 'distinguished', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    // Passed in reverse order to prove the function sorts, not just passes through.
    const result = computeGrowthTrend([newer, older]);

    expect(result[0]?.points.map((p) => p.observationId)).toEqual(['o1', 'o2']);
  });

  it('keeps a stable domain identity across a mid-year rubric edit that renames a domain', () => {
    const renamedDomain: RubricDomain = { ...DOMAIN_1, name: 'Planning and Prep (renamed)' };
    const older = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationDate: new Date('2025-09-01'),
      observationData: { '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' } },
    });
    const newer = makeObservation({
      id: 'o2',
      status: 'Finalized',
      rubricSnapshot: snapshot([renamedDomain]),
      observationDate: new Date('2026-01-01'),
      observationData: {
        '1a': { proficiency: 'proficient', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    const result = computeGrowthTrend([older, newer]);

    expect(result).toHaveLength(1);
    expect(result[0]?.points).toHaveLength(2);
    // Latest snapshot's name wins for display.
    expect(result[0]?.domainName).toBe('Planning and Prep (renamed)');
  });

  it('keeps two rubrics that share a domain id as separate series, never averaged together', () => {
    // Reproduces a staff member observed under two different rubrics (e.g.
    // after a role change) where both rubrics number their first domain
    // '1' per the framework convention, but the domains measure completely
    // different things. Without a rubric-aware key these would silently
    // merge into one misleading trend line.
    const rubricADomain1 = domain('1', 'Planning and Preparation', [
      component('1a', 'Demonstrating Knowledge'),
    ]);
    const rubricBDomain1 = domain('1', 'Support Service Delivery', [
      component('1a', 'Delivering Services'),
    ]);

    const underRubricA = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([rubricADomain1], {
        rubricId: 'teacher',
        displayName: 'Teacher Rubric',
      }),
      observationDate: new Date('2025-09-01'),
      observationData: {
        '1a': { proficiency: 'developing', selectedLookForIds: [], scratchNotes: '' },
      },
    });
    const underRubricB = makeObservation({
      id: 'o2',
      status: 'Finalized',
      rubricSnapshot: snapshot([rubricBDomain1], {
        rubricId: 'school-counselor',
        displayName: 'School Counselor Rubric',
      }),
      observationDate: new Date('2026-01-15'),
      observationData: {
        '1a': { proficiency: 'distinguished', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    const result = computeGrowthTrend([underRubricA, underRubricB]);

    // Two independent series, not one merged/averaged series.
    expect(result).toHaveLength(2);
    const seriesA = result.find((s) => s.rubricId === 'teacher');
    const seriesB = result.find((s) => s.rubricId === 'school-counselor');
    expect(seriesA?.domainId).toBe('1');
    expect(seriesA?.domainName).toBe('Planning and Preparation');
    expect(seriesA?.points).toHaveLength(1);
    expect(seriesA?.points[0]?.average).toBe(0);
    expect(seriesB?.domainId).toBe('1');
    expect(seriesB?.domainName).toBe('Support Service Delivery');
    expect(seriesB?.points).toHaveLength(1);
    expect(seriesB?.points[0]?.average).toBe(3);
  });

  it('skips a component whose recorded proficiency is not one of the four canonical levels, instead of corrupting the average with indexOf === -1', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationData: {
        // Simulates corrupted / pre-migration raw Firestore data that
        // bypassed Zod validation on write.
        '1a': {
          proficiency: 'expert' as unknown as null,
          selectedLookForIds: [],
          scratchNotes: '',
        },
        '1b': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
      },
    });

    const result = computeGrowthTrend([obs]);

    expect(result).toHaveLength(1);
    // Only '1b' (basic = 1) is scored; '1a' is skipped entirely rather than
    // contributing indexOf(-1) to the sum.
    expect(result[0]?.points[0]).toMatchObject({ average: 1, scoredCount: 1, totalCount: 2 });
  });

  it('omits a domain whose only recorded proficiency is unrecognized, and never emits NaN', () => {
    const obs = makeObservation({
      id: 'o1',
      status: 'Finalized',
      rubricSnapshot: snapshot([DOMAIN_1]),
      observationData: {
        '1a': {
          proficiency: 'expert' as unknown as null,
          selectedLookForIds: [],
          scratchNotes: '',
        },
      },
    });

    const result = computeGrowthTrend([obs]);

    expect(result).toEqual([]);
  });
});
