import {
  APP_SETTINGS_DOC_ID,
  DEFAULT_SCHEDULING_SETTINGS,
  FINALIZED_OBSERVATION_TEMPLATE_ID,
  emailButtonHtml,
  type AppSettings,
  type EmailTemplate,
} from '@ops/shared';

/** Wrap a CTA button anchor in a centered paragraph for the template body. */
const ctaRow = (href: string, label: string): string =>
  `<p style="text-align:center;margin:26px 0;">${emailButtonHtml(href, label)}</p>`;

/**
 * Default seed data for the entities that don't exist in the GAS sheet —
 * email templates, app settings. These are admin-editable post-cutover.
 */

// Kept for backward-compat imports — now superseded by SYSTEM_TEMPLATES below.
export const DEFAULT_FINALIZED_OBSERVATION_TEMPLATE: Omit<
  EmailTemplate,
  'createdAt' | 'updatedAt'
> = {
  templateId: FINALIZED_OBSERVATION_TEMPLATE_ID,
  name: 'Observation Finalized',
  description: 'Sent to staff when their observation is finalized. Includes Drive folder link.',
  subject: 'Your Observation Has Been Finalized — {{appName}}',
  bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your peer observation conducted by {{observerName}} on {{observationDate}} has been finalized.</p>
<p>You can view your complete observation report in your Drive folder:</p>
${ctaRow('{{driveFolderLink}}', 'Open observation folder')}
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
  variables: [
    'observedName',
    'observerName',
    'observationDate',
    'driveFolderLink',
    'pdfDriveLink',
    'signInLink',
    'appName',
  ],
  triggerType: 'observation.finalized',
  recipient: 'observed',
  scheduledDays: 3,
  isActive: true,
  isSystem: true,
};

