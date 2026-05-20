import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { localDate } from './buildingSchedule.js';

/**
 * /observationWindows/{windowId}/slots/{slotId} — a bookable time slot.
 *
 * Deterministic id: `${buildingId}-${dateYMD}-${periodId}` so regeneration
 * is idempotent and an invitee's grid is just the slots whose `buildingId`
 * matches their own. Client write is denied — slots are mutated only by
 * Cloud Functions (Admin SDK) inside the booking transaction.
 */

export const observationSlotStatus = z.enum(['available', 'booked', 'blocked']);

export const slotBlockedReason = z.enum(['no-school', 'pe-conflict', 'window-cancelled']);
export type SlotBlockedReasonValue = z.infer<typeof slotBlockedReason>;

export const observationSlot = z.object({
  slotId: z.string().min(1),
  windowId: z.string().min(1),
  buildingId: slugId,
  dateYMD: localDate,
  dayTypeId: slugId,
  periodId: slugId,
  periodName: z.string().trim().default(''),
  /** Absolute instants for the period on this date. */
  startUTC: isoDate,
  endUTC: isoDate,
  /** Minutes-after-midnight (building-local) for stable intra-day ordering. */
  startMinute: z.number().int().min(0).max(1439),
  status: observationSlotStatus.default('available'),
  blockedReason: slotBlockedReason.nullable().default(null),
  bookedBy: email.nullable().default(null),
  bookedAt: isoDate.nullable().default(null),
  observationId: z.string().nullable().default(null),
  generatedAt: isoDate,
});
export type ObservationSlot = z.infer<typeof observationSlot>;
