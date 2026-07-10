import { z } from 'zod';
import { email, isoDate, metadata } from './common.js';

/**
 * /auditLog/{logId} — append-only activity log.
 *
 * Logs are written by Cloud Functions on privileged actions (auth,
 * observation lifecycle, admin edits, finalize, transcription jobs).
 * Pruned daily by a scheduled function based on appSettings.auditLogRetentionDays.
 *
 * `target` is a free-form ref — usually a collection/docId pair like
 * `observations/abc123` or `staff/user@orono.k12.mn.us`.
 */

export const AUDIT_ACTIONS = {
  signIn: 'sign_in',
  signOut: 'sign_out',
  signInRejected: 'sign_in_rejected',
  observationCreated: 'observation_created',
  observationUpdated: 'observation_updated',
  observationFinalized: 'observation_finalized',
  observationReopened: 'observation_reopened',
  observationDeleted: 'observation_deleted',
  pdfRegenerated: 'pdf_regenerated',
  emailSent: 'email_sent',
  emailDeliveryFailed: 'email_delivery_failed',
  emailSuppressed: 'email_suppressed',
  emailPreferencesUpdated: 'email_preferences_updated',
  staffCreated: 'staff_created',
  staffUpdated: 'staff_updated',
  staffDeactivated: 'staff_deactivated',
  staffYearRollover: 'staff_year_rollover',
  roleChanged: 'role_changed',
  rubricUpdated: 'rubric_updated',
  settingsUpdated: 'settings_updated',
  transcriptionRequested: 'transcription_requested',
  transcriptionCompleted: 'transcription_completed',
  transcriptionFailed: 'transcription_failed',
  driveFolderShared: 'drive_folder_shared',
  evidenceRemoved: 'evidence_removed',
  rateLimitTripped: 'rate_limit_tripped',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const auditLog = z.object({
  logId: z.string().min(1),
  timestamp: isoDate,
  userEmail: email.nullable(),
  action: z.enum(Object.values(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]]),
  target: z.string().min(1),
  details: metadata.default({}),
  /** Hashed IP for rate-limit / abuse detection (not raw IP, for privacy). */
  ipHash: z.string().nullable().default(null),
});
export type AuditLog = z.infer<typeof auditLog>;

/** Server-generated audit log. Cloud Functions construct these — no client
 *  ever writes to /auditLog directly (rules deny it). */
export const auditLogInput = auditLog.omit({ logId: true, timestamp: true });
export type AuditLogInput = z.infer<typeof auditLogInput>;
