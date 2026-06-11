import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { staffYear } from './staff.js';
import { localDate } from './buildingSchedule.js';
import { signupFieldAnswer } from './signupField.js';
import { observationType } from './observation.js';
import { BOOKING_MODES } from './settings.js';

/**
 * /observationWindows/{windowId} — a window during which a peer evaluator
 * invites staff to schedule an observation.
 *
 * The bookable resource is the EVALUATOR'S wall-clock time. Each invitee
 * books against their own building's bell schedule, but every booking
 * reserves an interval on `peBusyIntervals` (the authoritative ledger held
 * on this doc). The booking transaction reads + writes this array, which
 * serializes all bookings in a window and lets us reject cross-building
 * overlaps (± the travel buffer).
 *
 * Two modes:
 *   - 'direct'         — staff self-book an exact slot (first-come-first-served).
 *   - 'day-preference' — staff pick a capped day; the PE later assigns an
 *                        exact time on the assignment review page.
 */

export const observationWindowStatus = z.enum([
  'open',
  'partially-booked',
  'fully-booked',
  'cancelled',
  'expired',
]);

/** One invitee on a window. `buildingId` selects which building's schedule
 *  this invitee books against (staff may belong to several buildings). */
export const windowInvitee = z.object({
  email,
  name: z.string().trim().min(1),
  role: z.string().trim().default(''),
  year: staffYear,
  buildings: z.array(z.string()).default([]),
  buildingId: slugId,
  /** Per-invitee opaque token so booking links are individually identifiable. */
  inviteToken: z.string().min(1),
  inviteSentAt: isoDate.nullable().default(null),
  /** Set once this invitee has a booking (one observation per invitee). */
  bookedSlotId: z.string().nullable().default(null),
});
export type WindowInvitee = z.infer<typeof windowInvitee>;

/** An interval the evaluator is occupied, in absolute UTC. */
export const peBusyInterval = z.object({
  startUTC: isoDate,
  endUTC: isoDate,
  slotId: z.string().min(1),
});
export type PeBusyInterval = z.infer<typeof peBusyInterval>;

export const observationWindow = z.object({
  windowId: z.string().min(1),
  observerEmail: email,
  observerName: z.string().trim().default(''),
  bookingMode: z.enum(BOOKING_MODES),

  invitedEmails: z.array(email).default([]),
  invitees: z.array(windowInvitee).default([]),

  // Window bounds (building-local).
  startDate: localDate,
  endDate: localDate,
  weekdaysIncluded: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  earliestMinute: z.number().int().min(0).max(1439).default(0),
  latestMinute: z.number().int().min(0).max(1439).default(1439),

  travelBufferMinutes: z.number().int().min(0).max(240).default(15),

  // Day-preference accounting.
  perDayCap: z.number().int().positive().nullable().default(null),
  dayCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),

  // Authoritative evaluator-time ledger.
  peBusyIntervals: z.array(peBusyInterval).default([]),

  signupFieldIds: z.array(z.string()).default([]),

  // Defaults baked into bookings.
  defaultObservationType: observationType,
  defaultObservationName: z.string().trim().max(200).default(''),
  calendarEventTitle: z.string().trim().max(200).default(''),
  calendarEventDescription: z.string().trim().max(2000).default(''),
  gcalSendUpdates: z.enum(['none', 'all']).default('none'),

  status: observationWindowStatus.default('open'),

  createdAt: isoDate,
  updatedAt: isoDate,
  cancelledAt: isoDate.nullable().default(null),
  cancelledBy: email.nullable().default(null),
  cancellationReason: z.string().trim().max(500).default(''),
});
export type ObservationWindow = z.infer<typeof observationWindow>;

// --- Callable contracts (shared by Cloud Functions + web client) ---------

export const createWindowInvitee = z.object({
  email,
  buildingId: slugId,
});
export type CreateWindowInvitee = z.infer<typeof createWindowInvitee>;

export const createObservationWindowInput = z.object({
  bookingMode: z.enum(BOOKING_MODES),
  startDate: localDate,
  endDate: localDate,
  weekdaysIncluded: z.array(z.number().int().min(0).max(6)).min(1),
  earliestMinute: z.number().int().min(0).max(1439),
  latestMinute: z.number().int().min(0).max(1439),
  travelBufferMinutes: z.number().int().min(0).max(240),
  perDayCap: z.number().int().positive().nullable().default(null),
  signupFieldIds: z.array(z.string()).default([]),
  defaultObservationType: observationType,
  defaultObservationName: z.string().trim().max(200).default(''),
  calendarEventTitle: z.string().trim().max(200).default(''),
  calendarEventDescription: z.string().trim().max(2000).default(''),
  gcalSendUpdates: z.enum(['none', 'all']).default('none'),
  invitees: z.array(createWindowInvitee).min(1),
});
export type CreateObservationWindowInput = z.infer<typeof createObservationWindowInput>;

export const bookObservationSlotInput = z.object({
  windowId: z.string().min(1),
  slotId: z.string().min(1),
  inviteToken: z.string().min(1),
  detailAnswers: z.array(signupFieldAnswer).default([]),
});
export type BookObservationSlotInput = z.infer<typeof bookObservationSlotInput>;

export const submitDayPreferenceInput = z.object({
  windowId: z.string().min(1),
  inviteToken: z.string().min(1),
  preferredDateYMD: localDate,
  detailAnswers: z.array(signupFieldAnswer).default([]),
});
export type SubmitDayPreferenceInput = z.infer<typeof submitDayPreferenceInput>;

export const assignObservationFromPreferenceInput = z.object({
  windowId: z.string().min(1),
  email,
  slotId: z.string().min(1),
});
export type AssignObservationFromPreferenceInput = z.infer<
  typeof assignObservationFromPreferenceInput
>;

export const cancelBookingInput = z.object({
  windowId: z.string().min(1),
  slotId: z.string().min(1),
  reason: z.string().trim().max(500).default(''),
});
export type CancelBookingInput = z.infer<typeof cancelBookingInput>;

/**
 * A document in the /observationWindows/{id}/tokens/{email::buildingId}
 * subcollection. Storing tokens here (instead of in invitees[]) means
 * invited staff cannot read each other's tokens through the window doc — the
 * subcollection rules only grant read access to special-access users (PE/admin)
 * and deny all client writes (server-only via Admin SDK).
 *
 * Key format: `${email}::${buildingId}` (mirrors inviteeEntryKey).
 */
export const windowTokenEntry = z.object({
  inviteToken: z.string().min(1),
  email,
  buildingId: slugId,
});
export type WindowTokenEntry = z.infer<typeof windowTokenEntry>;

export const cancelObservationWindowInput = z.object({
  windowId: z.string().min(1),
  reason: z.string().trim().max(500).default(''),
});
export type CancelObservationWindowInput = z.infer<typeof cancelObservationWindowInput>;

/**
 * Input for the `withdrawDayPreference` callable.
 *
 * Allows an invitee in day-preference mode to retract their preference
 * before a time has been assigned, freeing the day's capacity slot.
 */
export const withdrawDayPreferenceInput = z.object({
  windowId: z.string().min(1),
  inviteToken: z.string().min(1),
});
export type WithdrawDayPreferenceInput = z.infer<typeof withdrawDayPreferenceInput>;

export const rescheduleBookingInput = z.object({
  windowId: z.string().min(1),
  fromSlotId: z.string().min(1),
  toSlotId: z.string().min(1),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingInput>;

export const resendWindowInviteInput = z.object({
  windowId: z.string().min(1),
  email,
  buildingId: slugId,
});
export type ResendWindowInviteInput = z.infer<typeof resendWindowInviteInput>;
