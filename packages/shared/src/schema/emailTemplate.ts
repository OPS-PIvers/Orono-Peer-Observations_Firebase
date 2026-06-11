import { z } from 'zod';
import { isoDate, slugId } from './common.js';

/**
 * Trigger types — what app event fires this template automatically.
 * `manual` = PE sends it explicitly via the UI.
 * `scheduled.*` = fired by the daily scheduledEmailReminders Cloud Function.
 */
export const EMAIL_TRIGGER_TYPES = [
  'manual',
  'observation.created.standard',
  'observation.created.workProduct',
  'observation.created.instructionalRound',
  'observation.finalized',
  'staff.created',
  'roleYearMapping.updated',
  'scheduled.preObservation',
  'scheduled.reminderIncomplete',
  'scheduled.reminderUnacknowledged',
  'scheduling.windowInvite',
  'scheduling.bookingConfirmation',
  'scheduling.bookingRescheduled',
  'scheduling.bookingTimeChanged',
  'scheduling.assignmentNotice',
  'scheduling.bookingCancelled',
  'scheduling.windowCancelled',
  'scheduling.windowExpired',
  'scheduling.preferenceSubmitted',
] as const;
export type EmailTriggerType = (typeof EMAIL_TRIGGER_TYPES)[number];

/**
 * Who receives the email.
 * observed   = the staff member being observed
 * observer   = the PE / observer
 * both       = both of the above (two separate sends)
 * admin      = the security admin email from AppSettings
 */
export const EMAIL_RECIPIENT_TYPES = ['observed', 'observer', 'both', 'admin'] as const;
export type EmailRecipientType = (typeof EMAIL_RECIPIENT_TYPES)[number];

/**
 * Variables available in all templates. Populated at send time;
 * unavailable variables for a given trigger are substituted with ''.
 */
export const KNOWN_TEMPLATE_VARIABLES = [
  // Observation participants
  'observerName',
  'observerEmail',
  'observedName',
  'observedEmail',
  'observedRole',
  'observedYear',
  // Observation metadata
  'observationDate',
  'observationName',
  'observationType',
  // Drive links (set on finalization)
  'pdfDriveLink',
  'driveFolderLink',
  // App
  'appName',
  'signInLink',
  // Staff invite
  'staffName',
  'staffEmail',
  'staffRole',
  // Staff evaluation year (populated by staff.created and roleYearMapping.updated)
  'staffYear',
  // Subdomain assignment
  'assignedDomainList',
  'assignedComponentCount',
  // Signup / scheduling
  'signupLink',
  'bookingLink',
  'slotDateLocal',
  'slotStartLocal',
  'slotEndLocal',
  'slotPeriodName',
  'buildingName',
  'cancellationReason',
  'windowStartLocal',
  'windowEndLocal',
  'preferredDateLocal',
] as const;
export type TemplateVariable = (typeof KNOWN_TEMPLATE_VARIABLES)[number];

export const emailTemplate = z.object({
  templateId: slugId,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).default(''),
  subject: z.string().trim().min(1).max(200),
  bodyHtml: z.string().trim().min(1),
  /** Which variables this template uses. Informational — used to show
   *  relevant chips in the admin UI. */
  variables: z.array(z.enum(KNOWN_TEMPLATE_VARIABLES)).default([]),
  /** What event triggers this template automatically. */
  triggerType: z.enum(EMAIL_TRIGGER_TYPES).default('manual'),
  /** Who receives the email. */
  recipient: z.enum(EMAIL_RECIPIENT_TYPES).default('observed'),
  /**
   * For scheduled.preObservation: days before observationDate to send.
   * For scheduled.reminderIncomplete: days after WP/IR creation to send.
   * For scheduled.reminderUnacknowledged: days after finalizedAt to send the first nudge.
   */
  scheduledDays: z.number().int().positive().default(3),
  /**
   * For scheduled.reminderIncomplete and scheduled.reminderUnacknowledged:
   * maximum number of daily nudges to send per observation before giving up.
   * Counts from the first eligible run (day scheduledDays after creation /
   * finalizedAt). Default 5 means the staff member receives at most 5
   * reminders over 5 consecutive days and then the system stops, preventing
   * indefinite daily spam on stalled observations.
   */
  maxReminders: z.number().int().positive().default(5),
  /** When false, the trigger is suppressed and nothing is sent. */
  isActive: z.boolean().default(true),
  /** System templates can be edited and toggled but not deleted. */
  isSystem: z.boolean().default(false),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type EmailTemplate = z.infer<typeof emailTemplate>;

export const emailTemplateInput = emailTemplate.omit({ createdAt: true, updatedAt: true });
export type EmailTemplateInput = z.infer<typeof emailTemplateInput>;

export const FINALIZED_OBSERVATION_TEMPLATE_ID = 'observation-finalized';
