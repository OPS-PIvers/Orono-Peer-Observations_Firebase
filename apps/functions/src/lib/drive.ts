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

/**
 * Grant a role (`reader` or `writer`) on a Drive folder/file to a specific
 * user, idempotently (looks up existing permissions first to avoid
 * duplicate grants on re-finalize).
 */
export async function shareWithUser(args: {
  fileId: string;
  email: string;
  role: 'reader' | 'writer';
  /** Optional message for the email Google sends to the recipient. */
  emailMessage?: string;
  /** When false, suppresses the auto-notification email. */
  sendNotificationEmail?: boolean;
}): Promise<void> {
  const drive = getDriveClient();
  const existing = await drive.permissions.list({
    fileId: args.fileId,
    fields: 'permissions(id,emailAddress,role)',
  });
  const lower = args.email.toLowerCase();
  const match = existing.data.permissions?.find(
    (p) => p.emailAddress?.toLowerCase() === lower,
  );
  if (match && match.role === args.role) return;
  if (match?.id) {
    await drive.permissions.update({
      fileId: args.fileId,
      permissionId: match.id,
      requestBody: { role: args.role },
    });
    return;
  }
  if (args.emailMessage !== undefined) {
    await drive.permissions.create({
      fileId: args.fileId,
      sendNotificationEmail: args.sendNotificationEmail ?? false,
      emailMessage: args.emailMessage,
      requestBody: { type: 'user', role: args.role, emailAddress: args.email },
    });
  } else {
    await drive.permissions.create({
      fileId: args.fileId,
      sendNotificationEmail: args.sendNotificationEmail ?? false,
      requestBody: { type: 'user', role: args.role, emailAddress: args.email },
    });
  }
}

export interface DriveLink {
  webViewLink: string;
  webContentLink: string | null;
}

/**
 * Permanently delete a Drive folder and all of its children.
 * Used when a Draft observation is deleted — the SA owns the folder so
 * deletion is unconditional. Silently no-ops if the folder is already gone.
 */
export async function deleteDriveFolder(folderId: string): Promise<void> {
  const drive = getDriveClient();
  // List immediate children so we can delete them before the folder,
  // ensuring no orphaned files remain accessible from other contexts.
  const children = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id)',
    pageSize: 1000,
  });
  await Promise.all(
    (children.data.files ?? []).map((f) =>
      f.id ? drive.files.delete({ fileId: f.id }).catch(() => undefined) : Promise.resolve(),
    ),
  );
  await drive.files.delete({ fileId: folderId });
}

export async function getDriveLinks(fileId: string): Promise<DriveLink> {
  const drive = getDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink',
  });
  return {
    webViewLink: meta.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    webContentLink: meta.data.webContentLink ?? null,
  };
}
