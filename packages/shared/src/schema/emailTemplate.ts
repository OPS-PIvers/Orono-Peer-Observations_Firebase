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
  'scheduling.windowInvite',
  'scheduling.bookingConfirmation',
  'scheduling.assignmentNotice',
  'scheduling.bookingCancelled',
  'scheduling.bookingRescheduled',
  'scheduling.windowExpired',
  'scheduling.bookingScheduleChanged',
] as const;
export type EmailTriggerType = (typeof EMAIL_TRIGGER_TYPES)[number];

/**
 * Preference categories a staff member can individually toggle off from
 * their Profile page. Every EMAIL_TRIGGER_TYPES value maps to exactly one of
 * these via EMAIL_TRIGGER_CATEGORY, *or* is left out of that map entirely —
 * unmapped trigger types are workflow-critical and always send regardless of
 * preference (see CRITICAL_EMAIL_TRIGGER_TYPES).
 */
export const EMAIL_PREFERENCE_CATEGORIES = [
  'observationNotices',
  'reminders',
  'schedulingUpdates',
  'manualMessages',
] as const;
export type EmailPreferenceCategory = (typeof EMAIL_PREFERENCE_CATEGORIES)[number];

export const EMAIL_PREFERENCE_CATEGORY_LABELS: Record<
  EmailPreferenceCategory,
  { label: string; description: string }
> = {
  observationNotices: {
    label: 'Observation notices',
    description: 'New and finalized observation notifications.',
  },
  reminders: {
    label: 'Reminders',
    description: 'Pre-observation and incomplete work-product reminders.',
  },
  schedulingUpdates: {
    label: 'Scheduling updates',
    description: 'Window invitations, assignment notices, and window-expired notices.',
  },
  manualMessages: {
    label: 'Manual messages',
    description: 'One-off messages a Peer Evaluator sends you directly.',
  },
};

/** Maps each non-critical trigger type to the preference category that
 *  controls it. Trigger types absent from this map (booking confirmations,
 *  cancellations, reschedules, new-staff invites, role/year changes) are
 *  workflow-critical and always send — see CRITICAL_EMAIL_TRIGGER_TYPES. */
export const EMAIL_TRIGGER_CATEGORY: Partial<Record<EmailTriggerType, EmailPreferenceCategory>> = {
  manual: 'manualMessages',
  'observation.created.standard': 'observationNotices',
  'observation.created.workProduct': 'observationNotices',
  'observation.created.instructionalRound': 'observationNotices',
  'observation.finalized': 'observationNotices',
  'scheduled.preObservation': 'reminders',
  'scheduled.reminderIncomplete': 'reminders',
  'scheduling.windowInvite': 'schedulingUpdates',
  'scheduling.assignmentNotice': 'schedulingUpdates',
  'scheduling.windowExpired': 'schedulingUpdates',
};

/** Trigger types that are always sent regardless of preference — booking
 *  confirmations/cancellations/reschedules and the two account-lifecycle
 *  notices (new-staff invite, role/year change). */
export const CRITICAL_EMAIL_TRIGGER_TYPES = [
  'scheduling.bookingConfirmation',
  'scheduling.bookingCancelled',
  'scheduling.bookingRescheduled',
  'scheduling.bookingScheduleChanged',
  'staff.created',
  'roleYearMapping.updated',
] as const satisfies readonly EmailTriggerType[];

/** True for trigger types with no preference control — always send. */
export function isCriticalEmailTrigger(triggerType: EmailTriggerType): boolean {
  return (CRITICAL_EMAIL_TRIGGER_TYPES as readonly string[]).includes(triggerType);
}

/**
 * Per-staff-member opt-in/out for each non-critical email category. Lives on
 * /staff/{email}.emailPreferences. Every field defaults true (opted in) so an
 * unset map — the common case for existing staff docs — behaves exactly like
 * today: everything sends.
 */
export const emailPreferences = z.object({
  observationNotices: z.boolean().default(true),
  reminders: z.boolean().default(true),
  schedulingUpdates: z.boolean().default(true),
  manualMessages: z.boolean().default(true),
});
export type EmailPreferences = z.infer<typeof emailPreferences>;

/** Default (fully opted-in) preferences, for seeding a new staff doc or
 *  falling back when a staff doc predates this field. */
export const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  observationNotices: true,
  reminders: true,
  schedulingUpdates: true,
  manualMessages: true,
};

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
  'previousSlotDateLocal',
  'previousSlotStartLocal',
  'windowStartLocal',
  'windowEndLocal',
  'scheduleChangeReason',
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
   */
  scheduledDays: z.number().int().positive().default(3),
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

// --- Callable contract: updateEmailPreferences ----------------------------

/** Input to the updateEmailPreferences callable — a partial patch merged
 *  onto the caller's current /staff/{email}.emailPreferences. */
export const updateEmailPreferencesInput = emailPreferences.partial();
export type UpdateEmailPreferencesInput = z.infer<typeof updateEmailPreferencesInput>;
