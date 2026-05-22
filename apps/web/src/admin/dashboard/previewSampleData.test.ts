import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS } from '@ops/shared';
import { buildSampleCheckpoints } from './previewSampleData';

describe('buildSampleCheckpoints', () => {
  it('renders multiple seed cards for the representative sample staff member', () => {
    const cards = buildSampleCheckpoints(DEFAULT_STEPS);
    expect(cards.length).toBeGreaterThan(2);
    // disabling a step removes its card
    const fewer = buildSampleCheckpoints(
      DEFAULT_STEPS.map((s) => (s.id === 'preObs' ? { ...s, enabled: false } : s)),
    );
    expect(fewer.find((c) => c.id === 'preObs')).toBeUndefined();
  });
});