export const SYSTEM_TEMPLATES: Omit<EmailTemplate, 'createdAt' | 'updatedAt'>[] = [
  {
    templateId: 'observation-signup-request',
    name: 'Observation Signup Request',
    description:
      'Sent manually by PEs to invite a staff member to sign up for an observation timeslot.',
    subject: 'Schedule Your Observation — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your peer evaluator would like to schedule an observation with you. Please use the link below to sign up for a timeslot that works for your schedule.</p>
${ctaRow('{{signupLink}}', 'Sign up for a timeslot')}
<p>If you have any questions, feel free to reach out.</p>
<p>— {{appName}}</p>`,
    variables: ['observedName', 'signupLink', 'appName'],
    triggerType: 'manual',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'observation-reminder',
    name: 'Upcoming Observation Reminder',
    description: 'Sent automatically N days before a scheduled observation date.',
    subject: 'Reminder: Your Observation is Coming Up — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>This is a reminder that you have an observation scheduled for <strong>{{observationDate}}</strong> with {{observerName}}.</p>
<p>You can sign in to {{appName}} to review your rubric and assigned areas ahead of time:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: ['observedName', 'observerName', 'observationDate', 'signInLink', 'appName'],
    triggerType: 'scheduled.preObservation',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'observation-created-standard',
    name: 'Observation Created (Standard)',
    description: 'Sent to staff when a standard observation is created for them.',
    subject: 'A Standard Observation Has Been Started — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>{{observerName}} has started a standard observation for you.</p>
<p>You can sign in to view your rubric and assigned areas:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: ['observedName', 'observerName', 'observationDate', 'signInLink', 'appName'],
    triggerType: 'observation.created.standard',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: false,
    isSystem: true,
  },
  {
    templateId: FINALIZED_OBSERVATION_TEMPLATE_ID,
    name: 'Observation Finalized',
    description: 'Sent to staff when their observation is finalized. Includes Drive folder link.',
    subject: 'Your Observation Has Been Finalized — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your peer observation conducted by {{observerName}} on {{observationDate}} has been finalized.</p>
<p>You can view your complete observation report, including ratings, look-fors, notes, and any media files, in your Drive folder:</p>
${ctaRow('{{driveFolderLink}}', 'Open observation folder')}
<p>Sign in to {{appName}} to see your rubric and all finalized observations:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'observationDate',
      'driveFolderLink',
      'pdfDriveLink',
      'signInLink',
      'appName',
    ],
    triggerType: 'observation.finalized',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'subdomains-assigned',
    name: 'Assigned Subdomains Notification',
    description:
      'Sent to staff when their role-year subdomain assignments are updated by an admin.',
    subject: 'Your Observation Focus Areas Have Been Assigned — {{appName}}',
    bodyHtml: `<p>Hi {{staffName}},</p>
<p>Your assigned observation focus areas have been updated for the current cycle. You have <strong>{{assignedComponentCount}} component(s)</strong> assigned to your rubric.</p>
<p>Sign in to {{appName}} to view your assigned areas and full rubric:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: ['staffName', 'assignedComponentCount', 'signInLink', 'appName'],
    triggerType: 'roleYearMapping.updated',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'work-product-created',
    name: 'Work Product Questions Available',
    description: 'Sent to staff when a Work Product observation is created for them.',
    subject: 'Work Product Questions Are Ready for You — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your peer evaluator has started a Work Product observation and has questions for you to respond to. Your responses help inform the observation process.</p>
<p>Sign in to {{appName}} to view and respond to your Work Product questions:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>Please complete your responses at your earliest convenience.</p>
<p>— {{appName}}</p>`,
    variables: ['observedName', 'signInLink', 'appName'],
    triggerType: 'observation.created.workProduct',
    recipient: 'observed',
    scheduledDays: 7,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'instructional-round-created',
    name: 'Instructional Round Questions Available',
    description: 'Sent to staff when an Instructional Round observation is created.',
    subject: 'Instructional Round Questions Are Ready — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your peer evaluator has initiated an Instructional Round observation and has reflection questions for you to respond to.</p>
<p>Sign in to {{appName}} to view and complete your Instructional Round questions:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: ['observedName', 'signInLink', 'appName'],
    triggerType: 'observation.created.instructionalRound',
    recipient: 'observed',
    scheduledDays: 7,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'incomplete-response-reminder',
    name: 'Reminder: Incomplete Work Product / IR Responses',
    description:
      'Sent automatically N days after a WP or IR observation is created if staff has not responded.',
    subject: 'Reminder: Please Complete Your Observation Questions — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>This is a friendly reminder that you have unanswered questions for your <strong>{{observationType}}</strong> observation in {{appName}}.</p>
<p>Your peer evaluator is waiting on your responses to proceed. Please sign in and complete them when you have a moment:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: ['observedName', 'observationType', 'signInLink', 'appName'],
    triggerType: 'scheduled.reminderIncomplete',
    recipient: 'observed',
    scheduledDays: 7,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'staff-invite',
    name: 'New Staff System Invitation',
    description: 'Sent to newly added staff members, welcoming them to the system.',
    subject: 'Welcome to {{appName}}',
    bodyHtml: `<p>Hi {{staffName}},</p>
<p>You've been added to <strong>{{appName}}</strong>, Orono Public Schools' peer observation platform.</p>
<p>You can sign in using your Orono Google account to view your rubric, assigned focus areas, and any finalized observations:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>If you have any questions, please contact your peer evaluator or administrator.</p>
<p>— {{appName}}</p>`,
    variables: ['staffName', 'staffRole', 'signInLink', 'appName'],
    triggerType: 'staff.created',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'observer-observation-confirmation',
    name: 'Observer: Observation Created Confirmation',
    description:
      'Sent to the PE/observer when they create any new observation — confirmation receipt.',
    subject: 'Observation Created for {{observedName}} — {{appName}}',
    bodyHtml: `<p>Hi {{observerName}},</p>
<p>This confirms that you have created a new <strong>{{observationType}}</strong> observation for <strong>{{observedName}}</strong>.</p>
<p>Sign in to continue working on this observation:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observerName',
      'observedName',
      'observationType',
      'observationDate',
      'signInLink',
      'appName',
    ],
    triggerType: 'manual',
    recipient: 'observer',
    scheduledDays: 3,
    isActive: false,
    isSystem: true,
  },
  {
    templateId: 'scheduling-window-invite',
    name: 'Scheduling: Window Invite',
    description:
      'Sent to each invited staff member when a peer evaluator opens an observation window. Includes their personal booking link.',
    subject: 'Schedule your observation — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>{{observerName}} has opened a window to schedule your observation between {{windowStartLocal}} and {{windowEndLocal}}.</p>
<p>Use your personal link below to pick a time that works for you:</p>
${ctaRow('{{bookingLink}}', 'Schedule my observation')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'bookingLink',
      'buildingName',
      'windowStartLocal',
      'windowEndLocal',
      'signInLink',
      'appName',
    ],
    triggerType: 'scheduling.windowInvite',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'scheduling-booking-confirmation',
    name: 'Scheduling: Booking Confirmed',
    description: 'Sent to the staff member and the evaluator when an observation slot is booked.',
    subject: 'Observation scheduled for {{slotDateLocal}} — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your observation with {{observerName}} is confirmed for <strong>{{slotDateLocal}}</strong>, {{slotStartLocal}}–{{slotEndLocal}} ({{slotPeriodName}}) at {{buildingName}}.</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'slotDateLocal',
      'slotStartLocal',
      'slotEndLocal',
      'slotPeriodName',
      'buildingName',
      'signInLink',
      'appName',
    ],
    triggerType: 'scheduling.bookingConfirmation',
    recipient: 'both',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'scheduling-assignment-notice',
    name: 'Scheduling: Time Assigned',
    description:
      'Sent when a peer evaluator assigns an exact observation time from a day preference.',
    subject: 'Your observation time — {{slotDateLocal}} — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>{{observerName}} has assigned your observation for <strong>{{slotDateLocal}}</strong>, {{slotStartLocal}}–{{slotEndLocal}} ({{slotPeriodName}}) at {{buildingName}}.</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'slotDateLocal',
      'slotStartLocal',
      'slotEndLocal',
      'slotPeriodName',
      'buildingName',
      'signInLink',
      'appName',
    ],
    triggerType: 'scheduling.assignmentNotice',
    recipient: 'both',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'scheduling-booking-cancelled',
    name: 'Scheduling: Booking Cancelled',
    description: 'Sent to the staff member and evaluator when a booked observation is cancelled.',
    subject: 'Observation cancelled — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>Your observation with {{observerName}} on {{slotDateLocal}} ({{slotStartLocal}}) has been cancelled.</p>
