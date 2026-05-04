import { z } from 'zod';
import { email, isoDate } from './common.js';
import { staffYear } from './staff.js';
import { componentId } from './rubric.js';

/**
 * /settings/roleYearMappings/{roleId}_{year} — which components a given
 * (role, year) combination is responsible for in their rubric.
 *
 * This replaces the GAS Settings sheet's 4-row-per-role block layout with
 * a flat document keyed on the role+year pair. The admin matrix UI (Phase 3)
 * edits these directly.
 *
 * Empty assignedComponentIds means "no components active for this role-year"
 * — used to hide the rubric viewer entirely for staff in non-evaluation
 * cycles.
 */

export const roleYearMapping = z.object({
  roleId: z.string().min(1),
  year: staffYear,
  assignedComponentIds: z.array(componentId).default([]),
  updatedAt: isoDate,
});
export type RoleYearMapping = z.infer<typeof roleYearMapping>;

export const roleYearMappingInput = roleYearMapping.omit({ updatedAt: true });
export type RoleYearMappingInput = z.infer<typeof roleYearMappingInput>;

/** Document ID convention: `${roleId}_${year}` */
export function roleYearMappingDocId(roleId: string, year: number): string {
  return `${roleId}_${year.toString()}`;
}

/**
 * /appSettings/global — single document holding system-wide tunables.
 * Admin-editable through the Settings UI.
 */
export const rateLimits = z.object({
  observationSavesPerMinute: z.number().int().positive().default(60),
  audioUploadsPerHour: z.number().int().positive().default(20),
  transcriptionRequestsPerDay: z.number().int().positive().default(50),
});
export type RateLimits = z.infer<typeof rateLimits>;

export const branding = z.object({
  appName: z.string().trim().min(1).max(80).default('Orono Peer Observations'),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color')
    .default('#2d3f89'),
  /** Drive file ID of the active app logo. Null = use packaged default. */
  logoDriveFileId: z.string().nullable().default(null),
});
export type Branding = z.infer<typeof branding>;

export const appSettings = z.object({
  sessionDurationHours: z.number().int().positive().max(168).default(24),
  auditLogRetentionDays: z.number().int().positive().max(3650).default(365),
  rateLimits: rateLimits.default({
    observationSavesPerMinute: 60,
    audioUploadsPerHour: 20,
    transcriptionRequestsPerDay: 50,
  }),
  branding: branding.default({
    appName: 'Orono Peer Observations',
    primaryColor: '#2d3f89',
    logoDriveFileId: null,
  }),
  /** Where security alerts go. */
  securityAdminEmail: email,
  /** Send-as address for finalized observation notification emails. */
  outboundEmailAddress: email.default('observations@orono.k12.mn.us'),
  /** Display banner at top of all pages. Empty = no banner. */
  globalBannerText: z.string().trim().max(280).default(''),
  /** When set, blocks new observation creation in the GAS-cutover window. */
  newObservationsDisabled: z.boolean().default(false),
  /** URL used in the observation signup request email template. Point to
   *  a Calendly link, Google Form, or any scheduling URL. */
  signupLink: z.url().nullable().default(null),
  updatedAt: isoDate,
  updatedBy: email.optional(),
});
export type AppSettings = z.infer<typeof appSettings>;

export const APP_SETTINGS_DOC_ID = 'global';
