import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { Timestamp } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { OBSERVATION_TYPES, type EmailTriggerType } from '@ops/shared';
import { getSheetsClient } from '../lib/sheets.js';
import { deleteDriveFolder } from '../lib/drive.js';
import { formatDate, sendTemplatedEmail } from '../lib/emailUtils.js';

if (getApps().length === 0) initializeApp();

/**
 * Google Sheet ID of the "Observation Master Log" — admins create this
 * sheet, share with the SA as Editor, and set this env var. When unset
 * (e.g., before Phase 0h ops setup) the trigger no-ops gracefully.
 */
const MASTER_LOG_SHEET_ID = defineString('MASTER_LOG_SHEET_ID');

const HEADER_ROW = [
  'Observation ID',
  'Observer Email',
  'Observed Email',
  'Observed Name',
  'Role',
  'Year',
  'Type',
  'Status',
  'Created',
  'Finalized',
  'Observation Name',
  'Observation Date',
  'Drive Folder',
  'PDF',
];

/** Fields that, when changed, warrant a Sheet sync. Component notes,
 *  per-question proficiency, evidence links, etc. don't move the sheet —
 *  the sheet is for admin-level metadata browsing. */
const MEANINGFUL_FIELDS = [
  'status',
  'observationName',
  'observationDate',
  'finalizedAt',
  'pdfDriveFileId',
  'driveFolderId',
  'observerEmail',
  'observedEmail',
  'observedName',
  'observedRole',
  'observedYear',
  'type',
] as const;

type ObsLike = Record<string, unknown>;

/**
 * Mirror observation metadata into a Google Sheet so admins can browse
 * outside the app (filter by status, sort by date, etc.).
 *
 * Triggered on every /observations write but bails when no
 * admin-relevant field changed — this keeps the autosave-heavy Draft
 * editing flow from spamming the Sheets API.
 */
export const onObservationWritten = onDocumentWritten(
  {
    document: 'observations/{observationId}',
    region: 'us-central1',
    memory: '256MiB',
    // Serialize: each invocation does 2 Sheet reads + 1 write, and the
    // free Sheets API quota is 60 read + 60 write per minute. Allowing
    // 20 parallel instances during a bulk import (or any burst) trips
    // the quota, drops rows, and surfaces as 429s in the function logs.
    // One instance at a time keeps everything orderly; the trigger work
    // is fast enough that serialization isn't a UX concern.
    maxInstances: 1,
    concurrency: 1,
  },
  async (event) => {
    const sheetId = MASTER_LOG_SHEET_ID.value();

    const beforeData = event.data?.before.exists
      ? (event.data.before.data() as ObsLike | undefined)
      : null;
    const afterData = event.data?.after.exists
      ? (event.data.after.data() as ObsLike | undefined)
      : null;

    if (!afterData) {
      // Deletion — clean up Drive (Drafts only) and mark the Sheet row.
      await handleDeletion(sheetId, event.params.observationId, beforeData);
      return;
    }

    // Detect creation: before didn't exist, after does
    const isNewObservation = !beforeData && !!afterData;
    if (isNewObservation && afterData['observedEmail']) {
      const obsType = afterData['type'] as string | undefined;
      const triggerType: EmailTriggerType =
        obsType === OBSERVATION_TYPES.workProduct
          ? 'observation.created.workProduct'
          : obsType === OBSERVATION_TYPES.instructionalRound
            ? 'observation.created.instructionalRound'
            : 'observation.created.standard';

      try {
        const db = getFirestore();
        const observedEmail = afterData['observedEmail'] as string;
        const observedName = afterData['observedName'] as string;
        const observerEmail = (afterData['observerEmail'] as string) ?? '';
        const observedRole = afterData['observedRole'] as string;
        const observedYear = String(afterData['observedYear'] ?? '');
        const obsDate = formatDate(afterData['observationDate']);
        const obsName = (afterData['observationName'] as string) ?? '';

        await sendTemplatedEmail({
          db,
          triggerType,
          to: observedEmail,
          vars: {
            observerName: observerEmail.split('@')[0],
            observerEmail,
            observedName,
            observedEmail,
            observedRole,
            observedYear,
            observationDate: obsDate,
            observationName: obsName,
            observationType: obsType ?? '',
          },
          mailDocId: `created-${event.params.observationId}`,
          auditDetails: { observationId: event.params.observationId, triggerType },
        });
      } catch (emailErr) {
        logger.error('onObservationWritten: creation email failed (non-fatal)', emailErr);
      }
    }

    // Sheet sync (only when MASTER_LOG_SHEET_ID is configured)
    if (!sheetId) {
      logger.info('onObservationWritten: MASTER_LOG_SHEET_ID unset, skipping sheet sync');
      return;
    }
    if (beforeData && !hasMeaningfulChange(beforeData, afterData)) {
      return;
    }

    try {
      await syncRow(sheetId, event.params.observationId, afterData);
    } catch (err) {
      // Don't let Sheet sync failures cascade — log and move on. Admins
      // get out-of-sync rows in the worst case.
      logger.error('onObservationWritten: sync failed', err);
    }
  },
);

