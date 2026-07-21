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

/**
 * Withdraw an unassigned day-preference submission (booking mode
 * 'day-preference'). Only the preference's owner may call it, validated with
 * the same invite token as booking; an already-assigned preference must be
 * cancelled via `cancelBooking` instead.
 */
export const withdrawDayPreferenceInput = z.object({
  windowId: z.string().min(1),
  inviteToken: z.string().min(1),
});
export type WithdrawDayPreferenceInput = z.infer<typeof withdrawDayPreferenceInput>;

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

/** Move an existing booking to a different slot in the same window. The old
 *  slot is derived server-side from the invitee's `bookedSlotId`, so the
 *  client only names the destination. */
export const rescheduleBookingInput = z.object({
  windowId: z.string().min(1),
  newSlotId: z.string().min(1),
  inviteToken: z.string().min(1),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingInput>;

/**
 * Ask which of a window's slots collide with busy time on the evaluator's
 * REAL Google Calendar (freebusy) so the booking UI can badge them. Invitee-
 * scoped: validated with the same invite token as booking itself.
 */
export const checkSlotConflictsInput = z.object({
  windowId: z.string().min(1),
  inviteToken: z.string().min(1),
});
export type CheckSlotConflictsInput = z.infer<typeof checkSlotConflictsInput>;

/** `checked` is false when the freebusy lookup could not run (policy
 *  'ignore', evaluator calendar not connected, or API error) — the UI then
 *  shows no conflict badges rather than false negatives. */
export const checkSlotConflictsResult = z.object({
  checked: z.boolean(),
  conflictedSlotIds: z.array(z.string()).default([]),
});
export type CheckSlotConflictsResult = z.infer<typeof checkSlotConflictsResult>;

export const cancelObservationWindowInput = z.object({
  windowId: z.string().min(1),
  reason: z.string().trim().max(500).default(''),
});
export type CancelObservationWindowInput = z.infer<typeof cancelObservationWindowInput>;

/**
 * Post-creation window edits. All fields other than `windowId` are optional
 * actions applied together in one call:
 *   - `endDate`            — extend the booking period (never shrink it)
 *   - `addInvitees`        — invite additional staff (tokens minted server-side,
 *                            invite emails sent like at creation)
 *   - `removeInviteeEmails`— drop invitees who have not booked yet
 *   - `resendInviteEmails` — resend the invite email to un-booked invitees
 */
export const updateObservationWindowInput = z.object({
  windowId: z.string().min(1),
  endDate: localDate.optional(),
  addInvitees: z.array(createWindowInvitee).default([]),
  removeInviteeEmails: z.array(email).default([]),
  resendInviteEmails: z.array(email).default([]),
});
export type UpdateObservationWindowInput = z.infer<typeof updateObservationWindowInput>;
