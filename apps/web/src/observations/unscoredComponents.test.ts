import { describe, expect, it } from 'vitest';
import type { RubricComponent, RubricDomain } from '@ops/shared';
import {
  computeUnscoredComponents,
  type ActiveComponent,
  type ComponentEntries,
} from './unscoredComponents';

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

const COMPONENT_1A = component('1a', 'Demonstrating Knowledge');
const COMPONENT_1B = component('1b', 'Demonstrating Knowledge of Students');
const COMPONENT_2C = component('2c', 'Managing Classroom Procedures');

const DOMAIN_1 = domain('1', 'Planning and Preparation', [COMPONENT_1A, COMPONENT_1B]);
const DOMAIN_2 = domain('2', 'Classroom Environment', [COMPONENT_2C]);

const ACTIVE: ActiveComponent[] = [
  { domain: DOMAIN_1, component: COMPONENT_1A },
  { domain: DOMAIN_1, component: COMPONENT_1B },
  { domain: DOMAIN_2, component: COMPONENT_2C },
];

describe('computeUnscoredComponents', () => {
  it('returns all active components when nothing has been scored', () => {
    const result = computeUnscoredComponents(ACTIVE, {});
    expect(result.map((ac) => ac.component.id)).toEqual(['1a', '1b', '2c']);
  });

  it('excludes components with a proficiency selected', () => {
    const entries: ComponentEntries = {
      '1a': { proficiency: 'proficient', selectedLookForIds: [], scratchNotes: '' },
    };
    const result = computeUnscoredComponents(ACTIVE, entries);
    expect(result.map((ac) => ac.component.id)).toEqual(['1b', '2c']);
  });

  it('treats an entry with proficiency explicitly null as unscored', () => {
    const entries: ComponentEntries = {
      '1a': { proficiency: null, selectedLookForIds: ['lf1'], scratchNotes: 'saw it happen' },
    };
    const result = computeUnscoredComponents(ACTIVE, entries);
    expect(result.map((ac) => ac.component.id)).toEqual(['1a', '1b', '2c']);
  });

  it('returns an empty array once every active component is scored', () => {
    const entries: ComponentEntries = {
      '1a': { proficiency: 'basic', selectedLookForIds: [], scratchNotes: '' },
      '1b': { proficiency: 'distinguished', selectedLookForIds: [], scratchNotes: '' },
      '2c': { proficiency: 'developing', selectedLookForIds: [], scratchNotes: '' },
    };
    expect(computeUnscoredComponents(ACTIVE, entries)).toEqual([]);
  });

  it('returns an empty array when there are no active components', () => {
    expect(computeUnscoredComponents([], {})).toEqual([]);
  });
});
