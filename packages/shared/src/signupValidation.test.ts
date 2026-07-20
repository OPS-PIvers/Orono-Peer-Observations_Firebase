import { describe, expect, it } from 'vitest';
import {
  BEFORE_AFTER_VALUES,
  isSelectFieldMisconfigured,
  validateSignupAnswers,
} from './signupValidation.js';
import type { SignupField } from './schema/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<SignupField>): SignupField {
  return {
    fieldId: 'f-test',
    label: 'Test field',
    type: 'select',
    options: ['Option A', 'Option B'],
    appliesTo: 'both',
    required: false,
    order: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const BASE_SELECT = makeField({});
const REQUIRED_SELECT = makeField({ required: true });
const BEFORE_AFTER_FIELD = makeField({ fieldId: 'f-ba', type: 'before-after', options: [] });
const PERIOD_PICKER_FIELD = makeField({
  fieldId: 'f-pp',
  type: 'period-picker',
  options: [],
  required: false,
});
const INACTIVE_REQUIRED = makeField({ fieldId: 'f-off', isActive: false, required: true });
const DIRECT_ONLY = makeField({
  fieldId: 'f-direct',
  appliesTo: 'direct',
  required: true,
  options: ['X'],
});
const DAY_PREF_ONLY = makeField({
  fieldId: 'f-dp',
  appliesTo: 'day-preference',
  required: true,
  options: ['Y'],
});

// ---------------------------------------------------------------------------
// validateSignupAnswers
// ---------------------------------------------------------------------------

describe('validateSignupAnswers — required fields', () => {
  it('returns no errors when all required fields have answers', () => {
    const errs = validateSignupAnswers([REQUIRED_SELECT], 'direct', [
      { fieldId: 'f-test', value: 'Option A' },
    ]);
    expect(errs).toHaveLength(0);
  });

  it('returns an error when a required field is omitted', () => {
    const errs = validateSignupAnswers([REQUIRED_SELECT], 'direct', []);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.fieldId).toBe('f-test');
    expect(errs[0]?.message).toMatch(/required/i);
  });

  it('returns an error when a required field has an empty-string answer', () => {
    const errs = validateSignupAnswers([REQUIRED_SELECT], 'direct', [
      { fieldId: 'f-test', value: '' },
    ]);
    expect(errs).toHaveLength(1);
  });

  it('returns an error when a required field has a whitespace-only answer', () => {
    const errs = validateSignupAnswers([REQUIRED_SELECT], 'direct', [
      { fieldId: 'f-test', value: '   ' },
    ]);
    expect(errs).toHaveLength(1);
  });

  it('ignores inactive fields even if required', () => {
    const errs = validateSignupAnswers([INACTIVE_REQUIRED], 'direct', []);
    expect(errs).toHaveLength(0);
  });

  it('ignores fields whose appliesTo does not match the mode', () => {
    // DAY_PREF_ONLY is required but mode is 'direct'
    const errs = validateSignupAnswers([DAY_PREF_ONLY], 'direct', []);
    expect(errs).toHaveLength(0);
  });

  it('enforces a direct-only required field in direct mode', () => {
    const errs = validateSignupAnswers([DIRECT_ONLY], 'direct', []);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.fieldId).toBe('f-direct');
  });

  it('enforces a day-preference required field in day-preference mode', () => {
    const errs = validateSignupAnswers([DAY_PREF_ONLY], 'day-preference', []);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.fieldId).toBe('f-dp');
  });
});

