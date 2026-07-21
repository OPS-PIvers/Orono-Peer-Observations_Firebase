import { Readable } from 'node:stream';
import { logger } from 'firebase-functions';
import type { drive_v3 } from 'googleapis';

/**
 * Drive API helpers backed by the Cloud Functions runtime service account
 * (`peer-eval-svc@…`). The SA owns observation folders directly — observed
 * staff get `reader` permission on finalize via `permissions.create`.
 *
 * Domain-Wide Delegation is OFF the table for this project, so we never
 * impersonate users.
 *
 * `googleapis` is lazily imported inside `getDriveClient()` rather than at
 * module top level — it's a very large SDK, and most deployed functions
 * (e.g. `syncMyClaims`) never touch Drive at all. Loading it only when a
 * Drive client is actually requested keeps their cold starts cheap. The
 * built client itself is cached below, so the dynamic import only ever
 * runs once per warm container.
 */

let driveClient: drive_v3.Drive | null = null;

export async function getDriveClient(): Promise<drive_v3.Drive> {
  if (driveClient) return driveClient;
  const { google } = await import('googleapis');
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
  const drive = await getDriveClient();
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
  const drive = await getDriveClient();
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

/**
 * Replace an existing Drive file's content (and name) in place, keeping its
 * fileId — and therefore every previously-shared link — stable. Used on
 * re-finalize after an admin reopens an observation, so the regenerated PDF
 * replaces the stale one instead of piling up duplicates in the folder.
 *
 * Returns the fileId on success, or `null` if the file no longer exists
 * (deleted out from under us) so the caller can fall back to a fresh upload.
 */
export async function replaceFileContent(args: {
  fileId: string;
  filename: string;
  mimeType: string;
  body: Buffer;
}): Promise<string | null> {
  const drive = await getDriveClient();
  try {
    const result = await drive.files.update({
      fileId: args.fileId,
      requestBody: { name: args.filename },
      media: {
        mimeType: args.mimeType,
        body: Readable.from(args.body),
      },
      fields: 'id',
    });
    return result.data.id ?? null;
  } catch (err) {
    const status = (err as { code?: number })?.code;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * Move a single Drive file to the trash (recoverable for ~30 days per
 * Drive's default trash retention) rather than permanently deleting it.
 * Used when evidence is removed from an observation — the file is no
 * longer referenced from the app, but a mis-click shouldn't be
 * unrecoverable. A missing file (404, already deleted/trashed out from
 * under us) is treated as success.
 */
export async function trashDriveFile(fileId: string): Promise<void> {
  const drive = await getDriveClient();
  try {
    await drive.files.update({ fileId, requestBody: { trashed: true } });
  } catch (err) {
    const status = (err as { code?: number })?.code;
    if (status !== 404) throw err;
  }
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const drive = await getDriveClient();
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
  const drive = await getDriveClient();
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

/**
 * Grant the observation's observer Reader access on its Drive folder so the
 * observer-facing links the app renders (Finalized banner "Open PDF" /
 * "Open Drive folder", StaffPersonPage "View PDF", evidence chips) actually
 * open. The district parent folder is shared only with the service account
 * and admins — Peer Evaluators are not admins, so without this per-folder
 * grant every observer link lands on Drive's request-access page.
 *
 * Idempotent (`shareWithUser` dedupes existing grants) and deliberately
 * best-effort: a failed grant is logged, never thrown, so a Drive permissions
 * hiccup (or a suspended observer account when an admin finalizes on their
 * behalf) can't fail an evidence/audio upload or brick finalization. Every
 * call site re-attempts the grant, so a missed grant heals on the next Drive
 * interaction.
 */
export async function shareObservationFolderWithObserver(args: {
  folderId: string;
  observerEmail: string;
}): Promise<void> {
  try {
    await shareWithUser({
      fileId: args.folderId,
      email: args.observerEmail,
      role: 'reader',
      sendNotificationEmail: false,
    });
  } catch (err) {
    logger.warn('shareObservationFolderWithObserver: share failed (non-fatal)', {
      folderId: args.folderId,
      observerEmail: args.observerEmail,
      err,
    });
  }
}

/**
 * Permanently delete a single Drive file. Used to remove an individual
 * evidence/audio file or a superseded PDF (the SA owns these files, so the
 * delete is unconditional). A missing file (404) is treated as success so a
 * double-delete or an already-cleaned file never throws.
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = await getDriveClient();
  try {
    await drive.files.delete({ fileId });
  } catch (err) {
    const status = (err as { code?: number })?.code;
    if (status === 404) return; // already gone — nothing to delete
    throw err;
  }
}

export interface DriveLink {
  webViewLink: string;
  webContentLink: string | null;
}

/**
 * Permanently delete a Drive folder and all of its children.
 * Used when a Draft observation is deleted — the SA owns the folder so
 * deletion is unconditional. Pages through children so folders with
 * more than one page of files are cleared completely. Logs (but does
 * not propagate) per-child failures so the parent delete still runs;
 * a missing parent (404) is treated as success.
 */
export async function deleteDriveFolder(folderId: string): Promise<void> {
  const drive = await getDriveClient();
  // List immediate children so we can delete them before the folder,
  // ensuring no orphaned files remain accessible from other contexts.
  let pageToken: string | undefined;
  do {
    const page = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id)',
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    });
    await Promise.all(
      (page.data.files ?? []).map((f) =>
        f.id
          ? drive.files.delete({ fileId: f.id }).catch((err: unknown) => {
              logger.warn('deleteDriveFolder: failed to delete child', {
                folderId,
                fileId: f.id,
                err,
              });
            })
          : Promise.resolve(),
      ),
    );
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken);

  await drive.files.delete({ fileId: folderId }).catch((err: unknown) => {
    const status = (err as { code?: number })?.code;
    if (status !== 404) throw err;
  });
}

export async function getDriveLinks(fileId: string): Promise<DriveLink> {
  const drive = await getDriveClient();
  const meta = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink',
  });
  return {
    webViewLink: meta.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    webContentLink: meta.data.webContentLink ?? null,
  };
}
