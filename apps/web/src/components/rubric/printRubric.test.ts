import { describe, expect, it } from 'vitest';
import type { Rubric } from '@ops/shared';
import { buildRubricPrintHtml } from './printRubric';

const levels = {
  developing: 'dev text',
  basic: 'basic text',
  proficient: 'prof text',
  distinguished: 'dist text',
};

const rubric: Rubric = {
  rubricId: 'teacher',
  displayName: 'Teacher Rubric',
  createdAt: new Date(),
  updatedAt: new Date(),
  domains: [
    {
      id: '1',
      name: 'Planning & Preparation',
      components: [
        {
          id: '1a',
          title: 'Content <Knowledge>',
          proficiencyLevels: levels,
          lookFors: [{ id: 'lf1', text: 'Uses accurate terms' }],
        },
        { id: '1b', title: 'Knowing Students', proficiencyLevels: levels, lookFors: [] },
      ],
    },
    {
      id: '2',
      name: 'Environment',
      components: [{ id: '2a', title: 'Respect', proficiencyLevels: levels, lookFors: [] }],
    },
  ],
};

const base = {
  rubric,
  assignedComponentIds: new Set(['1a']),
  title: 'Classroom Teacher · Year 1',
  appName: 'Orono Peer Observations',
  primaryColor: '#2d3f89',
};

describe('buildRubricPrintHtml', () => {
  it('prints only assigned components and drops empty domains', () => {
    const html = buildRubricPrintHtml({ ...base, scope: 'assigned' });
    expect(html).toContain('1a');
    expect(html).not.toContain('Knowing Students');
    expect(html).not.toContain('Domain 2');
    expect(html).toContain('Uses accurate terms');
    expect(html).toContain('Assigned components');
  });

  it('prints every component in full mode and tags the assigned ones', () => {
    const html = buildRubricPrintHtml({ ...base, scope: 'full' });
    expect(html).toContain('Knowing Students');
    expect(html).toContain('Domain 2: Environment');
    expect(html.match(/class="tag"/g)).toHaveLength(1);
  });

  it('escapes rubric text', () => {
    const html = buildRubricPrintHtml({ ...base, scope: 'full', subtitle: 'A & B' });
    expect(html).toContain('Content &lt;Knowledge&gt;');
    expect(html).toContain('Planning &amp; Preparation');
    expect(html).toContain('A &amp; B');
  });

  it('falls back to the default color for an invalid brand color', () => {
    const html = buildRubricPrintHtml({ ...base, scope: 'full', primaryColor: 'red;}' });
    expect(html).not.toContain('red;}');
  });
});