function hasMeaningfulChange(before: ObsLike, after: ObsLike): boolean {
  for (const field of MEANINGFUL_FIELDS) {
    const a = JSON.stringify(stableValue(before[field]));
    const b = JSON.stringify(stableValue(after[field]));
    if (a !== b) return true;
  }
  return false;
}

/** Normalize Firestore Timestamps + Date-likes for stable JSON compare. */
function stableValue(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return value;
}

async function syncRow(sheetId: string, observationId: string, data: ObsLike): Promise<void> {
  const sheets = getSheetsClient();

  // Ensure header is present (idempotent — only writes if A1 is empty).
  const head = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A1:N1',
  });
  if (!head.data.values || head.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: 'A1:N1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADER_ROW] },
    });
  }

  // Find existing row by observationId in column A.
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'A:A',
  });
  const ids = (colA.data.values ?? []).map((row) => String(row[0] ?? ''));
  const matchIndex = ids.findIndex((id) => id === observationId);

  const row = buildRow(observationId, data);

  if (matchIndex === -1) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A1:N1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  } else {
    const rowNumber = matchIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `A${String(rowNumber)}:N${String(rowNumber)}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }
}

function buildRow(observationId: string, data: ObsLike): string[] {
  return [
    observationId,
    asString(data['observerEmail']),
    asString(data['observedEmail']),
    asString(data['observedName']),
    asString(data['observedRole']),
    formatYear(data['observedYear']),
    asString(data['type']),
    asString(data['status']),
    formatTimestamp(data['createdAt']),
    formatTimestamp(data['finalizedAt']),
    asString(data['observationName']),
    formatTimestamp(data['observationDate']),
    driveFolderUrl(data['driveFolderId']),
    pdfUrl(data['pdfDriveFileId']),
  ];
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function formatYear(value: unknown): string {
  if (typeof value !== 'number') return '';
  return value < 4 ? `Year ${String(value)}` : `P${String(value - 3)}`;
}

function formatTimestamp(value: unknown): string {
  if (!value) return '';
  let ms: number | null = null;
  if (value instanceof Timestamp) ms = value.toMillis();
  else if (value instanceof Date) ms = value.getTime();
  else if (typeof value === 'number') ms = value;
  else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) ms = parsed;
  }
  if (ms === null) return '';
  return new Date(ms).toISOString();
}

function driveFolderUrl(folderId: unknown): string {
  if (typeof folderId !== 'string' || folderId.length === 0) return '';
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function pdfUrl(fileId: unknown): string {
  if (typeof fileId !== 'string' || fileId.length === 0) return '';
  return `https://drive.google.com/file/d/${fileId}/view`;
}

async function handleDeletion(
  sheetId: string,
  observationId: string,
  beforeData: ObsLike | null | undefined,
): Promise<void> {
  // 1. Delete the Drive folder for Draft observations only. Finalized
  //    observations have their folder shared with the observed staff member —
  //    deleting it would revoke their access to audio, evidence, and the PDF.
  if (
    beforeData?.['status'] === 'Draft' &&
    typeof beforeData['driveFolderId'] === 'string' &&
    beforeData['driveFolderId']
  ) {
    try {
      await deleteDriveFolder(beforeData['driveFolderId']);
    } catch (err) {
      logger.warn('onObservationWritten: Drive folder cleanup failed', { observationId, err });
    }
  }

  // 2. Mark the Sheet row as [DELETED] so the admin log stays accurate.
  if (!sheetId) return;
  try {
    const sheets = getSheetsClient();
    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A:A',
    });
    const ids = (colA.data.values ?? []).map((row) => String(row[0] ?? ''));
    const matchIndex = ids.findIndex((id) => id === observationId);
    if (matchIndex === -1) return;
    const rowNumber = matchIndex + 1;
    // Preserve the observation ID in column A so the row remains identifiable,
    // clear all other metadata, and stamp status as [DELETED].
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `A${String(rowNumber)}:N${String(rowNumber)}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          [
            observationId,
            asString(beforeData?.['observerEmail']),
            asString(beforeData?.['observedEmail']),
            asString(beforeData?.['observedName']),
            '',
            '',
            asString(beforeData?.['type']),
            '[DELETED]',
            '',
            '',
            '',
            '',
            '',
            '',
          ],
        ],
      },
    });
  } catch (err) {
    logger.error('onObservationWritten: Sheet row cleanup failed', err);
  }
}
