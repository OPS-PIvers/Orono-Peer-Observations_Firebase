import { z } from 'zod';
import { isoDate, slugId, email } from './common.js';

/**
 * /buildingSchedules/{buildingId} — one document per building describing its
 * bell schedule. Used to generate bookable observation slots.
 *
 * Time-of-day is stored as minutes-after-midnight in the building's local
 * timezone (0–1439). Absolute instants are never stored here; slot
 * generation composes minute + date → UTC at write time (DST-safe).
 *
 * `weeklyPattern` maps each weekday to a day type; `overrides` replace the
 * pattern for specific dates (a null dayTypeId means an explicit no-school
 * day, e.g. a holiday that falls on a normal weekday).
 */

const minuteOfDay = z.number().int().min(0).max(1439);

export const schedulePeriod = z.object({
  periodId: slugId,
  name: z.string().trim().min(1).max(80),
  startMinute: minuteOfDay,
  endMinute: minuteOfDay,
  order: z.number().int().nonnegative(),
});
export type SchedulePeriod = z.infer<typeof schedulePeriod>;

export const scheduleDayType = z.object({
  dayTypeId: slugId,
  name: z.string().trim().min(1).max(80),
  /** When true, no observations can be scheduled on days of this type. */
  isNoSchool: z.boolean().default(false),
  periods: z.array(schedulePeriod).default([]),
});
export type ScheduleDayType = z.infer<typeof scheduleDayType>;

const dayTypeRef = slugId.nullable();

export const scheduleWeeklyPattern = z.object({
  mon: dayTypeRef.default(null),
  tue: dayTypeRef.default(null),
  wed: dayTypeRef.default(null),
  thu: dayTypeRef.default(null),
  fri: dayTypeRef.default(null),
});
export type ScheduleWeeklyPattern = z.infer<typeof scheduleWeeklyPattern>;

/** A date is `YYYY-MM-DD` in the building's local timezone. */
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const scheduleDateOverride = z.object({
  date: localDate,
  /** null = explicit no-school day (holiday/break) on an otherwise-school weekday. */
  dayTypeId: dayTypeRef.default(null),
  note: z.string().trim().max(200).default(''),
});
export type ScheduleDateOverride = z.infer<typeof scheduleDateOverride>;

export const buildingSchedule = z.object({
  buildingId: slugId,
  timeZone: z.string().trim().min(1).default('America/Chicago'),
  dayTypes: z.array(scheduleDayType).default([]),
  weeklyPattern: scheduleWeeklyPattern.default({
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
  }),
  overrides: z.array(scheduleDateOverride).default([]),
  /** Academic-year bounds (local dates). Slots are never generated outside these. */
  effectiveFrom: localDate.nullable().default(null),
  effectiveTo: localDate.nullable().default(null),
  isActive: z.boolean().default(true),
  createdAt: isoDate,
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type BuildingSchedule = z.infer<typeof buildingSchedule>;

export const buildingScheduleInput = buildingSchedule.omit({
  createdAt: true,
  updatedAt: true,
});
export type BuildingScheduleInput = z.infer<typeof buildingScheduleInput>;
