import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCRIPT_AUTO_TAG_CONTROLS,
  DEFAULT_SCRIPT_AUTO_TAG_OPTIONS,
  clampScriptAutoTagOptions,
  resolveScriptAutoTagControls,
  autoTagUsesFullRubric,
  parseAutoTagConfidence,
  parseScriptAutoTagOptions,
} from './scriptAutoTagOptions.js';

describe('parseScriptAutoTagOptions', () => {
  it('returns the defaults for missing or malformed input', () => {
    expect(parseScriptAutoTagOptions(undefined)).toEqual(DEFAULT_SCRIPT_AUTO_TAG_OPTIONS);
    expect(parseScriptAutoTagOptions('thorough')).toEqual(DEFAULT_SCRIPT_AUTO_TAG_OPTIONS);
    expect(
      parseScriptAutoTagOptions({ components: 'everything', detail: 9, rationale: 'yes' }),
    ).toEqual(DEFAULT_SCRIPT_AUTO_TAG_OPTIONS);
  });

  it('keeps valid fields and fills the rest', () => {
    expect(parseScriptAutoTagOptions({ detail: 'thorough', rationale: false })).toEqual({
      components: 'assigned',
      detail: 'thorough',
      rationale: false,
    });
  });

  it('uses the fallback focus when none is sent', () => {
    expect(parseScriptAutoTagOptions({}, 'full').components).toBe('full');
    expect(parseScriptAutoTagOptions({ components: 'preferAssigned' }, 'full').components).toBe(
      'preferAssigned',
    );
  });
});

describe('autoTagUsesFullRubric', () => {
  it('is true for both full-rubric focuses', () => {
    expect(autoTagUsesFullRubric('assigned')).toBe(false);
    expect(autoTagUsesFullRubric('preferAssigned')).toBe(true);
    expect(autoTagUsesFullRubric('full')).toBe(true);
  });
});

describe('parseAutoTagConfidence', () => {
  it('maps unknown values to medium', () => {
    expect(parseAutoTagConfidence('high')).toBe('high');
    expect(parseAutoTagConfidence('certain')).toBe('medium');
    expect(parseAutoTagConfidence(undefined)).toBe('medium');
  });
});

describe('resolveScriptAutoTagControls', () => {
  it('turns everything on when nothing is stored', () => {
    expect(resolveScriptAutoTagControls(undefined)).toEqual(DEFAULT_SCRIPT_AUTO_TAG_CONTROLS);
  });

  it('keeps stored switches and fills the rest', () => {
    const c = resolveScriptAutoTagControls({ components: { full: false }, rerun: false });
    expect(c.components).toEqual({ assigned: true, preferAssigned: true, full: false });
    expect(c.rerun).toBe(false);
    expect(c.confidence).toBe(true);
  });

  it('never leaves every focus or detail level off', () => {
    const c = resolveScriptAutoTagControls({
      components: { assigned: false, preferAssigned: false, full: false },
      detail: { key: false, balanced: false, thorough: false },
    });
    expect(c.components.assigned).toBe(true);
    expect(c.detail.balanced).toBe(true);
  });
});

describe('clampScriptAutoTagOptions', () => {
  it('moves a turned-off choice to the nearest allowed one', () => {
    const controls = resolveScriptAutoTagControls({
      components: { full: false },
      detail: { thorough: false },
      rationale: false,
    });
    expect(
      clampScriptAutoTagOptions(
        { components: 'full', detail: 'thorough', rationale: true },
        controls,
      ),
    ).toEqual({ components: 'preferAssigned', detail: 'balanced', rationale: false });
  });

  it('leaves allowed choices alone', () => {
    const options = { components: 'assigned', detail: 'key', rationale: true } as const;
    expect(clampScriptAutoTagOptions(options, DEFAULT_SCRIPT_AUTO_TAG_CONTROLS)).toEqual(options);
  });
});
