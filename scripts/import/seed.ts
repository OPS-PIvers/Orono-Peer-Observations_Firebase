import {
  APP_SETTINGS_DOC_ID,
  FINALIZED_OBSERVATION_TEMPLATE_ID,
  type AppSettings,
  type EmailTemplate,
} from '@ops/shared';

/**
 * Default seed data for the entities that don't exist in the GAS sheet —
 * email templates, app settings. These are admin-editable post-cutover.
 */

export const DEFAULT_FINALIZED_OBSERVATION_TEMPLATE: Omit<
  EmailTemplate,
  'createdAt' | 'updatedAt'
> = {
  templateId: FINALIZED_OBSERVATION_TEMPLATE_ID,
  name: 'Finalized Observation Notification',
  subject: 'Your peer observation has been finalized',
  bodyHtml: `<p>Hello {{observedName}},</p>
<p>Your peer observation, conducted by {{observerName}} on {{observationDate}}, has been finalized.</p>
<p>You can view the full observation report (including notes, evidence, and proficiency ratings) in your Drive folder:</p>
<p><a href="{{driveFolderLink}}">View observation folder</a></p>
<p>If you have any questions, please reach out to {{observerEmail}} or a peer evaluator administrator.</p>
<p>— {{appName}}</p>`,
  variables: [
    'observerName',
    'observerEmail',
    'observedName',
    'observationDate',
    'driveFolderLink',
    'appName',
  ],
  isActive: true,
};

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
      logoDriveFileId: null,
    },
    securityAdminEmail,
    outboundEmailAddress: 'observations@orono.k12.mn.us',
    globalBannerText: '',
    newObservationsDisabled: false,
  };
}

export const APP_SETTINGS_PATH = `appSettings/${APP_SETTINGS_DOC_ID}`;
