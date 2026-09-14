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

  it('previews a manual step as checked off once its event has happened in the sample', () => {
    const manual = DEFAULT_STEPS.map((s) =>
      s.id === 'preObs' || s.id === 'observation' ? { ...s, completionMode: 'manual' as const } : s,
    );
    const cards = buildSampleCheckpoints(manual);
    // The sample's pre-observation date has passed: shown as checked.
    const planning = cards.find((c) => c.id === 'preObs');
    expect(planning?.status).toBe('done');
    expect(planning?.checkedByName).toBe('Sam Lee');
    // The observation date is still ahead: not checked.
    expect(cards.find((c) => c.id === 'observation')?.status).not.toBe('done');
  });
});