<p>{{cancellationReason}}</p>
<p>You can reschedule if needed:</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'slotDateLocal',
      'slotStartLocal',
      'cancellationReason',
      'signInLink',
      'appName',
    ],
    triggerType: 'scheduling.bookingCancelled',
    recipient: 'both',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'scheduling-window-cancelled',
    name: 'Scheduling: Window Cancelled',
    description:
      'Sent to invitees who had not yet booked when a peer evaluator cancels a scheduling window.',
    subject: 'Observation scheduling window cancelled — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>{{observerName}} has cancelled the window to schedule your observation ({{windowStartLocal}}–{{windowEndLocal}}), so no booking is needed.</p>
<p>{{cancellationReason}}</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'windowStartLocal',
      'windowEndLocal',
      'cancellationReason',
      'signInLink',
      'appName',
    ],
    triggerType: 'scheduling.windowCancelled',
    recipient: 'observed',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
  {
    templateId: 'scheduling-window-expired',
    name: 'Scheduling: Window Expired',
    description: 'Sent to invitees who never booked when a scheduling window expires.',
    subject: 'Observation scheduling window closed — {{appName}}',
    bodyHtml: `<p>Hi {{observedName}},</p>
<p>The window to schedule your observation with {{observerName}} ({{windowStartLocal}}–{{windowEndLocal}}) has closed. Please reach out to arrange a time.</p>
${ctaRow('{{signInLink}}', 'Sign in to {{appName}}')}
<p>— {{appName}}</p>`,
    variables: [
      'observedName',
      'observerName',
      'windowStartLocal',
      'windowEndLocal',
      'signInLink',
      'appName',
    ],
    triggerType: 'scheduling.windowExpired',
    recipient: 'both',
    scheduledDays: 3,
    isActive: true,
    isSystem: true,
  },
];

export function defaultAppSettings(securityAdminEmail: string): Omit<AppSettings, 'updatedAt'> {
  return {
    sessionDurationHours: 24,
    auditLogRetentionDays: 365,
    rateLimits: {
      observationSavesPerMinute: 60,
      audioUploadsPerHour: 20,
      transcriptionRequestsPerDay: 50,
    },
    branding: {
      appName: 'Orono Peer Observations',
      primaryColor: '#2d3f89',
      logoUrl: null,
      iconUrl: null,
    },
    securityAdminEmail,
    outboundEmailAddress: 'observations@orono.k12.mn.us',
    globalBannerText: '',
    newObservationsDisabled: false,
    signupLink: null,
    scheduling: DEFAULT_SCHEDULING_SETTINGS,
  };
}

export const APP_SETTINGS_PATH = `appSettings/${APP_SETTINGS_DOC_ID}`;