describe('validateSignupAnswers — select field type validation', () => {
  it('passes when the answer is one of the field options', () => {
    const errs = validateSignupAnswers([BASE_SELECT], 'direct', [
      { fieldId: 'f-test', value: 'Option A' },
    ]);
    expect(errs).toHaveLength(0);
  });

  it('returns an error when the answer is not in the options list', () => {
    const errs = validateSignupAnswers([BASE_SELECT], 'direct', [
      { fieldId: 'f-test', value: 'Not an option' },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/not a valid option/i);
  });

  it('skips type check when optional select is left blank', () => {
    const errs = validateSignupAnswers([BASE_SELECT], 'direct', []);
    expect(errs).toHaveLength(0);
  });
});

describe('validateSignupAnswers — before-after field type validation', () => {
  it('passes for "Before school"', () => {
    const errs = validateSignupAnswers([BEFORE_AFTER_FIELD], 'direct', [
      { fieldId: 'f-ba', value: 'Before school' },
    ]);
    expect(errs).toHaveLength(0);
  });

  it('passes for "After school"', () => {
    const errs = validateSignupAnswers([BEFORE_AFTER_FIELD], 'direct', [
      { fieldId: 'f-ba', value: 'After school' },
    ]);
    expect(errs).toHaveLength(0);
  });

  it('returns an error for an arbitrary string', () => {
    const errs = validateSignupAnswers([BEFORE_AFTER_FIELD], 'direct', [
      { fieldId: 'f-ba', value: 'During school' },
    ]);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.message).toMatch(/Before school.*After school/);
  });

  it('BEFORE_AFTER_VALUES export contains exactly the two legal values', () => {
    expect(BEFORE_AFTER_VALUES).toContain('Before school');
    expect(BEFORE_AFTER_VALUES).toContain('After school');
    expect(BEFORE_AFTER_VALUES).toHaveLength(2);
  });
});

describe('validateSignupAnswers — period-picker field', () => {
  it('passes any non-empty string (no server-side period name check)', () => {
    const field = makeField({ ...PERIOD_PICKER_FIELD, required: true });
    const errs = validateSignupAnswers([field], 'direct', [{ fieldId: 'f-pp', value: 'Period 2' }]);
    expect(errs).toHaveLength(0);
  });

  it('fails when required and left blank', () => {
    const field = makeField({ ...PERIOD_PICKER_FIELD, required: true });
    const errs = validateSignupAnswers([field], 'direct', []);
    expect(errs).toHaveLength(1);
  });
});

describe('validateSignupAnswers — multiple fields', () => {
  it('accumulates errors from several fields', () => {
    const req1 = makeField({ fieldId: 'f-1', label: 'Field 1', required: true });
    const req2 = makeField({ fieldId: 'f-2', label: 'Field 2', required: true });
    const errs = validateSignupAnswers([req1, req2], 'direct', []);
    expect(errs).toHaveLength(2);
  });

  it('returns no errors for mixed required/optional when required is answered', () => {
    const req = makeField({ fieldId: 'f-req', required: true });
    const opt = makeField({ fieldId: 'f-opt', required: false });
    const errs = validateSignupAnswers([req, opt], 'direct', [
      { fieldId: 'f-req', value: 'Option A' },
    ]);
    expect(errs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isSelectFieldMisconfigured
// ---------------------------------------------------------------------------

describe('isSelectFieldMisconfigured', () => {
  it('returns true for active required select with no options', () => {
    const field = makeField({ type: 'select', isActive: true, required: true, options: [] });
    expect(isSelectFieldMisconfigured(field)).toBe(true);
  });

  it('returns false when the select has at least one option', () => {
    const field = makeField({ type: 'select', isActive: true, required: true, options: ['A'] });
    expect(isSelectFieldMisconfigured(field)).toBe(false);
  });

  it('returns false when the field is inactive', () => {
    const field = makeField({ type: 'select', isActive: false, required: true, options: [] });
    expect(isSelectFieldMisconfigured(field)).toBe(false);
  });

  it('returns false when the field is not required', () => {
    const field = makeField({ type: 'select', isActive: true, required: false, options: [] });
    expect(isSelectFieldMisconfigured(field)).toBe(false);
  });

  it('returns false for non-select types', () => {
    const beforeAfter = makeField({
      type: 'before-after',
      isActive: true,
      required: true,
      options: [],
    });
    expect(isSelectFieldMisconfigured(beforeAfter)).toBe(false);

    const picker = makeField({
      type: 'period-picker',
      isActive: true,
      required: true,
      options: [],
    });
    expect(isSelectFieldMisconfigured(picker)).toBe(false);
  });
});
