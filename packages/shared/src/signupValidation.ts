/**
 * Server-side (and client-mirrored) validation for signup-field answers.
 *
 * `validateSignupAnswers` is a pure function with no Firestore dependency; it
 * is called by both Cloud Functions callables (after they load the field docs)
 * and by the web client (to keep client and server error messages in sync).
 *
 * Rules enforced:
 *   1. Every active field that applies to the booking mode AND is `required`
 *      must have a non-empty trimmed answer.
 *   2. A `select` field's answer must be one of the field's `options` (or
 *      empty if not required).
 *   3. A `before-after` field's answer must be one of the two fixed constants
 *      (or empty if not required).
 *   4. (No constraint on `period-picker` values — they come from the
 *      building schedule which the function does not load at this point;
 *      the non-empty required check covers the essential gate.)
 */

import type { BookingMode, SignupField, SignupFieldAnswer } from './schema/index.js';

/** The two legal values for a `before-after` signup field. */
export const BEFORE_AFTER_VALUES = ['Before school', 'After school'] as const;
export type BeforeAfterValue = (typeof BEFORE_AFTER_VALUES)[number];

/** A single validation failure. */
export interface SignupAnswerError {
  fieldId: string;
  label: string;
  message: string;
}

/**
 * Validate detail answers against the fields configured for a booking window.
 *
 * @param allSelectedFields  The `SignupField` documents for the ids in
 *   `window.signupFieldIds` — loaded by the caller from Firestore.
 * @param mode               The booking mode ('direct' | 'day-preference').
 * @param answers            The `detailAnswers` array from the callable input
 *   (or an empty array if none were submitted).
 * @returns An array of errors. An empty array means the answers are valid.
 */
export function validateSignupAnswers(
  allSelectedFields: readonly SignupField[],
  mode: BookingMode,
  answers: readonly Pick<SignupFieldAnswer, 'fieldId' | 'value'>[],
): SignupAnswerError[] {
  const answerMap = new Map<string, string>(answers.map((a) => [a.fieldId, a.value.trim()]));

  const errors: SignupAnswerError[] = [];

  for (const field of allSelectedFields) {
    // Only validate active fields that apply to this booking mode.
    if (!field.isActive) continue;
    if (field.appliesTo !== 'both' && field.appliesTo !== mode) continue;

    const value = answerMap.get(field.fieldId) ?? '';

    // Rule 1 — required fields must not be empty.
    if (field.required && value === '') {
      errors.push({
        fieldId: field.fieldId,
        label: field.label,
        message: `"${field.label}" is required.`,
      });
      // Skip type checks on an empty value (would produce redundant errors).
      continue;
    }

    // Skip type-specific checks when the field is optional and left blank.
    if (value === '') continue;

    // Rule 2 — select answers must be one of the configured options.
    if (field.type === 'select') {
      if (!field.options.includes(value)) {
        errors.push({
          fieldId: field.fieldId,
          label: field.label,
          message: `"${value}" is not a valid option for "${field.label}".`,
        });
      }
      continue;
    }

    // Rule 3 — before-after answers must be one of the two fixed constants.
    if (field.type === 'before-after') {
      const legal: readonly string[] = BEFORE_AFTER_VALUES;
      if (!legal.includes(value)) {
        errors.push({
          fieldId: field.fieldId,
          label: field.label,
          message: `"${value}" is not a valid value for "${field.label}". Expected "Before school" or "After school".`,
        });
      }
    }

    // 'period-picker' — only the required/non-empty check above applies.
  }

  return errors;
}

/**
 * True when an active, required `select` field has no options configured.
 *
 * Such a field makes any booking form using it impossible to complete
 * (there's no valid answer). Used by the admin Sign-up Fields page to
 * surface a warning badge.
 */
export function isSelectFieldMisconfigured(field: SignupField): boolean {
  return field.type === 'select' && field.isActive && field.required && field.options.length === 0;
}
