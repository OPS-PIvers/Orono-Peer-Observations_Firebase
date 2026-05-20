import { z } from 'zod';
import { email, isoDate, slugId } from './common.js';
import { localDate } from './buildingSchedule.js';
import { signupFieldAnswer } from './signupField.js';

/**
 * /observationWindows/{windowId}/preferences/{email} — a day-preference
 * submission (booking mode 'day-preference'). The PE later turns this into
 * an actual booking on the assignment review page. Doc id is the staff
 * email so submissions are one-per-invitee and trivially looked up.
 */
export const observationPreference = z.object({
  email,
  name: z.string().trim().default(''),
  buildingId: slugId,
  preferredDateYMD: localDate,
  detailAnswers: z.array(signupFieldAnswer).default([]),
  submittedAt: isoDate,
  /** Set when the PE assigns an exact slot from this preference. */
  assignedSlotId: z.string().nullable().default(null),
  assignedAt: isoDate.nullable().default(null),
});
export type ObservationPreference = z.infer<typeof observationPreference>;
