import { describe, expect, it } from 'vitest';
import { OBSERVATION_STATUS, OBSERVATION_TYPES, type Observation, type Rubric } from '@ops/shared';
import { renderObservationHtml } from './template.js';

/**
 * The renderer receives its payload over HTTP, so date fields can arrive in
 * several shapes: ISO strings (the normalized finalizeObservation payload),
 * `{_seconds,_nanoseconds}` / `{seconds,nanoseconds}` blobs (what an Admin
 * SDK Timestamp degrades to under JSON serialization), live Timestamps
 * (`{toDate()}`), or real Dates. Every shape must render as a real date —
 * the regression here was every PDF printing "—" for both dates.
 */

const OBSERVATION_DATE_ISO = '2026-03-05T12:00:00.000Z';
const FINALIZED_DATE_ISO = '2026-03-06T12:00:00.000Z';
// Noon UTC keeps the local calendar date stable for any sane server TZ.
const OBSERVATION_DATE_ROW = '<dt>Observation date</dt><dd>March 5, 2026</dd>';
const FINALIZED_DATE_ROW = '<dt>Finalized</dt><dd>March 6, 2026</dd>';
const EM_DASH_DATE_ROW = '<dt>Observation date</dt><dd>—</dd>';

/** Cast an arbitrary wire shape into the `Date`-typed field slot. */
function asDate(value: unknown): Date {
  return value as Date;
}

function timestampBlob(iso: string): { _seconds: number; _nanoseconds: number } {
  return { _seconds: Math.floor(Date.parse(iso) / 1000), _nanoseconds: 0 };
}

const rubric: Rubric = {
  rubricId: 'teacher-rubric',
  displayName: 'Teacher Rubric',
  domains: [
    {
      id: '1',
      name: 'Planning and Preparation',
      components: [
        {
          id: '1a',
          title: 'Demonstrating Knowledge of Content and Pedagogy',
          proficiencyLevels: {
            developing: 'Developing descriptor',
            basic: 'Basic descriptor',
            proficient: 'Proficient descriptor',
            distinguished: 'Distinguished descriptor',
          },
          lookFors: [],
        },
      ],
    },
  ],
  createdAt: new Date('2025-08-01T12:00:00.000Z'),
  updatedAt: new Date('2025-08-01T12:00:00.000Z'),
};

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    observationId: 'obs1',
    observerEmail: 'pe@orono.k12.mn.us',
    observerName: 'Pat Evaluator',
    observedEmail: 'teacher@orono.k12.mn.us',
    observedName: 'Terry Teacher',
    observedRole: 'Teacher',
    observedYear: 1,
    observedBuildings: ['Middle School'],
    status: OBSERVATION_STATUS.finalized,
    type: OBSERVATION_TYPES.standard,
    observationName: '',
    observationDate: new Date(OBSERVATION_DATE_ISO),
    observationData: {},
    componentNotes: {},
    componentTags: [],
    audioDriveFileIds: [],
    transcripts: {},
    driveFolderId: null,
    pdfDriveFileId: null,
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    lastModifiedAt: new Date(OBSERVATION_DATE_ISO),
    finalizedAt: null,
    acknowledgedAt: null,
    windowId: null,
    slotId: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    gcalEventIds: {},
    signupDetails: [],
    ...overrides,
  };
}

function render(overrides: Partial<Observation> = {}): string {
  // Pass null (no mapping doc) so the helper renders all rubric components —
  // we only want to exercise the date/header rows, not component visibility.
  return renderObservationHtml({
    observation: makeObservation(overrides),
    rubric,
    activeComponentIds: null,
  });
}

describe('renderObservationHtml date formatting', () => {
  it('renders a real Date', () => {
    expect(render()).toContain(OBSERVATION_DATE_ROW);
  });

  it('renders an ISO string (the normalized finalizeObservation payload)', () => {
    const html = render({ observationDate: asDate(OBSERVATION_DATE_ISO) });
    expect(html).toContain(OBSERVATION_DATE_ROW);
  });

  it('renders a JSON-serialized Admin Timestamp ({_seconds,_nanoseconds})', () => {
    const html = render({ observationDate: asDate(timestampBlob(OBSERVATION_DATE_ISO)) });
    expect(html).toContain(OBSERVATION_DATE_ROW);
  });

  it('renders a {seconds,nanoseconds} timestamp shape', () => {
    const html = render({
      observationDate: asDate({
        seconds: Math.floor(Date.parse(OBSERVATION_DATE_ISO) / 1000),
        nanoseconds: 0,
      }),
    });
    expect(html).toContain(OBSERVATION_DATE_ROW);
  });

  it('renders a live Firestore Timestamp via toDate()', () => {
    const html = render({
      observationDate: asDate({ toDate: () => new Date(OBSERVATION_DATE_ISO) }),
    });
    expect(html).toContain(OBSERVATION_DATE_ROW);
  });

  it('falls back to an em dash for missing or unparseable dates', () => {
    expect(render({ observationDate: asDate(undefined) })).toContain(EM_DASH_DATE_ROW);
    expect(render({ observationDate: asDate('not-a-date') })).toContain(EM_DASH_DATE_ROW);
    expect(render({ observationDate: asDate({}) })).toContain(EM_DASH_DATE_ROW);
  });
});

describe('renderObservationHtml finalized row', () => {
  it('omits the Finalized row when finalizedAt is null', () => {
    expect(render()).not.toContain('<dt>Finalized</dt>');
  });

  it('renders the Finalized row from an ISO string', () => {
    const html = render({ finalizedAt: asDate(FINALIZED_DATE_ISO) });
    expect(html).toContain(FINALIZED_DATE_ROW);
  });

  it('renders the Finalized row from a JSON-serialized Admin Timestamp', () => {
    const html = render({ finalizedAt: asDate(timestampBlob(FINALIZED_DATE_ISO)) });
    expect(html).toContain(FINALIZED_DATE_ROW);
  });
});

/**
 * Tests for the consistent null / [] semantics of activeComponentIds:
 *   null  → no mapping document exists → render every rubric component
 *   []    → mapping exists, nothing assigned → render the empty-state message
 *   [ids] → render only the listed component IDs
 */
describe('renderObservationHtml activeComponentIds semantics', () => {
  const COMPONENT_HEADING = 'Demonstrating Knowledge of Content and Pedagogy';
  const EMPTY_STATE_MSG = 'No components are assigned for this role/year combination.';

  it('null: renders all rubric components when no mapping doc exists', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric,
      activeComponentIds: null,
    });
    expect(html).toContain(COMPONENT_HEADING);
    expect(html).not.toContain(EMPTY_STATE_MSG);
  });

  it('empty array: renders the empty-state message when mapping exists with no IDs', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric,
      activeComponentIds: [],
    });
    expect(html).toContain(EMPTY_STATE_MSG);
    expect(html).not.toContain(COMPONENT_HEADING);
  });

  it('matching IDs: renders only the listed components', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric,
      activeComponentIds: ['1a'],
    });
    expect(html).toContain(COMPONENT_HEADING);
    expect(html).not.toContain(EMPTY_STATE_MSG);
  });

  it('non-matching IDs: renders the empty-state message when no rubric component matches', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric,
      activeComponentIds: ['99z'],
    });
    expect(html).toContain(EMPTY_STATE_MSG);
    expect(html).not.toContain(COMPONENT_HEADING);
  });
});
