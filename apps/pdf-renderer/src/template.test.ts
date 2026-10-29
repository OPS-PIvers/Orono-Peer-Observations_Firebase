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

describe('renderObservationHtml — question responses', () => {
  const questions = [
    { questionId: 'pre-1', text: 'What are your goals?', phase: 'pre' as const },
    { questionId: 'post-1', text: 'What went well?', phase: 'post' as const },
    // Written before `phase` existed: files under Planning.
    { questionId: 'legacy', text: 'Legacy question' } as {
      questionId: string;
      text: string;
      phase: 'pre';
    },
  ];

  it('splits responses into Planning and Reflection for every type, Standard included', () => {
    const html = renderObservationHtml({
      observation: makeObservation({
        type: 'Standard',
        workProductAnswers: [
          { questionId: 'pre-1', answer: 'Factor quadratics', updatedAt: new Date() },
          { questionId: 'post-1', answer: '', updatedAt: new Date() },
        ],
      }),
      rubric: makeRubric(),
      activeComponentIds: [],
      workProductQuestions: questions,
    });
    expect(html).toContain('Planning Responses');
    expect(html).toContain('Reflection Responses');
    expect(html).not.toContain('Instructional Round Responses');
    expect(html).not.toContain('Work Product Responses');
    expect(html.indexOf('Planning Responses')).toBeLessThan(html.indexOf('Reflection Responses'));
    // Planning numbers its own questions: goals (1), legacy (2).
    expect(html).toContain('1. What are your goals?');
    expect(html).toContain('2. Legacy question');
    expect(html).toContain('1. What went well?');
    expect(html).toContain('Not answered');
  });

  it('keeps answers to deleted questions in a trailing block', () => {
    const html = renderObservationHtml({
      observation: makeObservation({
        type: 'Work Product',
        workProductAnswers: [
          { questionId: 'gone', answer: 'Still on the record', updatedAt: new Date() },
        ],
      }),
      rubric: makeRubric(),
      activeComponentIds: [],
      workProductQuestions: questions,
    });
    expect(html).toContain('Other Responses');
    expect(html).toContain('Still on the record');
    expect(html.indexOf('Reflection Responses')).toBeLessThan(html.indexOf('Other Responses'));
  });
});

describe('renderObservationHtml — script tag provenance', () => {
  it("labels spans lifted from the teacher's answers and leaves script spans bare", () => {
    const html = renderObservationHtml({
      observation: makeObservation({
        scriptDoc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Observed grouping.',
                  marks: [{ type: 'componentTag', attrs: { componentId: '1a' } }],
                },
              ],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'I group by readiness.',
                  marks: [
                    { type: 'componentTag', attrs: { componentId: '1a', source: 'planning' } },
                  ],
                },
              ],
            },
          ],
        },
      }),
      rubric: makeRubric(),
      activeComponentIds: [],
    });
    expect(html).toContain('From the teacher&#39;s Planning response');
    expect(html).toContain('I group by readiness.');
    const bare = html.indexOf('Observed grouping.');
    expect(html.slice(Math.max(0, bare - 120), bare)).not.toContain('span-source');
  });
});

describe('renderObservationHtml — component tag colours', () => {
  const POISON = '#fff;position:absolute;inset:0;background-image:url(http://attacker.example/b)';

  function render(attrs: Record<string, unknown>): string {
    return renderObservationHtml({
      observation: makeObservation({
        scriptDoc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Tagged text.',
                  marks: [{ type: 'componentTag', attrs: { componentId: '1a', ...attrs } }],
                },
              ],
            },
          ],
        },
      }),
      rubric: makeRubric(),
      activeComponentIds: [],
    });
  }

  /** Every inline style on a <mark>, from both the script body and the
   *  "From script" list. */
  function markStyles(html: string): string[] {
    return [...html.matchAll(/<mark[^>]*style="([^"]*)"/g)].map((m) =>
      (m[1] ?? '').replace(/\s+/g, '').replace(/;$/, ''),
    );
  }

  it('keeps strict #RRGGBB colours', () => {
    const styles = markStyles(render({ bg: '#dbeafe', fg: '#1e3a8a' }));
    expect(styles.length).toBeGreaterThanOrEqual(2);
    for (const style of styles) expect(style).toBe('background-color:#dbeafe;color:#1e3a8a');
  });

  it('drops bg/fg that carry extra CSS', () => {
    const html = render({ bg: POISON, fg: `#000;${POISON}` });
    expect(html).not.toContain('attacker.example');
    expect(html).not.toContain('position:absolute');
    const styles = markStyles(html);
    expect(styles.length).toBeGreaterThanOrEqual(1);
    for (const style of styles) {
      expect(style).toMatch(/^background-color:#[0-9a-fA-F]{6};color:#[0-9a-fA-F]{6}$/);
    }
  });

  it('drops non-string and non-hex colour values', () => {
    for (const bad of [{ r: 1 }, 123, 'red', '#fff', 'rgb(0,0,0)', '#dbeafe ']) {
      const html = render({ bg: bad, fg: bad });
      for (const style of markStyles(html)) {
        expect(style).toMatch(/^background-color:#[0-9a-fA-F]{6};color:#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
