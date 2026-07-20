import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDriveClient } from '../lib/drive.js';
import { loadSecurityAdminEmail, sendEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * Fraction of Drive quota used that triggers an alert email.
 * At 80 % the admin still has meaningful headroom to act before uploads fail.
 */
export const QUOTA_ALERT_THRESHOLD = 0.8;

/**
 * Mail-doc id for a quota alert — keyed on the calendar date (UTC YYYY-MM-DD)
 * so only one alert fires per day even if the function retries. A new day
 * produces a new doc, which re-alerts if the condition persists.
 */
export function quotaAlertMailDocId(dateYMD: string): string {
  return `drive-quota-alert-${dateYMD}`;
}

/**
 * Parse the `storageQuota` object returned by `drive.about.get`.
 * The API returns string-encoded int64 values; we convert to Numbers.
 * Returns `null` if the fields are absent (e.g. Shared Drive context where
 * quota is pooled and `limit` is not reported).
 *
 * Accepts both `null` and `undefined` for absent fields because the googleapis
 * client types the fields as `string | null | undefined` depending on context.
 */
export function parseStorageQuota(quota: {
  limit?: string | null | undefined;
  usage?: string | null | undefined;
  usageInDrive?: string | null | undefined;
}): { limitBytes: number; usageBytes: number; usageInDriveBytes: number } | null {
  if (quota.limit == null || quota.usage == null) return null;
  const limitBytes = Number(quota.limit);
  const usageBytes = Number(quota.usage);
  const usageInDriveBytes = Number(quota.usageInDrive ?? '0');
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return null;
  if (!Number.isFinite(usageBytes) || !Number.isFinite(usageInDriveBytes)) return null;
  return { limitBytes, usageBytes, usageInDriveBytes };
}

/**
 * Daily scheduled function that checks the service account's Drive storage
 * quota and emails the security admin when usage crosses
 * {@link QUOTA_ALERT_THRESHOLD}.
 *
 * **Why this matters now:** while the long-term fix is to move the parent
 * folder to a Shared Drive (which has pooled, effectively unbounded Workspace
 * capacity), the quota check provides an early-warning layer regardless of
 * where the parent folder lives. If the SA is still operating on My Drive, the
 * alert fires before uploads begin to fail. If the SA has been migrated to a
 * Shared Drive, `storageQuota.limit` will not be reported by the API (Shared
 * Drive items do not count against personal quota), so the check logs a
 * non-alert info entry and returns without emailing.
 *
 * Runs at 05:00 America/Chicago — well before the morning sign-in spike and
 * after audit/transcription sweeps.
 */
export const monitorDriveQuota = onSchedule(
  {
    schedule: 'every day 05:00',
    timeZone: 'America/Chicago',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    const drive = await getDriveClient();
    const db = getFirestore();

    // drive.about.get returns the SA's own storage quota.
    const aboutRes = await drive.about.get({ fields: 'storageQuota' });
    const rawQuota = aboutRes.data.storageQuota;

    if (!rawQuota) {
      logger.info('monitorDriveQuota: storageQuota absent from response (Shared Drive context)');
      return;
    }

    const parsed = parseStorageQuota({
      limit: rawQuota.limit,
      usage: rawQuota.usage,
      usageInDrive: rawQuota.usageInDrive,
    });

    if (parsed === null) {
      // limit is null/zero → SA files live on a Shared Drive; quota is pooled
      // and effectively unbounded. No alert needed.
      logger.info('monitorDriveQuota: quota limit not applicable (Shared Drive or unlimited plan)');
      return;
    }

    const { limitBytes, usageBytes, usageInDriveBytes } = parsed;
    const fraction = usageBytes / limitBytes;
    const pct = Math.round(fraction * 100);

    logger.info('monitorDriveQuota: quota sampled', {
      limitBytes,
      usageBytes,
      usageInDriveBytes,
      pct,
      threshold: Math.round(QUOTA_ALERT_THRESHOLD * 100),
    });

    if (fraction < QUOTA_ALERT_THRESHOLD) return;

    // Over threshold — email the security admin.
    const adminEmail = await loadSecurityAdminEmail(db);
    if (!adminEmail) {
      logger.warn(
        'monitorDriveQuota: over threshold but securityAdminEmail is unset; skipping alert',
      );
      return;
    }

    const dateYMD = new Date().toISOString().slice(0, 10);
    const limitGB = (limitBytes / 1_073_741_824).toFixed(1);
    const usedGB = (usageBytes / 1_073_741_824).toFixed(1);

    await sendEmail({
      db,
      to: adminEmail,
      subject: `[Orono Peer Obs] Drive storage at ${String(pct)}% — action required`,
      html: `
        <p>The Peer Observations service account's Google Drive storage is at
        <strong>${String(pct)}%</strong> of its ${limitGB} GB limit
        (${usedGB} GB used).</p>
        <p>If storage fills completely, audio uploads, evidence uploads, and PDF
        finalization will fail for all users district-wide.</p>
        <p><strong>Recommended action:</strong> move the observations parent
        folder to a Google Workspace Shared Drive and make the service account
        a Content Manager. Shared Drive capacity is pooled across the
        Workspace domain and not subject to per-account limits.</p>
      `.trim(),
      mailDocId: quotaAlertMailDocId(dateYMD),
      // Ops alert to the security admin — 'manual' is an always-send trigger
      // (unmapped to any preference category), so it is never suppressed by
      // recipient email preferences.
      triggerType: 'manual',
      auditDetails: { limitBytes, usageBytes, pct },
    });

    logger.warn('monitorDriveQuota: alert sent', { adminEmail, pct, usedGB, limitGB });
  },
);
