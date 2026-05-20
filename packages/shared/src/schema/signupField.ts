import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * /signupFields/{fieldId} — admin-defined detail fields staff fill in when
 * they book a slot (Mode A) or express a day preference (Mode B).
 *
 * Mirrors the workProductQuestions pattern (admin add/reorder/toggle; answers
 * stored on the target doc). Three field types are supported:
 *   - 'select'        — single-select dropdown of admin-defined `options`.
 *   - 'period-picker' — single-select of the invitee's OWN building periods,
 *                       resolved at fill time from /buildingSchedules.
 *   - 'before-after'  — fixed "Before school" / "After school" choice.
 *
 * Answers are persisted as `{ fieldId, type, value }` on the booking's
 * observation (`signupDetails`) and on the Mode B preference (`detailAnswers`).
 */

export const SIGNUP_FIELD_TYPES = ['select', 'period-picker', 'before-after'] as const;
export type SignupFieldType = (typeof SIGNUP_FIELD_TYPES)[number];

export const SIGNUP_FIELD_APPLIES_TO = ['direct', 'day-preference', 'both'] as const;
export type SignupFieldAppliesTo = (typeof SIGNUP_FIELD_APPLIES_TO)[number];

export const signupField = z.object({
  fieldId: slugId,
  label: z.string().trim().min(1).max(120),
  type: z.enum(SIGNUP_FIELD_TYPES),
  /** Only used by 'select'; ignored for other types. */
  options: z.array(z.string().trim().min(1).max(120)).default([]),
  appliesTo: z.enum(SIGNUP_FIELD_APPLIES_TO).default('both'),
  required: z.boolean().default(false),
  order: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type SignupField = z.infer<typeof signupField>;

export const signupFieldInput = signupField.omit({
  createdAt: true,
  updatedAt: true,
});
export type SignupFieldInput = z.infer<typeof signupFieldInput>;

/** An answer to a signup field, stored on the booking/preference. */
export const signupFieldAnswer = z.object({
  fieldId: slugId,
  type: z.enum(SIGNUP_FIELD_TYPES),
  value: z.string().trim().max(200),
});
export type SignupFieldAnswer = z.infer<typeof signupFieldAnswer>;
