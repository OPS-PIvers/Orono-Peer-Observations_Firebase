import { describe, expect, it } from 'vitest';
import { componentIdsWithEvaluatorContent, resolveReportDomains } from './reportComponents.js';
import type { RubricDomain } from './schema/rubric.js';

function component(id: string) {
  return {
    id,
    title: `Component ${id}`,
    proficiencyLevels: { developing: '', basic: '', proficient: '', distinguished: '' },
    lookFors: [],
  };
}

const DOMAINS = [
  { id: '1', name: 'Planning', components: [component('1a'), component('1b'), component('1c')] },
  { id: '2', name: 'Environment', components: [component('2a'), component('2b')] },
  { id: '3', name: 'Instruction', components: [component('3a')] },
] as unknown as RubricDomain[];

const ids = (domains: RubricDomain[]) => domains.flatMap((d) => d.components.map((c) => c.id));

const entry = (over: Record<string, unknown> = {}) => ({
  proficiency: null,
  selectedLookForIds: [],
  scratchNotes: '',
  ...over,
});

const textDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});

describe('componentIdsWithEvaluatorContent', () => {
  it('counts a proficiency, look-fors or scratch notes, but not an empty entry', () => {
    const found = componentIdsWithEvaluatorContent({
      observationData: {
        '1a': entry({ proficiency: 'proficient' }),
        '1b': entry({ selectedLookForIds: ['lf-1'] }),
        '1c': entry({ scratchNotes: 'saw this' }),
        '2a': entry({ scratchNotes: '   ' }),
      },
    });
    expect([...found].sort()).toEqual(['1a', '1b', '1c']);
  });

  it('counts notes with text, evidence, and script tags', () => {
    const found = componentIdsWithEvaluatorContent({
      componentNotes: { '1a': textDoc('note'), '1b': textDoc('') },
      evidenceLinks: { '2a': [{ fileId: 'f' }], '2b': [] },
      scriptDoc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'x',
                marks: [{ type: 'componentTag', attrs: { componentId: '3a' } }],
              },
            ],
          },
        ],
      },
      componentTags: [{ id: 't', componentId: '1c', from: 0, to: 1 }],
    } as never);
    expect([...found].sort()).toEqual(['1a', '1c', '2a', '3a']);
  });
});

describe('resolveReportDomains', () => {
  it('keeps only the assigned components when nothing else was touched', () => {
    const out = resolveReportDomains(DOMAINS, ['1b', '2a'], {
      observationData: { '1b': entry({ proficiency: 'basic' }) },
    });
    expect(ids(out)).toEqual(['1b', '2a']);
    expect(out.map((d) => d.id)).toEqual(['1', '2']);
  });

  it('adds rated components outside the assignment in rubric order', () => {
    const out = resolveReportDomains(DOMAINS, ['2a'], {
      observationData: {
        '3a': entry({ proficiency: 'distinguished' }),
        '1a': entry({ proficiency: 'basic' }),
      },
      componentNotes: { '1c': textDoc('note') },
    } as never);
    expect(ids(out)).toEqual(['1a', '1c', '2a', '3a']);
  });

  it('keeps an assigned component with no rating so a gap stays visible', () => {
    const out = resolveReportDomains(DOMAINS, ['1a', '3a'], {});
    expect(ids(out)).toEqual(['1a', '3a']);
  });

  it('shows the whole rubric when no mapping narrows it', () => {
    expect(resolveReportDomains(DOMAINS, [], {})).toBe(DOMAINS);
  });

  it('falls back to the whole rubric when the selection would be empty', () => {
    expect(resolveReportDomains(DOMAINS, ['9z'], {})).toBe(DOMAINS);
  });
});
