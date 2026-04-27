import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';

/**
 * Drive API helpers backed by the Cloud Functions runtime service account
 * (`peer-eval-svc@…`). The SA owns observation folders directly — observed
 * staff get `reader` permission on finalize via `permissions.create`.
 *
 * Domain-Wide Delegation is OFF the table for this project, so we never
 * impersonate users.
 */

let driveClient: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * Get or create the Drive folder for this observation. Returns the folder
 * ID. If `existingFolderId` is supplied and still exists, reuses it.
 */
export async function ensureObservationFolder(args: {
  observationId: string;
  observedName: string;
  parentFolderId: string;
  existingFolderId: string | null;
}): Promise<string> {
  const drive = getDriveClient();
  if (args.existingFolderId) {
    try {
      await drive.files.get({ fileId: args.existingFolderId, fields: 'id' });
      return args.existingFolderId;
    } catch {
      // Folder was deleted out from under us; fall through and recreate.
    }
  }
  const created = await drive.files.create({
    requestBody: {
      name: `${args.observedName} — ${args.observationId}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [args.parentFolderId],
    },
    fields: 'id',
  });
  if (!created.data.id) throw new Error('Drive folder creation returned no id');
  return created.data.id;
}

export async function uploadFileToFolder(args: {
  folderId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
}): Promise<{ fileId: string; fileName: string }> {
  const drive = getDriveClient();
  const result = await drive.files.create({
    requestBody: {
      name: args.filename,
      parents: [args.folderId],
      mimeType: args.mimeType,
    },
    media: {
      mimeType: args.mimeType,
      body: Readable.from(args.body),
    },
    fields: 'id, name',
  });
  if (!result.data.id || !result.data.name) {
    throw new Error('Drive upload returned no id/name');
  }
  return { fileId: result.data.id, fileName: result.data.name };
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const result = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(result.data as ArrayBuffer);
}
