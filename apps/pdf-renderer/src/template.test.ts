import { describe, expect, it } from 'vitest';
import type { Observation, Rubric } from '@ops/shared';
import { renderObservationHtml } from './template.js';

const OBSERVATION_DATE_ISO = '2026-03-05T12:00:00.000Z';

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    observationId: 'obs-1',
    observerEmail: 'observer@orono.k12.mn.us',
    observerName: 'Observer Name',
    observedEmail: 'observed@orono.k12.mn.us',
    observedName: 'Observed Name',
    observedRole: 'Teacher',
    observedYear: 1,
    observedBuildings: ['OMS'],
    status: 'draft',
    type: 'Standard',
    observationName: '',
    observationDate: new Date(OBSERVATION_DATE_ISO),
    observationData: {},
    componentNotes: {},
    componentTags: [],
    audioDriveFileIds: [],
    transcripts: {},
    driveFolderId: null,
    pdfDriveFileId: null,
    rubricSnapshot: null,
    createdAt: new Date(OBSERVATION_DATE_ISO),
    lastModifiedAt: new Date(OBSERVATION_DATE_ISO),
    finalizedAt: null,
    ...overrides,
  } as Observation;
}

function makeRubric(): Rubric {
  return {
    rubricId: 'teacher',
    displayName: 'Teacher Rubric',
    domains: [
      {
        id: '1',
        name: 'Planning and Preparation',
        components: [
          {
            id: '1a',
            title: 'Demonstrating Knowledge',
            proficiencyLevels: {
              developing: 'd',
              basic: 'b',
              proficient: 'p',
              distinguished: 'ds',
            },
            lookFors: [],
          },
        ],
      },
    ],
    createdAt: new Date(OBSERVATION_DATE_ISO),
    updatedAt: new Date(OBSERVATION_DATE_ISO),
  };
}

describe('renderObservationHtml — font embedding', () => {
  it('does not reference any remote font @import or gstatic/googleapis URL', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric: makeRubric(),
      activeComponentIds: [],
    });

    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/fonts\.googleapis\.com/i);
    expect(html).not.toMatch(/fonts\.gstatic\.com/i);
  });

  it('embeds the expected font-family rules for Lexend and Roboto', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric: makeRubric(),
      activeComponentIds: [],
    });

    expect(html).toMatch(/font-family:\s*'Lexend'/);
    expect(html).toMatch(/font-family:\s*'Roboto'/);
    expect(html).toMatch(/h1,\s*h2,\s*h3,\s*h4\s*\{\s*font-family:\s*'Lexend'/);
    expect(html).toMatch(/body\s*\{[\s\S]*?font-family:\s*'Roboto'/);
  });

  it('inlines the embedded @font-face rules read from assets/fonts-embedded.css', () => {
    const html = renderObservationHtml({
      observation: makeObservation(),
      rubric: makeRubric(),
      activeComponentIds: [],
    });

    // The embedded stylesheet declares @font-face rules with base64 data URIs
    // (no network fetch required to render fonts).
    expect(html).toMatch(/@font-face/);
    expect(html).toMatch(/data:font\/ttf;base64,/);
  });

  it('still renders a complete HTML document with observation content', () => {
    const html = renderObservationHtml({
      observation: makeObservation({ observedName: 'Jane Doe' }),
      rubric: makeRubric(),
      activeComponentIds: [],
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Jane Doe');
  });
});
